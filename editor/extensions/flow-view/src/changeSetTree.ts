/*---------------------------------------------------------------------------------------------
 *  Axle: one canvas for a whole change set. The flows of the endpoints a change reaches, and the changed
 *  methods no endpoint reaches, hang under one root; each is cut down to the paths that lead to a changed
 *  card, so what changed is visible without unfolding anything. No `vscode` here: tested on its own.
 *--------------------------------------------------------------------------------------------*/

import type { FlowNode } from './providers';

/**
 * The part of a flow that leads to a change: a card stays when it changed or something it calls did. A changed card keeps
 * its direct callees (without theirs) so the change is read with what it calls. Null when nothing in the flow changed.
 */
export function pruneToChanged(node: FlowNode): FlowNode | null {
	const kept = node.children.flatMap(c => {
		const n = pruneToChanged(c.node);
		return n ? [{ ...c, node: n }] : [];
	});
	if (node.diff) {
		const callees = node.children.filter(c => !kept.some(k => k.node.key === c.node.key)).map(c => ({ ...c, node: { ...c.node, children: [] } }));
		const order = new Map(node.children.map((c, i) => [c.node.key, i]));
		return { ...node, children: [...kept, ...callees].sort((a, b) => order.get(a.node.key)! - order.get(b.node.key)!) };
	}
	return kept.length ? { ...node, children: kept } : null;
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
