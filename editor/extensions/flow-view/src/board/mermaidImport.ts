/*---------------------------------------------------------------------------------------------
 *  Axle boards from Mermaid text: draw_board accepts `source: { mermaid }` for text an agent already has (a README, a design doc) and
 *  turns a sequence diagram, a state diagram or a flowchart into a board. JSON stays the wire format and the board the model: this
 *  only reads a small, common part of each Mermaid syntax, line by line, and says in line-numbered messages what it could not read or
 *  had to leave out. It never renders anything and runs no Mermaid code. Input is capped (size and lines) and every pattern is
 *  anchored and linear. Pure: no `vscode`.
 *--------------------------------------------------------------------------------------------*/

export const MAX_MERMAID_CHARS = 60_000;
export const MAX_MERMAID_LINES = 800;
/** The board's own limits (spec.ts), checked while reading: a line like `a&b&c --> d&e&f` must not build millions of edges before parseBoard looks. */
const MAX_NODES = 400;
const MAX_EDGES = 1200;
const MAX_GROUPS = 100;

/** Throws once a diagram holds more than a board can. */
function within(nodes: unknown[], edges: unknown[], groups: unknown[] = []): void {
	if (nodes.length > MAX_NODES || edges.length > MAX_EDGES || groups.length > MAX_GROUPS) {
		throw new Error(`The Mermaid diagram has more than a board holds (${MAX_NODES} nodes, ${MAX_EDGES} edges, ${MAX_GROUPS} groups). Split it into several boards.`);
	}
}

/** A board as an agent would send it (before parseBoard checks it). */
export interface ImportedBoard {
	kind: 'sequence' | 'state' | 'flow';
	title?: string;
	direction?: 'LR' | 'TB';
	nodes: Record<string, unknown>[];
	edges: Record<string, unknown>[];
	groups?: Record<string, unknown>[];
	callouts?: Record<string, unknown>[];
}

export interface ImportResult {
	board: ImportedBoard;
	/** What was left out or approximated, with line numbers. */
	notes: string[];
}

const SUPPORTED = 'sequenceDiagram, stateDiagram-v2 (or stateDiagram) and flowchart (or graph)';
const clip = (s: string, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

interface Line { no: number; text: string }

/** The meaningful lines: comments, blank lines and the `---` front matter (whose `title:` is kept) are taken out. */
function lines(source: string): { lines: Line[]; title?: string } {
	if (source.length > MAX_MERMAID_CHARS) {
		throw new Error(`The Mermaid text is ${source.length} characters; at most ${MAX_MERMAID_CHARS} are read. Split the diagram, or send it as a board.`);
	}
	const raw = source.replace(/\r\n?/g, '\n').split('\n');
	if (raw.length > MAX_MERMAID_LINES) {
		throw new Error(`The Mermaid text has ${raw.length} lines; at most ${MAX_MERMAID_LINES} are read. Split the diagram, or send it as a board.`);
	}
	let title: string | undefined;
	let i = 0;
	while (i < raw.length && !raw[i].trim()) {
		i++;
	}
	if (raw[i]?.trim() === '---') {
		for (i++; i < raw.length && raw[i].trim() !== '---'; i++) {
			const m = /^\s*title\s*:\s*(.+?)\s*$/.exec(raw[i]);
			if (m) {
				title = m[1].replace(/^["']|["']$/g, '');
			}
		}
		i++;
	}
	const out: Line[] = [];
	for (; i < raw.length; i++) {
		// `%%` starts a comment (and `%%{init}%%` a directive): both are dropped.
		const text = raw[i].replace(/%%.*$/, '').trim();
		if (text) {
			out.push({ no: i + 1, text });
		}
	}
	return { lines: out, title };
}

class Problems {
	readonly list: string[] = [];
	add(no: number, message: string) {
		this.list.push(`line ${no}: ${message}`);
	}
	throwIf(kind: string) {
		if (this.list.length) {
			throw new Error(`Could not read the ${kind}:\n${this.list.slice(0, 6).join('\n')}${this.list.length > 6 ? `\n...and ${this.list.length - 6} more.` : ''}\nFix those lines and send it again, or send the diagram as a board.`);
		}
	}
}

const ENTITIES: Record<string, string> = { quot: '"', gt: '>', lt: '<', amp: '&' };

/** Mermaid's `#gt;` style entities (what toMermaid writes) back to the characters. */
export const decode = (s: string) => s.replace(/#(quot|gt|lt|amp|\d{1,5});/g, (all, name: string) => ENTITIES[name] ?? (Number(name) > 0 && Number(name) < 0x10000 ? String.fromCharCode(Number(name)) : all));

const TEXT_FIELDS = ['label', 'detail', 'guard', 'text'];

function decoded(board: ImportedBoard): ImportedBoard {
	for (const list of [board.nodes, board.edges, board.groups ?? [], board.callouts ?? []]) {
		for (const x of list) {
			for (const f of TEXT_FIELDS) {
				if (typeof x[f] === 'string') {
					x[f] = decode(x[f] as string);
				}
			}
		}
	}
	if (board.title) {
		board.title = decode(board.title);
	}
	return board;
}

/** Reads a Mermaid sequence, state or flow diagram into a board; throws a line-numbered message when it cannot. */
export function importMermaid(source: string): ImportResult {
	if (typeof source !== 'string' || !source.trim()) {
		throw new Error('`source.mermaid` must be the text of a Mermaid diagram.');
	}
	const { lines: all, title } = lines(source);
	if (!all.length) {
		throw new Error('The Mermaid text has no diagram in it.');
	}
	const head = all[0].text;
	const rest = all.slice(1);
	let result: ImportResult;
	if (/^sequenceDiagram\b/.test(head)) {
		result = sequence(rest);
	} else if (/^stateDiagram(-v2)?\b/.test(head)) {
		result = state(rest);
	} else if (/^(flowchart|graph)\b/.test(head)) {
		result = flow(head, rest);
	} else {
		throw new Error(`line ${all[0].no}: \`${clip(head)}\` is not a diagram type this reads. Supported: ${SUPPORTED}. For a class or ER diagram send a board.`);
	}
	if (title && !result.board.title) {
		result.board.title = title;
	}
	decoded(result.board);
	return result;
}

// ---- sequence ---------------------------------------------------------------------------------------------

const SEQ_ARROW = /^([\w.]+)\s*(-->>|->>|--\)|-\)|--x|-x|-->|->)\s*([+-]?)\s*([\w.]+)\s*:\s*(.*)$/;
const SEQ_PARTICIPANT = /^(participant|actor)\s+([\w.]+)(?:\s+as\s+(.+))?$/;
const SEQ_NOTE = /^note\s+(?:over|left of|right of)\s+([\w.]+)(?:\s*,\s*[\w.]+)?\s*:\s*(.*)$/i;

function sequence(rest: Line[]): ImportResult {
	const nodes: Record<string, unknown>[] = [];
	const edges: Record<string, unknown>[] = [];
	const groups: Record<string, unknown>[] = [];
	const callouts: Record<string, unknown>[] = [];
	const notes: string[] = [];
	const problems = new Problems();
	let title: string | undefined;
	const known = new Set<string>();
	const ensure = (id: string, label?: string, actor?: boolean) => {
		if (!known.has(id)) {
			known.add(id);
			nodes.push({ id, label: label ?? id, ...(actor ? { kind: 'actor' } : {}) });
		} else if (label !== undefined) {
			const n = nodes.find(x => x.id === id)!;
			n.label = label;
			if (actor) {
				n.kind = 'actor';
			}
		}
	};
	// Open boxes, innermost last: the group id of an alt/opt/loop, or undefined for a block that is read through (`rect`, `par`).
	const open: { id?: string; kind: string }[] = [];
	const current = () => [...open].reverse().find(f => f.id)?.id;
	let order = 0;
	let frames = 0;
	for (const { no, text } of rest) {
		within(nodes, edges, groups);
		let m: RegExpExecArray | null;
		if (/^(autonumber|activate|deactivate|box|end box)\b/.test(text)) {
			continue;
		} else if ((m = /^title\s*:?\s*(.+)$/i.exec(text))) {
			title = m[1];
		} else if ((m = SEQ_PARTICIPANT.exec(text))) {
			ensure(m[2], m[3]?.trim(), m[1] === 'actor');
		} else if ((m = SEQ_NOTE.exec(text))) {
			ensure(m[1]);
			callouts.push({ node: m[1], text: m[2] });
		} else if ((m = /^(alt|opt|loop)\b\s*(.*)$/.exec(text))) {
			const id = `f${++frames}`;
			groups.push({ id, label: m[2] || m[1], kind: m[1], ...(open.length && current() ? { parent: current() } : {}) });
			open.push({ id, kind: m[1] });
		} else if ((m = /^else\b\s*(.*)$/.exec(text))) {
			const top = open[open.length - 1];
			if (!top?.id || top.kind !== 'alt') {
				problems.add(no, '`else` outside an `alt` block.');
				continue;
			}
			// The else branch is a group of the same kind whose parent is the alt, and it replaces the alt as the current box.
			const id = `f${++frames}`;
			groups.push({ id, label: m[1] || 'else', kind: 'alt', parent: top.id });
			open[open.length - 1] = { id, kind: 'alt-else' };
		} else if ((m = /^(par|and|critical|option|break|rect)\b/.exec(text))) {
			if (m[1] === 'and' || m[1] === 'option') {
				continue;
			}
			notes.push(`line ${no}: a \`${m[1]}\` block is not drawn as a box; its messages are drawn in order.`);
			open.push({ kind: m[1] });
		} else if (text === 'end') {
			if (!open.length) {
				problems.add(no, '`end` without an open `alt`, `opt` or `loop`.');
			} else {
				open.pop();
			}
		} else if ((m = SEQ_ARROW.exec(text))) {
			ensure(m[1]);
			ensure(m[4]);
			const arrow = m[2];
			const fragment = current();
			edges.push({
				from: m[1],
				to: m[4],
				label: m[5].replace(/<br\s*\/?>/gi, ' ').trim() || undefined,
				order: ++order,
				...(arrow.startsWith('--') ? { style: 'dashed' } : {}),
				...(arrow.endsWith(')') ? { async: true } : {}),
				...(fragment ? { fragment } : {}),
			});
			if (arrow.endsWith('x')) {
				notes.push(`line ${no}: the lost-message arrow \`${arrow}\` is drawn as a plain message.`);
			}
		} else {
			problems.add(no, `\`${clip(text)}\` is not a participant, a message, a note or a block this reads.`);
		}
	}
	if (open.length) {
		problems.add(rest[rest.length - 1]?.no ?? 1, `${open.length} block(s) are not closed with \`end\`.`);
	}
	problems.throwIf('sequence diagram');
	if (!nodes.length) {
		throw new Error('The sequence diagram has no participants.');
	}
	return { board: { kind: 'sequence', title, nodes, edges, ...(groups.length ? { groups } : {}), ...(callouts.length ? { callouts } : {}) }, notes };
}

// ---- state ------------------------------------------------------------------------------------------------

const STATE_ARROW = /^(\[\*\]|[\w.]+)\s*-->\s*(\[\*\]|[\w.]+)(?:\s*:\s*(.*))?$/;

function state(rest: Line[]): ImportResult {
	const nodes: Record<string, unknown>[] = [];
	const edges: Record<string, unknown>[] = [];
	const groups: Record<string, unknown>[] = [];
	const callouts: Record<string, unknown>[] = [];
	const notes: string[] = [];
	const problems = new Problems();
	let direction: 'LR' | 'TB' | undefined;
	const known = new Map<string, Record<string, unknown>>();
	const scopes: string[] = [];
	const scope = () => scopes[scopes.length - 1];
	const ensure = (id: string) => {
		let n = known.get(id);
		if (!n) {
			n = { id, label: id, ...(scope() ? { group: scope() } : {}) };
			known.set(id, n);
			nodes.push(n);
		}
		return n;
	};
	// `[*]` is the start when it is a source and the end when it is a target; one of each per composite state.
	const mark = (which: 'initial' | 'final') => {
		const id = `__${which === 'initial' ? 'start' : 'end'}${scope() ? `_${scope()}` : ''}`;
		if (!known.has(id)) {
			const n = { id, label: which === 'initial' ? 'start' : 'end', shape: which, ...(scope() ? { group: scope() } : {}) };
			known.set(id, n);
			nodes.push(n);
		}
		return id;
	};
	for (const { no, text } of rest) {
		within(nodes, edges, groups);
		let m: RegExpExecArray | null;
		if ((m = /^direction\s+(LR|RL|TB|BT|TD)\s*$/.exec(text))) {
			direction = m[1] === 'LR' || m[1] === 'RL' ? 'LR' : 'TB';
		} else if ((m = STATE_ARROW.exec(text))) {
			const from = m[1] === '[*]' ? mark('initial') : ensure(m[1]).id as string;
			const to = m[2] === '[*]' ? mark('final') : ensure(m[2]).id as string;
			const edge: Record<string, unknown> = { from, to };
			if (m[3]) {
				// "event [guard]": the bracket at the end is the guard.
				const g = /^(.*?)\s*\[([^\]]{1,80})\]\s*$/.exec(m[3]);
				const label = (g ? g[1] : m[3]).trim();
				if (label) {
					edge.label = label;
				}
				if (g) {
					edge.guard = g[2];
				}
			}
			edges.push(edge);
		} else if ((m = /^state\s+"([^"]*)"\s+as\s+([\w.]+)\s*$/.exec(text))) {
			ensure(m[2]).label = m[1];
		} else if ((m = /^state\s+([\w.]+)\s*<<(choice|fork|join)>>\s*$/.exec(text))) {
			const n = ensure(m[1]);
			n.shape = 'choice';
			n.label = m[1];
			if (m[2] !== 'choice') {
				notes.push(`line ${no}: <<${m[2]}>> is drawn as a choice mark.`);
			}
		} else if ((m = /^state\s+(?:"([^"]*)"\s+as\s+)?([\w.]+)\s*\{$/.exec(text))) {
			groups.push({ id: m[2], label: m[1] ?? m[2], kind: 'layer', ...(scope() ? { parent: scope() } : {}) });
			scopes.push(m[2]);
		} else if (text === '}') {
			if (!scopes.length) {
				problems.add(no, '`}` without an open composite `state ... {`.');
			} else {
				scopes.pop();
			}
		} else if ((m = /^note\s+(?:left of|right of|over)\s+([\w.]+)\s*:\s*(.*)$/i.exec(text))) {
			ensure(m[1]);
			callouts.push({ node: m[1], text: m[2] });
		} else if (text === '--') {
			notes.push(`line ${no}: concurrent regions (\`--\`) are drawn as one diagram.`);
		} else if ((m = /^([\w.]+)\s*:\s*(.+)$/.exec(text))) {
			ensure(m[1]).detail = m[2];
		} else if (/^(classDef|class|style|hide empty description|scale)\b/.test(text)) {
			continue;
		} else if ((m = /^state\s+([\w.]+)\s*$/.exec(text))) {
			ensure(m[1]);
		} else {
			problems.add(no, `\`${clip(text)}\` is not a transition, a state, a note or a direction this reads.`);
		}
	}
	if (scopes.length) {
		problems.add(rest[rest.length - 1]?.no ?? 1, `${scopes.length} composite state(s) are not closed with \`}\`.`);
	}
	problems.throwIf('state diagram');
	if (!nodes.length) {
		throw new Error('The state diagram has no states.');
	}
	return { board: { kind: 'state', ...(direction ? { direction } : {}), nodes, edges, ...(groups.length ? { groups } : {}), ...(callouts.length ? { callouts } : {}) }, notes };
}

// ---- flowchart --------------------------------------------------------------------------------------------

/** Node openers, longest first, with what closes them and how the node is drawn. */
const SHAPES: { open: string; close: string; draw: Record<string, unknown> }[] = [
	{ open: '[(', close: ')]', draw: { shape: 'cylinder' } },
	{ open: '([', close: '])', draw: { shape: 'round' } },
	{ open: '[[', close: ']]', draw: { kind: 'external' } },
	{ open: '((', close: '))', draw: { shape: 'round' } },
	{ open: '{{', close: '}}', draw: {} },
	{ open: '[/', close: '/]', draw: {} },
	{ open: '[\\', close: '\\]', draw: {} },
	{ open: '[', close: ']', draw: {} },
	{ open: '(', close: ')', draw: { shape: 'round' } },
	{ open: '{', close: '}', draw: { kind: 'decision' } },
	{ open: '>', close: ']', draw: { kind: 'note' } },
];

interface Ref { ids: string[]; end: number }

const WORD = /[\w.]/;

/** Declares the nodes of one statement and leaves the position after them: `A`, `A[text]`, `A & B`. */
function readRefs(s: string, at: number, declare: (id: string, label?: string, draw?: Record<string, unknown>) => void): Ref | undefined {
	const ids: string[] = [];
	let i = at;
	for (;;) {
		while (s[i] === ' ') {
			i++;
		}
		const start = i;
		while (i < s.length && WORD.test(s[i])) {
			i++;
		}
		if (i === start) {
			return ids.length ? { ids, end: i } : undefined;
		}
		const id = s.slice(start, i);
		let label: string | undefined;
		let draw: Record<string, unknown> | undefined;
		const shape = SHAPES.find(sh => s.startsWith(sh.open, i));
		if (shape) {
			const from = i + shape.open.length;
			let to: number;
			let text: string;
			if (s[from] === '"') {
				const q = s.indexOf('"', from + 1);
				if (q < 0 || !s.startsWith(shape.close, q + 1)) {
					return undefined;
				}
				text = s.slice(from + 1, q);
				to = q + 1;
			} else {
				to = s.indexOf(shape.close, from);
				if (to < 0) {
					return undefined;
				}
				text = s.slice(from, to);
			}
			label = text.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
			draw = shape.draw;
			i = to + shape.close.length;
		}
		declare(id, label, draw);
		ids.push(id);
		let j = i;
		while (s[j] === ' ') {
			j++;
		}
		if (s[j] === '&') {
			i = j + 1;
			continue;
		}
		return { ids, end: i };
	}
}

interface Arrow { end: number; label?: string; dashed: boolean; thick: boolean }

/** The link after a node: `-->`, `---`, `-.->`, `==>`, with `|text|` after it or `-- text -->` inside it. */
function readArrow(s: string, at: number): Arrow | undefined {
	let i = at;
	while (s[i] === ' ') {
		i++;
	}
	const rest = s.slice(i);
	let label: string | undefined;
	let m: RegExpExecArray | null;
	let dashed = false;
	let thick = false;
	let len: number;
	if ((m = /^(-\.+->|-\.+-)/.exec(rest))) {
		dashed = true;
		len = m[1].length;
	} else if ((m = /^(==+>|===+)/.exec(rest))) {
		thick = true;
		len = m[1].length;
	} else if ((m = /^(--+>|---+|--[xo])/.exec(rest))) {
		len = m[1].length;
	} else if ((m = /^(--|-\.|==)\s+/.exec(rest))) {
		// "-- text -->", "-. text .->", "== text ==>": the text sits inside the link.
		const closers = m[1] === '--' ? ['-->', '---'] : m[1] === '-.' ? ['.->', '.-'] : ['==>', '==='];
		const start = m[0].length;
		const hit = closers.map(c => ({ c, at: rest.indexOf(c, start) })).filter(x => x.at >= 0).sort((a, b) => a.at - b.at)[0];
		if (!hit) {
			return undefined;
		}
		label = rest.slice(start, hit.at).trim();
		dashed = m[1] === '-.';
		thick = m[1] === '==';
		len = hit.at + hit.c.length;
	} else {
		return undefined;
	}
	let end = i + len;
	let j = end;
	while (s[j] === ' ') {
		j++;
	}
	if (s[j] === '|') {
		const close = s.indexOf('|', j + 1);
		if (close > 0) {
			label = s.slice(j + 1, close).replace(/^"|"$/g, '').replace(/<br\s*\/?>/gi, ' ').trim();
			end = close + 1;
		}
	}
	return { end, label: label || undefined, dashed, thick };
}

function flow(head: string, rest: Line[]): ImportResult {
	const nodes: Record<string, unknown>[] = [];
	const edges: Record<string, unknown>[] = [];
	const groups: Record<string, unknown>[] = [];
	const notes: string[] = [];
	const problems = new Problems();
	const dir = /^(?:flowchart|graph)\s+(LR|RL|TB|TD|BT)\b/.exec(head)?.[1];
	const known = new Map<string, Record<string, unknown>>();
	const scopes: string[] = [];
	const scope = () => scopes[scopes.length - 1];
	const declare = (id: string, label?: string, draw?: Record<string, unknown>) => {
		let n = known.get(id);
		if (!n) {
			n = { id, label: id, ...(scope() ? { group: scope() } : {}) };
			known.set(id, n);
			nodes.push(n);
			within(nodes, edges, groups);
		}
		// A node named inside a subgraph belongs to it, even when an earlier line already drew it.
		if (scope() && n.group === undefined) {
			n.group = scope();
		}
		if (label !== undefined) {
			n.label = label;
		}
		if (draw) {
			Object.assign(n, draw);
		}
	};
	let ignored = 0;
	for (const { no, text } of rest) {
		let m: RegExpExecArray | null;
		if ((m = /^subgraph\s+(.+)$/.exec(text))) {
			// `subgraph id [Title]`, `subgraph "Title"` or `subgraph Title`.
			const t = /^([\w.]+)\s*\[\s*"?([^\]"]*)"?\s*\]$/.exec(m[1]);
			const label = t ? t[2] : m[1].replace(/^"|"$/g, '');
			const id = t ? t[1] : `g${groups.length + 1}`;
			groups.push({ id, label, ...(scope() ? { parent: scope() } : {}) });
			scopes.push(id);
		} else if (text === 'end') {
			if (!scopes.length) {
				problems.add(no, '`end` without an open `subgraph`.');
			} else {
				scopes.pop();
			}
		} else if (/^(classDef|class|style|linkStyle|click|direction)\b/.test(text)) {
			ignored++;
		} else {
			const first = readRefs(text, 0, declare);
			if (!first) {
				problems.add(no, `\`${clip(text)}\` is not a node or a link this reads.`);
				continue;
			}
			let from = first;
			let at = first.end;
			let linked = false;
			for (;;) {
				while (text[at] === ' ') {
					at++;
				}
				if (at >= text.length || text[at] === ';') {
					break;
				}
				const arrow = readArrow(text, at);
				const to = arrow ? readRefs(text, arrow.end, declare) : undefined;
				if (!arrow || !to) {
					problems.add(no, `\`${clip(text.slice(at))}\` is not a link to a node (\`A --> B\`, \`A -->|text| B\`).`);
					break;
				}
				for (const a of from.ids) {
					for (const b of to.ids) {
						within(nodes, edges, groups);
						edges.push({ from: a, to: b, ...(arrow.label ? { label: arrow.label } : {}), ...(arrow.dashed ? { style: 'dashed' } : {}), ...(arrow.thick ? { kind: 'writes' } : {}) });
					}
				}
				linked = true;
				from = to;
				at = to.end;
			}
			void linked;
		}
	}
	if (scopes.length) {
		problems.add(rest[rest.length - 1]?.no ?? 1, `${scopes.length} subgraph(s) are not closed with \`end\`.`);
	}
	problems.throwIf('flowchart');
	if (!nodes.length) {
		throw new Error('The flowchart has no nodes.');
	}
	if (ignored) {
		notes.push(`${ignored} styling line(s) (classDef, class, style, linkStyle, click) were ignored.`);
	}
	return { board: { kind: 'flow', ...(dir ? { direction: dir === 'LR' || dir === 'RL' ? 'LR' : 'TB' } : {}), nodes, edges, ...(groups.length ? { groups } : {}) }, notes };
}
