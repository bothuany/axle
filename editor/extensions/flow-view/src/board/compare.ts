/*---------------------------------------------------------------------------------------------
 *  Axle board compare: what changed between two versions of a design. The new board comes back with `change` set on every node and
 *  edge that is added or changed, and what the old one had and the new one lacks drawn again as removed (a ghost), so the canvas only
 *  has to colour by `change`. Used for a board with a `base` and for "what changed since the last draw". Pure: no `vscode`.
 *--------------------------------------------------------------------------------------------*/

import type { BoardEdge, BoardGroup, BoardNode, BoardSpec } from './spec';

export interface ChangeCounts {
	added: number;
	removed: number;
	changed: number;
}

const membersOf = (n: BoardNode) => (n.members ?? []).map(m => m.text).join('\n');

/** The parts of a node that make it a different design (progress and notes do not). */
function nodeSignature(n: BoardNode): string {
	return [n.label, n.kind, n.tech, n.shape, n.detail, n.group, n.symbol ?? n.file, membersOf(n)].join('\u0001');
}

const edgeKey = (e: BoardEdge) => `${e.from}>${e.to}|${e.kind ?? ''}`;

function edgeSignature(e: BoardEdge): string {
	return [e.label, e.order, e.style, e.async, e.guard, e.fromCard, e.toCard].join('\u0001');
}

/**
 * `next` with its changes against `base` marked. A `change` the agent already set is kept (it said what it meant). Removed nodes and
 * edges are copied in from `base`; their groups come along when `next` lacks them. The result is a new spec; neither input changes.
 */
export function compareBoards(base: BoardSpec, next: BoardSpec): BoardSpec {
	const before = new Map(base.nodes.map(n => [n.id, n]));
	const nodes: BoardNode[] = next.nodes.map(n => {
		const old = before.get(n.id);
		if (n.change) {
			return n;
		}
		if (!old) {
			return { ...n, change: 'added' };
		}
		return nodeSignature(old) === nodeSignature(n) ? n : { ...n, change: 'changed' };
	});
	const have = new Set(next.nodes.map(n => n.id));
	const groups = new Map((next.groups ?? []).map(g => [g.id, g]));
	const baseGroups = new Map((base.groups ?? []).map(g => [g.id, g]));
	const adopt = (id: string | undefined) => {
		for (let g = id ? baseGroups.get(id) : undefined, n = 0; g && !groups.has(g.id) && n < 8; g = g.parent ? baseGroups.get(g.parent) : undefined, n++) {
			groups.set(g.id, g);
		}
	};
	for (const old of base.nodes) {
		if (!have.has(old.id)) {
			adopt(old.group);
			nodes.push({ ...old, change: 'removed', check: undefined, checkNote: undefined, warn: undefined });
			have.add(old.id);
		}
	}
	const oldEdges = new Map(base.edges.map(e => [edgeKey(e), e]));
	const edges: BoardEdge[] = next.edges.map(e => {
		const old = oldEdges.get(edgeKey(e));
		if (e.change) {
			return e;
		}
		if (!old) {
			return { ...e, change: 'added' };
		}
		return edgeSignature(old) === edgeSignature(e) ? e : { ...e, change: 'changed' };
	});
	const kept = new Set(next.edges.map(edgeKey));
	for (const old of base.edges) {
		if (!kept.has(edgeKey(old)) && have.has(old.from) && have.has(old.to)) {
			edges.push({ ...old, change: 'removed', fragment: old.fragment && groups.has(old.fragment) ? old.fragment : undefined });
		}
	}
	return { ...next, nodes, edges, groups: groups.size ? [...groups.values()] as BoardGroup[] : undefined };
}

/** How many nodes and edges carry each change mark. */
export function countChanges(spec: BoardSpec): ChangeCounts {
	const out: ChangeCounts = { added: 0, removed: 0, changed: 0 };
	for (const x of [...spec.nodes, ...spec.edges]) {
		if (x.change) {
			out[x.change]++;
		}
	}
	return out;
}

/** True when a board has any change mark. */
export const hasChanges = (spec: BoardSpec) => spec.nodes.some(n => n.change) || spec.edges.some(e => e.change);
