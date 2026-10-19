/*---------------------------------------------------------------------------------------------
 *  Axle board: one diagram format for everything that is drawn on its own canvas rather than
 *  traced from the code: the DTO relations, the architecture (UML) view, and flows or plans an
 *  agent draws. Hosts build a BoardSpec, the canvas renders it. Keep this file identical to
 *  ui/src/board/spec.ts (a test compares them).
 *--------------------------------------------------------------------------------------------*/

export type BoardKind = 'flow' | 'plan' | 'class' | 'er' | 'sequence' | 'architecture';

export type NodeKind =
	| 'entry' | 'controller' | 'service' | 'repository' | 'entity' | 'dto' | 'enum' | 'interface' | 'class'
	| 'external' | 'step' | 'decision' | 'note' | 'actor';

export type NodeStatus = 'todo' | 'doing' | 'done' | 'skipped' | 'blocked';

/** Skeleton first: how the code compares with a planned type or member. Set by the host only, never by an agent (parseBoard drops it). */
export type CheckState = 'matches' | 'missing' | 'differs';

export type EdgeKind =
	| 'calls' | 'extends' | 'implements' | 'uses' | 'has' | 'has-many' | 'depends'
	| 'next' | 'yes' | 'no' | 'reads' | 'writes' | 'message';

export interface BoardMember {
	text: string;
	kind?: 'field' | 'method' | 'property';
	/** UML visibility: + public, - private, # protected, ~ package. */
	visibility?: '+' | '-' | '#' | '~';
	/** The type another node is drawn for, so the member can link to it (an ER or class edge starts here). */
	ref?: string;
	/** Host-only (skeleton first): the member in the code against the plan, why, and a warning that the agent changed it. */
	check?: CheckState;
	checkNote?: string;
	warn?: string;
}

export interface BoardNode {
	/** Unique in the board. */
	id: string;
	label: string;
	kind?: NodeKind;
	/** One line under the label. */
	detail?: string;
	/** Group id (a layer, a service, a package). */
	group?: string;
	/** Where it lives: clicking opens it. */
	file?: string;
	line?: number;
	status?: NodeStatus;
	members?: BoardMember[];
	/** For plans: what the step changes, as free text. */
	note?: string;
	/** Host-only (skeleton first): the type in the code against the plan, why, and a warning that the agent changed it. */
	check?: CheckState;
	checkNote?: string;
	warn?: string;
}

export interface BoardEdge {
	from: string;
	to: string;
	label?: string;
	kind?: EdgeKind;
	/** ER cardinality at each end, e.g. '1' and '0..*'. */
	fromCard?: string;
	toCard?: string;
}

export interface BoardGroup {
	id: string;
	label: string;
	parent?: string;
	/** Drawn collapsed until opened. */
	collapsed?: boolean;
}

export interface BoardSpec {
	version: 1;
	kind: BoardKind;
	title: string;
	description?: string;
	direction?: 'LR' | 'TB';
	nodes: BoardNode[];
	edges: BoardEdge[];
	groups?: BoardGroup[];
}

const NODE_KINDS = new Set<string>(['entry', 'controller', 'service', 'repository', 'entity', 'dto', 'enum', 'interface', 'class', 'external', 'step', 'decision', 'note', 'actor']);
const EDGE_KINDS = new Set<string>(['calls', 'extends', 'implements', 'uses', 'has', 'has-many', 'depends', 'next', 'yes', 'no', 'reads', 'writes', 'message']);
const STATUSES = new Set<string>(['todo', 'doing', 'done', 'skipped', 'blocked']);
const BOARD_KINDS = new Set<string>(['flow', 'plan', 'class', 'er', 'sequence', 'architecture']);
export const MAX_NODES = 400;
export const MAX_EDGES = 1200;

/**
 * Checks and cleans a board that came from outside (an agent's tool call): unknown enum values are dropped,
 * dangling edges removed, ids made unique, sizes capped. Throws with a message an agent can act on.
 */
export function parseBoard(input: unknown): BoardSpec {
	if (typeof input !== 'object' || input === null) {
		throw new Error('A board must be an object: { kind, title, nodes, edges }.');
	}
	const raw = input as Record<string, unknown>;
	const kind = typeof raw.kind === 'string' && BOARD_KINDS.has(raw.kind) ? (raw.kind as BoardKind) : 'flow';
	const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 120) : 'Untitled';
	if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) {
		throw new Error('A board needs a non-empty "nodes" array: [{ id, label, kind?, detail?, file?, line?, status? }].');
	}
	if (raw.nodes.length > MAX_NODES) {
		throw new Error(`A board shows at most ${MAX_NODES} nodes; split it into several boards.`);
	}
	const seen = new Set<string>();
	const nodes: BoardNode[] = [];
	for (const n of raw.nodes as Record<string, unknown>[]) {
		if (typeof n !== 'object' || n === null) {
			continue;
		}
		const label = typeof n.label === 'string' ? n.label : typeof n.id === 'string' ? n.id : '';
		let id = typeof n.id === 'string' && n.id ? n.id : label;
		if (!id) {
			continue;
		}
		while (seen.has(id)) {
			id += '_';
		}
		seen.add(id);
		const members = Array.isArray(n.members)
			? (n.members as Record<string, unknown>[]).filter(m => typeof m?.text === 'string').slice(0, 60).map((m): BoardMember => ({
				text: String(m.text).slice(0, 200),
				kind: m.kind === 'field' || m.kind === 'method' || m.kind === 'property' ? m.kind : undefined,
				visibility: m.visibility === '+' || m.visibility === '-' || m.visibility === '#' || m.visibility === '~' ? m.visibility : undefined,
				ref: typeof m.ref === 'string' ? m.ref : undefined,
			}))
			: undefined;
		nodes.push({
			id,
			label: (label || id).slice(0, 120),
			kind: typeof n.kind === 'string' && NODE_KINDS.has(n.kind) ? (n.kind as NodeKind) : undefined,
			detail: typeof n.detail === 'string' ? n.detail.slice(0, 200) : undefined,
			group: typeof n.group === 'string' ? n.group : undefined,
			file: typeof n.file === 'string' ? n.file : undefined,
			line: typeof n.line === 'number' && Number.isFinite(n.line) ? Math.max(1, Math.floor(n.line)) : undefined,
			status: typeof n.status === 'string' && STATUSES.has(n.status) ? (n.status as NodeStatus) : undefined,
			members,
			note: typeof n.note === 'string' ? n.note.slice(0, 600) : undefined,
		});
	}
	const ids = new Set(nodes.map(n => n.id));
	const edges: BoardEdge[] = [];
	for (const e of (Array.isArray(raw.edges) ? raw.edges : []) as Record<string, unknown>[]) {
		if (typeof e?.from !== 'string' || typeof e?.to !== 'string' || !ids.has(e.from) || !ids.has(e.to)) {
			continue;
		}
		edges.push({
			from: e.from,
			to: e.to,
			label: typeof e.label === 'string' ? e.label.slice(0, 80) : undefined,
			kind: typeof e.kind === 'string' && EDGE_KINDS.has(e.kind) ? (e.kind as EdgeKind) : undefined,
			fromCard: typeof e.fromCard === 'string' ? e.fromCard.slice(0, 12) : undefined,
			toCard: typeof e.toCard === 'string' ? e.toCard.slice(0, 12) : undefined,
		});
		if (edges.length >= MAX_EDGES) {
			break;
		}
	}
	const groups = Array.isArray(raw.groups)
		? (raw.groups as Record<string, unknown>[]).filter(g => typeof g?.id === 'string' && typeof g?.label === 'string').map(g => ({
			id: String(g.id),
			label: String(g.label).slice(0, 80),
			parent: typeof g.parent === 'string' ? g.parent : undefined,
			collapsed: g.collapsed === true ? true : undefined,
		}))
		: undefined;
	return {
		version: 1,
		kind,
		title,
		description: typeof raw.description === 'string' ? raw.description.slice(0, 600) : undefined,
		direction: raw.direction === 'TB' ? 'TB' : raw.direction === 'LR' ? 'LR' : undefined,
		nodes,
		edges,
		groups,
	};
}
