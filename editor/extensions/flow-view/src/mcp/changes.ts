/*---------------------------------------------------------------------------------------------
 *  Insilode agent bridge: what kind of change a file shows in git (new, modified, deleted, renamed), from the
 *  statuses the Git extension lists for it. Pure (no vscode), so it is tested on its own.
 *--------------------------------------------------------------------------------------------*/

/** The vscode.git Status values this needs (extensions/git/src/api/git.d.ts). */
export const GitStatus = { IndexAdded: 1, IndexDeleted: 2, IndexRenamed: 3, Deleted: 6, Untracked: 7, IntentToAdd: 9, IntentToRename: 10 } as const;

/**
 * Every status each file has, in one pass. A file can be listed more than once (staged and changed again, say); grouping
 * once keeps a branch diff of thousands of files linear instead of filtering the whole list again for each of them.
 */
export function statusesByFile(all: { uri: { fsPath: string }; status: number }[]): Map<string, number[]> {
	const by = new Map<string, number[]>();
	for (const c of all) {
		const list = by.get(c.uri.fsPath);
		if (list) {
			list.push(c.status);
		} else {
			by.set(c.uri.fsPath, [c.status]);
		}
	}
	return by;
}

/** A, D, R or M for a file with these statuses (A wins: a new file that was then changed is still new). */
export function changeMark(kinds: number[]): { added: boolean; deleted: boolean; renamed: boolean; mark: 'A' | 'D' | 'R' | 'M' } {
	const added = kinds.some(k => k === GitStatus.IndexAdded || k === GitStatus.Untracked || k === GitStatus.IntentToAdd);
	const deleted = !added && kinds.every(k => k === GitStatus.IndexDeleted || k === GitStatus.Deleted);
	const renamed = kinds.includes(GitStatus.IndexRenamed) || kinds.includes(GitStatus.IntentToRename);
	return { added, deleted, renamed, mark: added ? 'A' : deleted ? 'D' : renamed ? 'R' : 'M' };
}
