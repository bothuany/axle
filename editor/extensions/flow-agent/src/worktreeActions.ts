/*---------------------------------------------------------------------------------------------
 *  Axle: the worktree part of an agent's row in the dock. Keeps each worktree's ahead/behind
 *  count against its base branch (git runs in the background, never on a repaint), and does what
 *  the row's buttons ask: open the folder, show the branch's changes in flow, merge back, remove.
 *  Merging and removing change the user's repository, so each waits behind a modal confirm.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { Agents, AgentSession } from './agents';
import { aheadBehind, changedFiles, merge, planMerge, removeWorktree, type Worktree } from './worktrees';

/** What the page may ask for on a worktree row; anything else is ignored. */
export const WORKTREE_ACTIONS = ['open', 'diff', 'merge', 'remove'] as const;
export type WorktreeAction = typeof WORKTREE_ACTIONS[number];

/** The worktree as a row shows it. */
export interface WorktreeView {
	branch: string;
	base: string;
	ahead?: number;
	behind?: number;
	/** Files changed and not committed in the worktree. */
	uncommitted?: number;
}

/** A count is refreshed at most this often per worktree, however often the agent reports. */
const REFRESH_MS = 5000;
/** And this often regardless, for commits made outside the agent (a terminal, another tool). */
const POLL_MS = 30_000;

export class WorktreeRows implements vscode.Disposable {
	private readonly counts = new Map<string, { ahead?: number; behind?: number; uncommitted?: number; at: number }>();
	private readonly running = new Set<string>();
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;
	private readonly sub: vscode.Disposable;
	private readonly timer: NodeJS.Timeout;
	/** Only one merge or removal at a time: a second click while one runs must not start another git command. */
	private busy = false;

	constructor(private readonly agents: Agents) {
		this.sub = agents.onDidChange(() => this.refreshAll(false));
		this.timer = setInterval(() => this.refreshAll(true), POLL_MS);
	}

	dispose() {
		clearInterval(this.timer);
		this.sub.dispose();
		this.changed.dispose();
	}

	view(s: AgentSession): WorktreeView | undefined {
		const wt = s.worktree;
		if (!wt) {
			return undefined;
		}
		const c = this.counts.get(s.id);
		return { branch: wt.branch, base: wt.base, ahead: c?.ahead, behind: c?.behind, uncommitted: c?.uncommitted };
	}

	private refreshAll(force: boolean) {
		const now = Date.now();
		for (const s of this.agents.sessions.values()) {
			const c = this.counts.get(s.id);
			if (s.worktree && !this.running.has(s.id) && (force || !c || now - c.at > REFRESH_MS)) {
				void this.refresh(s.id, s.worktree);
			}
		}
	}

	private async refresh(id: string, wt: Worktree) {
		this.running.add(id);
		try {
			const [ab, files] = await Promise.all([aheadBehind(wt), changedFiles(wt.path)]);
			const before = this.counts.get(id);
			const next = { ahead: ab?.ahead, behind: ab?.behind, uncommitted: files?.length, at: Date.now() };
			this.counts.set(id, next);
			if (before?.ahead !== next.ahead || before?.behind !== next.behind || before?.uncommitted !== next.uncommitted) {
				this.changed.fire();
			}
		} finally {
			this.running.delete(id);
		}
	}

	async act(id: string, action: WorktreeAction) {
		const s = this.agents.sessions.get(id);
		const wt = s?.worktree;
		if (!s || !wt) {
			return;
		}
		switch (action) {
			case 'open': return this.open(wt);
			case 'diff': return void Promise.resolve(vscode.commands.executeCommand('flow.diff.showWorktree', wt.path, wt.base)).catch(e => vscode.window.showErrorMessage(`Axle: ${(e as Error).message}`));
			case 'merge': return this.once(() => this.merge(s, wt));
			case 'remove': return this.once(() => this.remove(s, wt));
		}
	}

	private async once(work: () => Promise<void>) {
		if (this.busy) {
			void vscode.window.showInformationMessage('Axle: a worktree merge or removal is still running.');
			return;
		}
		this.busy = true;
		try {
			await work();
		} finally {
			this.busy = false;
		}
	}

	/** In a new window, or next to this folder in this one (a multi-root workspace: the window reloads its extensions once). */
	private async open(wt: Worktree) {
		const uri = vscode.Uri.file(wt.path);
		const pick = await vscode.window.showQuickPick([
			{ label: '$(empty-window) Open in a New Window', run: () => vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true }) },
			{ label: '$(root-folder) Add to This Workspace', detail: 'This window becomes a multi-root workspace', run: () => vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, { uri, name: wt.branch }) },
			{ label: '$(terminal) Open a Terminal There', run: () => vscode.window.createTerminal({ name: wt.branch, cwd: wt.path }).show() },
		], { title: `Worktree ${wt.branch}`, placeHolder: wt.path });
		await pick?.run();
	}

	private async merge(s: AgentSession, wt: Worktree) {
		const plan = await planMerge(wt);
		if (plan.kind === 'refuse') {
			void vscode.window.showWarningMessage(`Axle: not merging ${wt.branch} into ${wt.base}: ${plan.reason}`, { modal: true });
			return;
		}
		if (plan.kind === 'nothing') {
			void vscode.window.showInformationMessage(`Axle: ${wt.branch} has no commits that ${wt.base} does not have.${(await changedFiles(wt.path))?.length ? ' Its changes are not committed yet.' : ''}`);
			return;
		}
		const how = plan.kind === 'fast-forward' ? `fast-forward ${wt.base} to it` : `make a merge commit on ${wt.base}`;
		const warn = plan.uncommitted ? `\n\n${plan.uncommitted} uncommitted file${plan.uncommitted === 1 ? ' stays' : 's stay'} in the worktree and ${plan.uncommitted === 1 ? 'is' : 'are'} not merged: ask ${s.name} to commit first if ${plan.uncommitted === 1 ? 'it belongs' : 'they belong'} in.` : '';
		const ok = await vscode.window.showWarningMessage(
			`Merge ${wt.branch} into ${wt.base}?`,
			{ modal: true, detail: `${plan.ahead} commit${plan.ahead === 1 ? '' : 's'} from ${s.name}'s worktree. Axle will ${how} in ${wt.root}.${warn}` },
			'Merge',
		);
		if (ok !== 'Merge') {
			return;
		}
		const r = await merge(wt, plan.kind);
		if (r.ok) {
			void vscode.window.showInformationMessage(`Axle: merged ${wt.branch} into ${wt.base}.`);
		} else {
			void vscode.window.showErrorMessage(`Axle: the merge of ${wt.branch} failed: ${r.reason}`);
		}
		this.counts.delete(s.id);
		this.refreshAll(true);
	}

	/** Removes the folder; the branch stays (its commits are not lost). Uncommitted work needs a second, explicit yes. */
	private async remove(s: AgentSession, wt: Worktree) {
		const live = s.state !== 'ended';
		const ok = await vscode.window.showWarningMessage(
			`Remove the worktree of ${s.name}?`,
			{ modal: true, detail: `Deletes the folder ${wt.path}. The branch ${wt.branch} and its commits stay.${live ? ` ${s.name}'s terminal is closed first.` : ''}` },
			'Remove',
		);
		if (ok !== 'Remove') {
			return;
		}
		const dirty = await changedFiles(wt.path);
		let force = false;
		if (dirty === undefined || dirty.length) {
			const files = dirty ?? [];
			const again = await vscode.window.showWarningMessage(
				dirty === undefined ? `Axle could not read the worktree's status. Remove it anyway?` : `${files.length} uncommitted change${files.length === 1 ? '' : 's'} in the worktree will be lost.`,
				{ modal: true, detail: files.slice(0, 12).join('\n') + (files.length > 12 ? `\n… and ${files.length - 12} more` : '') },
				'Remove and Lose Changes',
			);
			if (again !== 'Remove and Lose Changes') {
				return;
			}
			force = true;
		}
		if (live) {
			this.agents.closeTerminal(s.id);
			// The shell needs a moment to exit; on Windows git cannot delete a folder a process still has as its directory.
			await new Promise(r => setTimeout(r, 800));
		}
		let r = await removeWorktree(wt, force);
		if (!r.ok && process.platform === 'win32') {
			await new Promise(res => setTimeout(res, 1500));
			r = await removeWorktree(wt, force);
		}
		if (!r.ok) {
			void vscode.window.showErrorMessage(`Axle: could not remove the worktree: ${r.reason}`);
			return;
		}
		this.counts.delete(s.id);
		// Without its folder the conversation cannot be resumed where it ran (Claude keys transcripts by folder): the row goes too.
		this.agents.forget(s.id);
		void vscode.window.showInformationMessage(`Axle: removed the worktree. The branch ${wt.branch} is still there.`);
	}
}
