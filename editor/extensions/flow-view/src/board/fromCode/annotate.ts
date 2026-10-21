/*---------------------------------------------------------------------------------------------
 *  Axle boards generated from code: what an agent may add to a generated board. A title, a description, and a note per node
 *  (named by node id or symbol). Never a node or an edge: every relation on a generated board comes from the index.
 *  Pure: no `vscode`.
 *--------------------------------------------------------------------------------------------*/

import type { GenBoard } from './board';

export interface Annotations {
	title?: unknown;
	description?: unknown;
	/** [{ node: id or symbol, text }]. */
	notes?: unknown;
}

/** Applies the annotations in place; returns warnings for notes that name nothing on the board. */
export function annotate(board: GenBoard, a: Annotations): string[] {
	const warnings: string[] = [];
	if (typeof a.title === 'string' && a.title.trim()) {
		board.title = a.title.trim().slice(0, 120);
	}
	if (typeof a.description === 'string' && a.description.trim()) {
		board.description = `${a.description.trim().slice(0, 400)}${board.description ? ` ${board.description}` : ''}`.slice(0, 600);
	}
	if (a.notes === undefined) {
		return warnings;
	}
	if (!Array.isArray(a.notes)) {
		return ['`notes` must be an array of {node, text}; it was ignored.'];
	}
	for (const n of a.notes.slice(0, 40) as Record<string, unknown>[]) {
		const key = typeof n?.node === 'string' ? n.node : '';
		const text = typeof n?.text === 'string' ? n.text.trim().slice(0, 600) : '';
		if (!key || !text) {
			warnings.push('A note needs {node, text}; it was ignored.');
			continue;
		}
		const lower = key.toLowerCase();
		const node = board.nodes.find(x => x.id === key) ?? board.nodes.find(x => x.symbol === key) ?? board.nodes.find(x => x.label.toLowerCase() === lower);
		if (!node) {
			warnings.push(`Note for "${key}" was dropped: no node has that id, symbol or label. Annotations never add nodes; node ids: ${board.nodes.slice(0, 10).map(x => x.id).join(', ')}.`);
			continue;
		}
		node.note = node.note ? `${node.note} ${text}`.slice(0, 600) : text;
	}
	return warnings;
}
