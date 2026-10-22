/*---------------------------------------------------------------------------------------------
 *  Insilode: the steps of merging, removing and letting go of an agent's worktree, with the dialogs
 *  and git behind small interfaces, so the order of the checks (ask first, look again after the
 *  answer, a second yes before uncommitted work is lost) is tested in node (test/worktreeFlow).
 *  worktreeActions.ts runs them with VS Code's dialogs and the real git.
 *--------------------------------------------------------------------------------------------*/

import type { MergePlan, Worktree } from './worktrees';

/** The dialogs a flow may show. `choose` is modal and resolves to the button picked, or undefined when dismissed. */
export interface FlowUi {
	choose<T extends string>(message: string, detail: string, buttons: T[]): Promise<T | undefined>;
	info(message: string): void;
	error(message: string): void;
}

/** The git work a flow may do. */
export interface FlowGit {
	planMerge(wt: Worktree): Promise<MergePlan>;
	merge(wt: Worktree, kind: 'fast-forward' | 'merge'): Promise<{ ok: true } | { ok: false; reason: string }>;
	changedFiles(dir: string): Promise<string[] | undefined>;
	removeWorktree(wt: Worktree, force: boolean): Promise<{ ok: true } | { ok: false; reason: string }>;
	exists(dir: string): Promise<boolean>;
	/** Waits, so a shell that was just closed can let go of the folder (Windows keeps a busy directory). */
	sleep(ms: number): Promise<void>;
}

export interface FlowAgent {
	name: string;
	/** Its terminal is still running. */
	live: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Merges the worktree's branch into its base in the main checkout, after a modal yes. The plan is worked out again
 * once the user said yes: the dialog may have stayed open while the main checkout moved to another branch or got
 * uncommitted changes, and the merge must run on what is there now.
 */
export async function mergeFlow(a: FlowAgent, wt: Worktree, ui: FlowUi, git: FlowGit): Promise<'merged' | 'cancelled' | 'refused' | 'nothing' | 'failed'> {
	const plan = await git.planMerge(wt);
	if (plan.kind === 'refuse') {
		ui.error(`Insilode: not merging ${wt.branch} into ${wt.base}: ${plan.reason}`);
		return 'refused';
	}
	if (plan.kind === 'nothing') {
		ui.info(`Insilode: ${wt.branch} has no commits that ${wt.base} does not have.${(await git.changedFiles(wt.path))?.length ? ' Its changes are not committed yet.' : ''}`);
		return 'nothing';
	}
	const how = plan.kind === 'fast-forward' ? `fast-forward ${wt.base} to it` : `make a merge commit on ${wt.base}`;
	const n = plan.uncommitted;
	const warn = n ? `\n\n${plural(n, 'uncommitted file')} ${n === 1 ? 'stays' : 'stay'} in the worktree and ${n === 1 ? 'is' : 'are'} not merged: ask ${a.name} to commit first if ${n === 1 ? 'it belongs' : 'they belong'} in.` : '';
	const ok = await ui.choose(`Merge ${wt.branch} into ${wt.base}?`, `${plural(plan.ahead, 'commit')} from ${a.name}'s worktree. Insilode will ${how} in ${wt.root}.${warn}`, ['Merge']);
	if (ok !== 'Merge') {
		return 'cancelled';
	}
	const now = await git.planMerge(wt);
	if (now.kind === 'refuse' || now.kind === 'nothing') {
		ui.error(`Insilode: not merging ${wt.branch} into ${wt.base} after all: ${now.kind === 'refuse' ? now.reason : `${wt.base} has its commits already`}`);
		return now.kind === 'refuse' ? 'refused' : 'nothing';
	}
	if (now.kind !== plan.kind) {
		// A fast-forward that became a merge commit (base moved on) is a different change from the one agreed to.
		ui.error(`Insilode: ${wt.base} changed while you were deciding: the merge would now ${now.kind === 'merge' ? 'make a merge commit' : 'be a fast-forward'}. Try Merge again.`);
		return 'cancelled';
	}
	const r = await git.merge(wt, now.kind);
	if (r.ok) {
		ui.info(`Insilode: merged ${wt.branch} into ${wt.base}.`);
		return 'merged';
	}
	ui.error(`Insilode: the merge of ${wt.branch} failed: ${r.reason}`);
	return 'failed';
}

/**
 * Removes the worktree folder after a modal yes; the branch stays, so its commits are not lost. Uncommitted work (or a
 * status that cannot be read) needs a second, explicit yes. A running agent's terminal is closed first.
 */
export async function removeFlow(a: FlowAgent, wt: Worktree, ui: FlowUi, git: FlowGit, closeTerminal: () => void, platform: NodeJS.Platform = process.platform): Promise<'removed' | 'cancelled' | 'failed'> {
	const ok = await ui.choose(`Remove the worktree of ${a.name}?`, `Deletes the folder ${wt.path}. The branch ${wt.branch} and its commits stay.${a.live ? ` ${a.name}'s terminal is closed first.` : ''}`, ['Remove']);
	if (ok !== 'Remove') {
		return 'cancelled';
	}
	const dirty = await git.changedFiles(wt.path);
	let force = false;
	if (dirty === undefined || dirty.length) {
		const files = dirty ?? [];
		const again = await ui.choose(
			dirty === undefined ? `Insilode could not read the worktree's status. Remove it anyway?` : `${plural(files.length, 'uncommitted change')} in the worktree will be lost.`,
			files.slice(0, 12).join('\n') + (files.length > 12 ? `\n… and ${files.length - 12} more` : ''),
			['Remove and Lose Changes'],
		);
		if (again !== 'Remove and Lose Changes') {
			return 'cancelled';
		}
		force = true;
	}
	if (a.live) {
		closeTerminal();
		// The shell needs a moment to exit; on Windows git cannot delete a folder a process still has as its directory.
		await git.sleep(800);
	}
	let r = await git.removeWorktree(wt, force);
	if (!r.ok && platform === 'win32') {
		await git.sleep(1500);
		r = await git.removeWorktree(wt, force);
	}
	if (!r.ok) {
		ui.error(`Insilode: could not remove the worktree: ${r.reason}`);
		return 'failed';
	}
	ui.info(`Insilode: removed the worktree. The branch ${wt.branch} is still there.`);
	return 'removed';
}

/**
 * What to do when an ended agent with a worktree is taken off the list: the row is the only place its worktree shows,
 * so the folder, its branch and any uncommitted work must not just drop out of sight. `keep` leaves the worktree for
 * Agents: Kept Worktrees; a worktree whose folder is gone needs no question.
 */
export async function forgetFlow(a: FlowAgent, wt: Worktree | undefined, ui: FlowUi, git: FlowGit): Promise<'forget' | 'keep' | 'merge' | 'remove' | 'cancelled'> {
	if (!wt || !await git.exists(wt.path)) {
		return 'forget';
	}
	const dirty = await git.changedFiles(wt.path);
	const work = dirty === undefined ? '' : dirty.length ? ` It has ${plural(dirty.length, 'uncommitted change')}.` : '';
	const pick = await ui.choose(
		`${a.name}'s worktree is still there`,
		`${wt.path} on branch ${wt.branch}.${work}\n\nKeep it to come back to it later (Agents: Kept Worktrees…), or merge or remove it now.`,
		['Keep Worktree', 'Merge…', 'Remove Worktree…'],
	);
	return pick === 'Keep Worktree' ? 'keep' : pick === 'Merge…' ? 'merge' : pick === 'Remove Worktree…' ? 'remove' : 'cancelled';
}
