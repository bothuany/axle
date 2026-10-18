/*---------------------------------------------------------------------------------------------
 *  Axle: one canvas for a whole change set. The flows of the endpoints a change reaches, and the changed
 *  methods no endpoint reaches, hang under one root; each is cut down to the paths that lead to a changed
 *  card, so what changed is visible without unfolding anything. No `vscode` here: tested on its own.
 *--------------------------------------------------------------------------------------------*/

import { tableKey } from './poly/db';
import type { FlowNode } from './providers';

/** A changed table as the change set marks it: the entity that changed, and the table its endpoints reach. */
export interface ChangedTableMark {
	entity: string;
	table: string;
	guess: boolean;
}

/**
 * The part of a flow that leads to a change: a card stays when it changed or something it calls did. A changed card keeps
 * its direct callees (without theirs) so the change is read with what it calls. Null when nothing in the flow changed.
 * A database card whose entity changed (`tableChange`) is a changed card: the path to it stays.
 */
export function pruneToChanged(node: FlowNode): FlowNode | null {
	const kept = node.children.flatMap(c => {
		const n = pruneToChanged(c.node);
		return n ? [{ ...c, node: n }] : [];
	});
	if (node.diff || node.tableChange) {
		const callees = node.children.filter(c => !kept.some(k => k.node.key === c.node.key)).map(c => ({ ...c, node: { ...c.node, children: [] } }));
		const order = new Map(node.children.map((c, i) => [c.node.key, i]));
		return { ...node, children: [...kept, ...callees].sort((a, b) => order.get(a.node.key)! - order.get(b.node.key)!) };
	}
	return kept.length ? { ...node, children: kept } : null;
}

/**
 * Marks the database cards of a flow that read or write one of `tables` as changed (the entity behind the card was edited), in place.
 * Returns how many cards were marked, so a flow that does not reach any of them can be left out.
 */
export function markTableChanges(node: FlowNode, tables: ChangedTableMark[]): number {
	let marked = 0;
	const hit = node.kind === 'db' && node.schema ? tables.find(t => tableKey(t.table) === tableKey(node.schema!.table)) : undefined;
	if (hit) {
		node.tableChange = { entity: hit.entity, table: hit.table, ...(hit.guess ? { guess: true } : {}) };
		marked++;
	}
	for (const c of node.children) {
		marked += markTableChanges(c.node, tables);
	}
	return marked;
}

/** The root item of a changed table: "Order changed → table orders", with how many endpoints read or write it. */
export function tableRoot(t: ChangedTableMark, sub: string, key: string): FlowNode {
	return {
		key,
		symbolId: null,
		label: `${t.entity} changed → table ${t.table.split('.').pop()}`,
		sub,
		kind: 'db',
		file: null,
		startLine: 0,
		endLine: 0,
		code: null,
		children: [],
		tableChange: { entity: t.entity, table: t.table, ...(t.guess ? { guess: true } : {}) },
	};
}

/** Card keys are unique inside one graph only: subtrees from several graphs on one canvas get a prefix each. */
export function rekey(node: FlowNode, prefix: string): FlowNode {
	return { ...node, key: `${prefix}${node.key}`, children: node.children.map(c => ({ ...c, node: rekey(c.node, prefix) })) };
}

/** Whether a card of `tree` shows this line of this file (paths compared the way Windows and VS Code may spell them). */
export function showsLine(tree: FlowNode, file: string, line: number): boolean {
	const same = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
	return (!!tree.file && same(tree.file, file) && tree.startLine <= line && line <= tree.endLine) || tree.children.some(c => showsLine(c.node, file, line));
}

/** The root card of a change set; `branches` are already pruned, each with keys of its own. */
export function changeSetRoot(label: string, sub: string, branches: FlowNode[]): FlowNode {
	return {
		key: 'changes',
		symbolId: null,
		label,
		sub,
		kind: 'external',
		file: null,
		startLine: 0,
		endLine: 0,
		code: null,
		children: branches.map(node => ({ callLine: 0, edgeKind: 'call', node })),
	};
}
