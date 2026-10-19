/*---------------------------------------------------------------------------------------------
 *  Axle: the prompt behind the dock's "Explain this" button. The author explains its own change, so the prompt goes to that same
 *  session, and it says what the turn touched (the methods, the tables, the flows, taken from the turn-end impact) so the agent
 *  does not have to work that out again. It asks for a tour on the change set, through the `axle` MCP server's `tour` tool.
 *  Pure (no vscode): tested on its own (test/explain.test.mjs); agents.ts types it into the session.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';

/** The part of the turn-end impact (agents.ts `TurnImpact`) the prompt uses. */
export interface ExplainImpact {
	methods?: { file: string; name: string }[];
	tables?: { table: string; entity?: string; entityChanged?: boolean; migration?: string }[];
	flows?: { label: string }[];
	more?: number;
}

/** Most things named in the prompt: a long list is a document, not a tour. */
const MAX_METHODS = 14;
const MAX_FILES = 12;
const MAX_FLOWS = 6;

/** A path as the agent reads it: relative to its folder when it is inside it. */
function shown(file: string, root: string | undefined): string {
	if (!root) {
		return file;
	}
	const rel = path.relative(root, file);
	return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : file;
}

/** Whether a session that is not working and edited something this turn has anything to explain. */
export const canExplain = (edited: number) => edited > 0;

/**
 * The text typed into the agent's prompt. One line (a terminal prompt submits at a line break). `files`: what the turn edited;
 * `impact`: what the turn-end check found, when it did.
 */
export function explainPrompt(files: readonly string[], impact: ExplainImpact | undefined, root?: string): string {
	const methods = (impact?.methods ?? []).slice(0, MAX_METHODS);
	const tables = impact?.tables ?? [];
	const flows = (impact?.flows ?? []).slice(0, MAX_FLOWS);
	const lines = [
		'Explain the change you just made as a tour, so I can follow it on the Axle canvas.',
		'Call the axle tool `tour` with flow {"changes": true}: one step per changed method, in the order a request runs through them (the entry first), a `table` step for each changed table, and captions that say why it changed and what could break, in the language I am writing to you in.',
		'End with a caption-only step on the risks and what you did not test.',
		'If you cannot call mcp__axle__tour, explain it in text instead.',
	];
	if (methods.length || tables.length) {
		const m = methods.map(x => `${x.name} (${shown(x.file, root)})`).join(', ');
		const t = tables.map(x => `table ${x.table}${x.migration ? ` (migration ${x.migration})` : x.entityChanged && x.entity ? ` (entity ${x.entity})` : ''}`).join(', ');
		lines.push(`Changed: ${[m, t].filter(Boolean).join('; ')}.`);
		if (flows.length) {
			lines.push(`Endpoints they reach: ${flows.map(f => f.label).join(', ')}${(impact?.more ?? 0) > 0 ? ` and ${impact!.more} more` : ''}.`);
		}
	} else {
		const list = files.slice(0, MAX_FILES).map(f => shown(f, root));
		lines.push(`The files you edited this turn: ${list.join(', ')}${files.length > MAX_FILES ? ` and ${files.length - MAX_FILES} more` : ''}.`);
	}
	// A name from the index or a file name may hold any character: nothing a terminal takes for a key or an escape gets through.
	// eslint-disable-next-line no-control-regex
	return lines.join(' ').replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}
