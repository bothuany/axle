/*---------------------------------------------------------------------------------------------
 *  Axle harness: what this project has not set up. The health score counts what is broken, so a
 *  project with no harness at all scored 100 ("Nothing broken") while a rich one scored the same:
 *  the number could not tell a newcomer anything. Missing project instructions cost points, since
 *  agents then start without the project's conventions; missing hooks or permission rules are only
 *  named, as they are a choice. Pure (no vscode), so it is tested on its own.
 *--------------------------------------------------------------------------------------------*/

/** The fields of a harness item this needs (see scan.ts HarnessItem). */
export interface ItemLike {
	kind: string;
	scope: string;
}

export interface Gap {
	key: 'instructions' | 'hooks' | 'permissions';
	/** Short, for a list: "CLAUDE.md". */
	label: string;
	/** Why it matters, one sentence. */
	message: string;
	/** Points off the health score. */
	cost: number;
}

/** What the user's own (home folder) harness holds is theirs, not the project's: it does not fill a project gap. */
const inProject = (i: ItemLike) => i.scope !== 'user';

export function projectGaps(items: readonly ItemLike[]): Gap[] {
	const has = (kind: string) => items.some(i => i.kind === kind && inProject(i));
	const gaps: Gap[] = [];
	if (!has('instructions')) {
		gaps.push({ key: 'instructions', label: 'CLAUDE.md', cost: 10, message: 'No CLAUDE.md or AGENTS.md in this project: agents start without its conventions, commands and layout.' });
	}
	if (!has('hooks')) {
		gaps.push({ key: 'hooks', label: 'hooks', cost: 0, message: 'No project hooks: nothing checks an agent\'s edits as they happen (formatting, type checks, guarded paths).' });
	}
	if (!has('permissions')) {
		gaps.push({ key: 'permissions', label: 'permission rules', cost: 0, message: 'No project permission rules: agents ask for everything, or follow only your personal rules.' });
	}
	return gaps;
}

/** Item counts by kind, split into this project's and the user's own. */
export function totalsBySource(items: readonly ItemLike[], kinds: readonly string[]) {
	const count = (kind: string, project: boolean) => items.filter(i => i.kind === kind && inProject(i) === project).length;
	return {
		project: Object.fromEntries(kinds.map(k => [k, count(k, true)])) as Record<string, number>,
		user: Object.fromEntries(kinds.map(k => [k, count(k, false)])) as Record<string, number>,
	};
}

/** "1 instruction", "2 instructions": English plurals for the few nouns the harness counts. */
export function plural(n: number, one: string, many = `${one}s`) {
	return `${n} ${n === 1 ? one : many}`;
}
