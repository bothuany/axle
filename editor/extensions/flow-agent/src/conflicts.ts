/*---------------------------------------------------------------------------------------------
 *  Insilode: two agents on the same code. Each live session collects what it has edited (files from
 *  its edit hooks, the methods and endpoint flows from flow-view's turn impact); when two sessions
 *  share a file, a method or a flow, both rows say so. Paths are compared relative to each
 *  session's own checkout, so an agent in a worktree and one in the main checkout that edit
 *  src/Orders.cs are on the same file. Two sessions in one checkout write the same files on disk:
 *  that is the case the dock warns about most loudly. No vscode here, so node tests run it.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { sameDir } from './worktrees';

/** What one live session has touched, collected across its turns. */
export interface SessionEdits {
	id: string;
	name: string;
	/** The checkout it works in: the main folder, or its worktree. */
	root: string;
	/** Files, relative to `root`, in the form `key()` gives. */
	files: Set<string>;
	/** Changed methods by `key(file) + '#' + name`, the value is the method's name ("OrderService.Place"). */
	methods: Map<string, string>;
	/** Endpoint flows the edits reach, by flow id; the value is its label ("POST /orders"). */
	flows: Map<string, string>;
}

export interface Conflict {
	/** The other session. */
	id: string;
	name: string;
	/** Both write the same checkout: their edits land in the same files on disk. */
	sameCheckout: boolean;
	files: string[];
	methods: string[];
	flows: string[];
}

/**
 * A file relative to the session's checkout, with forward slashes and, on Windows (whose paths ignore case), in lower case.
 * Undefined for a file outside the checkout (a session edits a scratch file elsewhere): it cannot clash with another checkout.
 */
export function key(file: string, root: string, platform: NodeJS.Platform = process.platform): string | undefined {
	const p = platform === 'win32' ? path.win32 : path.posix;
	const rel = p.relative(root, p.resolve(root, file));
	if (!rel || rel.startsWith('..') || p.isAbsolute(rel)) {
		return undefined;
	}
	const k = rel.split(p.sep).join('/');
	return platform === 'win32' ? k.toLowerCase() : k;
}

/** Two checkouts are the same folder (Windows compares without case and without a trailing separator). */
export const sameRoot = sameDir;

/** For every session, the others it overlaps with: same files, and the methods and flows they share when those are known. */
export function findConflicts(sessions: SessionEdits[], platform: NodeJS.Platform = process.platform): Map<string, Conflict[]> {
	const out = new Map<string, Conflict[]>();
	for (let i = 0; i < sessions.length; i++) {
		for (let j = i + 1; j < sessions.length; j++) {
			const a = sessions[i];
			const b = sessions[j];
			const files = [...a.files].filter(f => b.files.has(f)).sort();
			const methods = [...a.methods.keys()].filter(m => b.methods.has(m)).map(m => a.methods.get(m)!);
			const flows = [...a.flows.keys()].filter(f => b.flows.has(f)).map(f => a.flows.get(f)!);
			// A shared flow alone is not a clash (two edits far apart may reach the same endpoint): a file in common is needed.
			if (!files.length) {
				continue;
			}
			const sameCheckout = sameRoot(a.root, b.root, platform);
			const one = (other: SessionEdits): Conflict => ({ id: other.id, name: other.name, sameCheckout, files, methods: [...new Set(methods)].sort(), flows: [...new Set(flows)].sort() });
			out.set(a.id, [...out.get(a.id) ?? [], one(b)]);
			out.set(b.id, [...out.get(b.id) ?? [], one(a)]);
		}
	}
	return out;
}

/** The line a row shows: "Also editing OrderService.Place with Claude 2", the most precise thing known first. */
export function conflictText(c: Conflict): string {
	const what = c.methods.length ? list(c.methods) : c.flows.length ? `${list(c.files.map(f => f.split('/').pop()!))} (${list(c.flows)})` : list(c.files.map(f => f.split('/').pop()!));
	return `Also editing ${what} with ${c.name}`;
}

function list(items: string[]): string {
	return items.length <= 2 ? items.join(' and ') : `${items.slice(0, 2).join(', ')} +${items.length - 2}`;
}
