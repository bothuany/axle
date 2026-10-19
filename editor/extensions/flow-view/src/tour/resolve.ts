/*---------------------------------------------------------------------------------------------
 *  Axle: where a tour step points. An agent (or a tour file) names code by file, method and a line hint; the code moves, so the
 *  name is the anchor and the line only a hint. This turns one step into the current file lines the canvas needs, and says how
 *  it went: ok, moved, missing, or (once the drawn flow is known) offflow. A step that cannot be placed is never given a wrong
 *  place. Pure: no `vscode`; the host feeds it the file's methods and text, so it is tested under plain Node.
 *--------------------------------------------------------------------------------------------*/

import type { FlowNode, TourStep } from '../../../../../protocol/flow';

/** What a step may say about the code it points at (the same fields in a tool call and in a tour file). */
export interface StepInput {
	title?: string;
	caption: string;
	method?: string;
	line?: number;
	lines?: [number, number][];
	table?: string;
}

export interface Method {
	name: string;
	startLine: number;
	endLine: number;
}

export interface Placed {
	step: TourStep;
	/** What the agent should read about this step: where the method went, what is closest to a name that is gone. */
	note?: string;
}

export const MAX_HIGHLIGHTS = 3;
export const MAX_HIGHLIGHT_LINES = 80;
const PEEK_LINES = 40;
/** A peek card shows code, not a minified bundle: each line is cut here, and the whole peek stays a few KB. */
const PEEK_LINE_CHARS = 300;
const PEEK_CHARS = 8_000;

export const positive = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10_000_000;

/** Up to three `[from, to]` ranges of at most 80 lines each; a range that is not two positive integers is dropped. */
export function parseHighlights(raw: unknown): [number, number][] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const out: [number, number][] = [];
	for (const r of raw) {
		if (out.length >= MAX_HIGHLIGHTS) {
			break;
		}
		const [a, b = a] = Array.isArray(r) ? r : [r];
		if (positive(a) && positive(b)) {
			const from = Math.min(a, b);
			out.push([from, Math.min(Math.max(a, b), from + MAX_HIGHLIGHT_LINES - 1)]);
		}
	}
	return out;
}

/** The code of a step that lands on no drawn card: its lines (or a window around the line), cut short. */
export function peekOf(text: string, startLine: number, endLine: number): TourStep['peek'] {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const from = Math.max(1, startLine - 2);
	const to = Math.min(lines.length, Math.max(endLine, startLine + 12), from + PEEK_LINES - 1);
	return from > lines.length ? undefined : { code: lines.slice(from - 1, to).map(l => l.slice(0, PEEK_LINE_CHARS)).join('\n').slice(0, PEEK_CHARS), startLine: from };
}

const segments = (name: string) => name.toLowerCase().split(/[.#:\u25b8\s/\\]+/).filter(Boolean);

/** "OrderService.Place" matches a method called that, or one whose qualified name ends with it, or (when no owner is given) the same last segment. */
export function nameMatches(name: string, wanted: string): boolean {
	const n = segments(name);
	const w = segments(wanted);
	if (!w.length || !n.length) {
		return false;
	}
	return n.slice(-w.length).join('.') === w.join('.');
}

function distance(a: string, b: string): number {
	const row = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let prev = row[0];
		row[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const keep = row[j];
			row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
			prev = keep;
		}
	}
	return row[b.length];
}

/** The names closest to one that was not found (a rename, a typo, an overload with a suffix), the same owner first: at most three. */
export function closestNames(methods: readonly Method[], wanted: string): string[] {
	const w = segments(wanted);
	const last = w.pop() ?? '';
	return [...new Set(methods.map(m => m.name))]
		.map(name => {
			const n = segments(name);
			const l = n.pop() ?? '';
			const sameOwner = w.length > 0 && n.slice(-w.length).join('.') === w.join('.') ? 0 : 1;
			return { name, d: l.startsWith(last) || last.startsWith(l) ? 0 : distance(l, last), sameOwner };
		})
		.filter(c => c.d <= Math.max(3, Math.floor(last.length / 3)))
		.sort((x, y) => x.d - y.d || x.sameOwner - y.sameOwner)
		.slice(0, 3)
		.map(c => c.name);
}

const within = (m: Method, line: number) => m.startLine <= line && line <= m.endLine;
const gap = (m: Method, line: number) => (within(m, line) ? 0 : Math.min(Math.abs(m.startLine - line), Math.abs(m.endLine - line)));

export interface Where {
	/** The step's file, absolute, inside the workspace; nothing for a caption-only step or a table step. */
	file?: string;
	/** The file's methods when the host could list them; nothing when it could not (the step is then placed by its line). */
	methods?: readonly Method[];
	/** The file's text; nothing when it cannot be read. */
	text?: string;
	/** The file's name for a label, when no method is found. */
	base?: string;
}

/**
 * One step, placed. `method` is the anchor and `line` a hint: the method is looked up by name, and the step says `moved` when
 * the hint lies outside it. With a line only, the innermost method holding it. With neither, the step is `missing`.
 */
export function placeStep(input: StepInput, where: Where): Placed {
	const caption = input.caption;
	const step: TourStep = { title: input.title || input.method || '', caption, state: 'ok' };
	if (input.table) {
		// A database card: it is found by its table name on the drawn flow (markOffFlow checks that).
		step.title ||= input.table;
		step.at = { file: '', startLine: 0, endLine: 0, label: input.table, table: input.table };
		return { step };
	}
	if (!where.file) {
		return { step };
	}
	const highlights = parseHighlights(input.lines);
	const hint = input.line ?? highlights[0]?.[0];
	const missing = (why: string): Placed => {
		step.state = 'missing';
		step.title ||= where.base || 'Step';
		step.at = { file: where.file!, startLine: hint ?? 0, endLine: hint ?? 0, label: input.method || where.base || '' };
		return { step, note: why };
	};
	if (where.text === undefined) {
		return missing('the file cannot be read (not found, not a regular file, or outside the workspace)');
	}
	let range: { start: number; end: number; label: string } | undefined;
	let note: string | undefined;
	if (input.method) {
		const all = where.methods ?? [];
		const found = all.filter(m => nameMatches(m.name, input.method!));
		if (found.length) {
			const best = hint ? found.reduce((x, y) => (gap(y, hint) < gap(x, hint) ? y : x)) : found[0];
			range = { start: best.startLine, end: best.endLine, label: best.name };
			if (hint && !within(best, hint)) {
				step.state = 'moved';
				note = `you said line ${hint}; the method is now at ${best.startLine}-${best.endLine}`;
			}
			if (found.length > 1) {
				note = `${note ? `${note}; ` : ''}${found.length} methods are called ${input.method}: took the one nearest${hint ? ` line ${hint}` : ' the top of the file'}`;
			}
		} else if (where.methods) {
			const near = closestNames(all, input.method);
			return missing(`no method "${input.method}" in the file${near.length ? ` (closest: ${near.join(', ')})` : ''}`);
		} else if (hint) {
			note = 'the methods of this file could not be listed: placed by line';
		} else {
			return missing(`the methods of this file could not be listed, so "${input.method}" cannot be found: give a line`);
		}
	}
	if (!range && hint) {
		const inner = where.methods?.filter(m => within(m, hint)).sort((x, y) => (x.endLine - x.startLine) - (y.endLine - y.startLine))[0];
		if (inner) {
			range = { start: inner.startLine, end: inner.endLine, label: inner.name };
		} else {
			range = { start: hint, end: Math.max(hint, ...highlights.map(h => h[1])), label: input.method || (where.base ? `${where.base}:${hint}` : String(hint)) };
			if (where.methods) {
				note = `no method holds line ${hint}: placed by line`;
			}
		}
	}
	if (!range) {
		return missing('give `method`, or `line` inside it');
	}
	step.title ||= range.label;
	step.at = { file: where.file, startLine: range.start, endLine: range.end, label: range.label };
	if (highlights.length) {
		step.highlights = highlights;
		if (highlights.some(h => h[0] < range!.start || h[1] > range!.end) && where.methods && input.method) {
			note = `${note ? `${note}; ` : ''}a highlight lies outside the method`;
		}
	}
	step.peek = peekOf(where.text, range.start, range.end);
	return { step, note };
}

/** The same file under VS Code's spelling and a backend's (`C:\x\a.cs`, `c:/x/a.cs`). */
const key = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, d => d.toLowerCase());

/** What a drawn flow holds, flattened: each card's file and lines, and the table of a database card. */
export interface Drawn {
	file: string | null;
	startLine: number;
	endLine: number;
	table?: string;
}

export function drawnOf(...roots: (FlowNode | null | undefined)[]): Drawn[] {
	const out: Drawn[] = [];
	const walk = (n: FlowNode) => {
		out.push({ file: n.file, startLine: n.startLine, endLine: n.endLine, table: n.schema?.table });
		n.children.forEach(c => walk(c.node));
	};
	roots.forEach(r => r && walk(r));
	return out;
}

/**
 * Marks the steps no drawn card holds: a placed step becomes `offflow` (it is shown as a side card, with its own code), a table
 * step with no such card becomes `missing`. Returns what to tell the agent about each one that changed.
 */
export function markOffFlow(steps: TourStep[], drawn: readonly Drawn[]): Map<number, string> {
	const notes = new Map<number, string>();
	steps.forEach((s, i) => {
		const at = s.at;
		if (!at || (s.state !== 'ok' && s.state !== 'moved')) {
			return;
		}
		if (at.table) {
			if (!drawn.some(d => d.table?.toLowerCase() === at.table!.toLowerCase())) {
				s.state = 'missing';
				notes.set(i, `no card for table "${at.table}" on this flow`);
			}
			return;
		}
		if (!drawn.some(d => d.file && key(d.file) === key(at.file) && d.startLine <= at.startLine && at.startLine <= d.endLine)) {
			s.state = 'offflow';
			notes.set(i, 'not on this flow: shown as a side card');
		}
	});
	return notes;
}
