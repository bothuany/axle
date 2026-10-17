/*---------------------------------------------------------------------------------------------
 *  Axle: the worktree part of an agent's row in the dock. Keeps each worktree's ahead/behind
 *  count against its base branch (git runs in the background, never on a repaint), and does what
 *  the row's buttons ask: open the folder, show the branch's changes in flow, merge back, remove.
 *  Merging and removing change the user's repository, so each waits behind a modal confirm.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import type { Agents, AgentSession, KeptWorktree } from './agents';
import type { WorktreeAction } from './dockMessage';
import { forgetFlow, mergeFlow, removeFlow, type FlowGit, type FlowUi } from './worktreeFlow';
import { aheadBehind, changedFiles, merge, planMerge, removeWorktree, type Worktree } from './worktrees';


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
		const sessions = this.agents.sessions;
		for (const id of [...this.counts.keys()]) {
			if (!sessions.has(id)) {
				this.counts.delete(id); // taken off the list
			}
		}
		for (const s of sessions.values()) {
			const c = this.counts.get(s.id);
			// An ended agent commits nothing more: its counts are read once, and again only after a merge (which clears them).
			const due = s.state === 'ended' ? !c : force || !c || now - c.at > REFRESH_MS;
			if (s.worktree && !this.running.has(s.id) && due) {
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
		await mergeFlow({ name: s.name, live: s.state !== 'ended' }, wt, UI, GIT);
		this.counts.delete(s.id);
		this.refreshAll(true);
	}

	/** Removes the folder; the branch stays (its commits are not lost). Uncommitted work needs a second, explicit yes. */
	private async remove(s: AgentSession, wt: Worktree) {
		const r = await removeFlow({ name: s.name, live: s.state !== 'ended' }, wt, UI, GIT, () => this.agents.closeTerminal(s.id));
		if (r === 'removed') {
			this.counts.delete(s.id);
			// Without its folder the conversation cannot be resumed where it ran (Claude keys transcripts by folder): the row goes too.
			this.agents.forget(s.id);
		}
	}

	/**
	 * Takes an ended agent off the list. One with a worktree still on disk asks first: keep it (listed under Kept Agent
	 * Worktrees, so the folder, branch and uncommitted work stay reachable), merge it, or remove it.
	 */
	async forget(id: string) {
		const s = this.agents.sessions.get(id);
		if (!s) {
			return;
		}
		const wt = s.worktree;
		const pick = await forgetFlow({ name: s.name, live: s.state !== 'ended' }, wt, UI, GIT);
		if (pick === 'cancelled') {
			return;
		}
		if (pick === 'merge' || pick === 'remove') {
			return this.act(id, pick);
		}
		if (pick === 'keep' && wt) {
			this.agents.keepWorktree({ ...wt, agent: s.name }, true);
		}
		this.counts.delete(id);
		this.agents.forget(id);
	}

	/** Agents: Kept Worktrees…: the worktrees kept after their agents left the list, each to open, show, merge or remove. */
	async showKept() {
		const kept: KeptWorktree[] = [];
		for (const k of this.agents.keptWorktrees) {
			if (await GIT.exists(k.path)) {
				kept.push(k);
			} else {
				this.agents.keepWorktree(k, false); // removed outside Axle
			}
		}
		if (!kept.length) {
			void vscode.window.showInformationMessage('Axle: no kept agent worktrees. A worktree is kept when you take its ended agent off the list and choose Keep Worktree.');
			return;
		}
		const wt = (await vscode.window.showQuickPick(kept.map(k => ({ label: `$(git-branch) ${k.branch}`, description: k.agent, detail: k.path, k })), { title: 'Kept agent worktrees' }))?.k;
		if (!wt) {
			return;
		}
		const action = (await vscode.window.showQuickPick([
			{ label: '$(folder-opened) Open…', a: 'open' as const },
			{ label: '$(diff) Changes', detail: `In flow, since ${wt.base}`, a: 'diff' as const },
			{ label: '$(git-merge) Merge…', detail: `Into ${wt.base} (asks first)`, a: 'merge' as const },
			{ label: '$(trash) Remove…', detail: 'The folder (asks first; the branch stays)', a: 'remove' as const },
		], { title: `Worktree ${wt.branch}`, placeHolder: wt.path }))?.a;
		const a = { name: wt.agent, live: false };
		if (action === 'open') {
			await this.open(wt);
		} else if (action === 'diff') {
			await Promise.resolve(vscode.commands.executeCommand('flow.diff.showWorktree', wt.path, wt.base)).catch(e => vscode.window.showErrorMessage(`Axle: ${(e as Error).message}`));
		} else if (action === 'merge') {
			await this.once(async () => {
				await mergeFlow(a, wt, UI, GIT);
			});
		} else if (action === 'remove') {
			await this.once(async () => {
				if (await removeFlow(a, wt, UI, GIT, () => undefined) === 'removed') {
					this.agents.keepWorktree(wt, false);
				}
			});
		}
	}
}

/** The flows' dialogs, as VS Code shows them: every question modal, nothing taking focus by itself. */
const UI: FlowUi = {
	choose: async (message, detail, buttons) => await vscode.window.showWarningMessage(message, { modal: true, detail }, ...buttons),
	info: m => void vscode.window.showInformationMessage(m),
	error: m => void vscode.window.showErrorMessage(m),
};

const GIT: FlowGit = {
	planMerge, merge, changedFiles, removeWorktree,
	exists: dir => fs.stat(dir).then(st => st.isDirectory(), () => false),
	sleep: ms => new Promise(r => setTimeout(r, ms)),
};
