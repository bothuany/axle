/*---------------------------------------------------------------------------------------------
 *  Axle: a tour file (a hand-written JSON, later a saved tour or a tour from a pull request) turned into the Tour the canvas
 *  plays. A tour file is untrusted input, like any tool call: paths stay inside the workspace, limits are checked, captions
 *  are plain text with control characters stripped, and every field that is not part of the format is dropped (there are
 *  deliberately no commands and no URIs in a tour). Pure: no `vscode`, so it is tested under plain Node and the MCP `tour`
 *  tool (phase 1) can reuse it.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import type { Tour, TourStep } from '../../../../../protocol/flow';

export const MAX_STEPS = 30;
export const MAX_CAPTION = 600;
export const MAX_TITLE = 120;
export const MAX_STEP_TITLE = 80;
const MAX_HIGHLIGHTS = 3;
const MAX_HIGHLIGHT_LINES = 80;
const PEEK_LINES = 40;
/** A peek card shows code, not a minified bundle: each line is cut here, and the whole peek stays a few KB. */
const PEEK_LINE_CHARS = 300;
const PEEK_CHARS = 8_000;

/** The canvas this tour wants to play on. Omitted: the canvas the user has open, else the flow of the first step's code. */
export interface TourFlow {
	/** An endpoint as written in the endpoint list: "POST /api/orders". */
	http?: string;
	/** An entry point id from the index. */
	id?: string;
	/** An absolute workspace file, and a line inside the method. */
	file?: string;
	line?: number;
	changes?: boolean;
}

export interface ParsedTour {
	tour: Tour;
	flow: TourFlow | undefined;
}

export class TourFileError extends Error { }

export interface TourFileHost {
	/** Absolute paths of the workspace folders: a step may only point at code inside one. */
	roots: string[];
	/** The file's text, or nothing when it cannot be read. Used for the peek card of a step that is on no drawn flow. */
	readText(file: string): string | undefined;
}

/** `file` as an absolute path inside one of the roots, else nothing (`../../etc/passwd`, another drive, an absolute path elsewhere). */
export function insideWorkspace(roots: readonly string[], file: string): string | undefined {
	for (const root of roots) {
		const abs = path.resolve(root, file);
		const rel = path.relative(root, abs);
		if (rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)) {
			return abs;
		}
	}
	return undefined;
}

const CONTROL = /[\u0000-\u001f\u007f\u0080-\u009f\u2028\u2029]/g;

/** Plain text: control characters become spaces (a tab or a newline too), runs of spaces one. Length is checked by the caller. */
const plain = (v: unknown) => typeof v === 'string' ? v.replace(CONTROL, ' ').replace(/ {2,}/g, ' ').trim() : '';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10_000_000;

function tooLong(what: string, text: string, max: number) {
	if (text.length > max) {
		throw new TourFileError(`${what} is ${text.length} characters long; at most ${max} are shown.`);
	}
}

function parseFlow(raw: unknown, host: TourFileHost): TourFlow | undefined {
	if (!isObject(raw)) {
		return undefined;
	}
	const flow: TourFlow = {};
	const http = plain(raw.http);
	if (http) {
		flow.http = http.slice(0, 200);
	}
	const id = plain(raw.id);
	if (id) {
		flow.id = id.slice(0, 400);
	}
	if (typeof raw.file === 'string' && raw.file) {
		const file = insideWorkspace(host.roots, raw.file);
		if (!file) {
			throw new TourFileError(`flow.file "${raw.file}" is not inside the workspace.`);
		}
		flow.file = file;
		if (positive(raw.line)) {
			flow.line = raw.line;
		}
	}
	if (raw.changes === true) {
		flow.changes = true;
	}
	return Object.keys(flow).length ? flow : undefined;
}

/** Up to three `[from, to]` ranges of at most 80 lines each; a range that is not two positive integers is dropped. */
function parseHighlights(raw: unknown): [number, number][] {
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

/** The method's code for a step that lands on no drawn card: its lines, or a window around the highlighted lines. */
export function peekOf(text: string, startLine: number, endLine: number): TourStep['peek'] {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const from = Math.max(1, startLine - 2);
	const to = Math.min(lines.length, Math.max(endLine, startLine + 12), from + PEEK_LINES - 1);
	return from > lines.length ? undefined : { code: lines.slice(from - 1, to).map(l => l.slice(0, PEEK_LINE_CHARS)).join('\n').slice(0, PEEK_CHARS), startLine: from };
}

function parseStep(raw: unknown, i: number, host: TourFileHost): TourStep {
	const where = `steps[${i}]`;
	if (!isObject(raw)) {
		throw new TourFileError(`${where} is not an object.`);
	}
	const caption = plain(raw.caption);
	if (!caption) {
		throw new TourFileError(`${where}.caption is missing: every step says something.`);
	}
	tooLong(`${where}.caption`, caption, MAX_CAPTION);
	const method = plain(raw.method).slice(0, 200);
	const title = plain(raw.title) || method;
	tooLong(`${where}.title`, title, MAX_STEP_TITLE);
	const step: TourStep = { title: title || `Step ${i + 1}`, caption, state: 'ok' };

	const table = plain(raw.table);
	const file = typeof raw.file === 'string' ? raw.file : '';
	if (table) {
		// A database card instead of code: it is found by its table name on the drawn flow.
		step.at = { file: '', startLine: 0, endLine: 0, label: table.slice(0, 200), table: table.slice(0, 200) };
		return step;
	}
	if (!file) {
		// Only a caption: an intro or an outro.
		return step;
	}
	const highlights = parseHighlights(raw.lines);
	const line = positive(raw.line) ? raw.line : highlights[0]?.[0];
	const abs = insideWorkspace(host.roots, file);
	const text = abs && line !== undefined ? host.readText(abs) : undefined;
	// A step Axle cannot place is shown greyed with its caption, and never points at a wrong card. In this version a step is
	// placed by `line` (or `lines`); `method` is the label only. Finding a method by name is the MCP tool's resolver.
	if (!abs || line === undefined || text === undefined) {
		step.state = 'missing';
		step.at = { file: abs ?? '', startLine: line ?? 0, endLine: line ?? 0, label: method || path.basename(file) };
		return step;
	}
	const endLine = Math.max(line, ...highlights.map(h => h[1]));
	step.at = { file: abs, startLine: line, endLine, label: method || `${path.basename(abs)}:${line}` };
	if (highlights.length) {
		step.highlights = highlights;
	}
	step.peek = peekOf(text, Math.min(line, ...highlights.map(h => h[0])), endLine);
	return step;
}

/** Throws a TourFileError naming the bad field. */
export function parseTourFile(raw: unknown, host: TourFileHost): ParsedTour {
	if (!isObject(raw)) {
		throw new TourFileError('A tour file is a JSON object.');
	}
	if (raw.axleTour !== 1) {
		throw new TourFileError(`"axleTour": 1 is missing (this file says ${JSON.stringify(raw.axleTour)}): not a tour file, or one from a newer Axle.`);
	}
	const id = plain(raw.id);
	if (!/^[\w.-]{1,64}$/.test(id)) {
		throw new TourFileError('"id" is missing or not a name of letters, digits, - _ . (at most 64).');
	}
	const title = plain(raw.title);
	if (!title) {
		throw new TourFileError('"title" is missing.');
	}
	tooLong('"title"', title, MAX_TITLE);
	if (!Array.isArray(raw.steps) || !raw.steps.length) {
		throw new TourFileError('"steps" must list at least one step.');
	}
	if (raw.steps.length > MAX_STEPS) {
		throw new TourFileError(`"steps" has ${raw.steps.length} steps; a tour has at most ${MAX_STEPS}. A longer one is a document: split it into two tours.`);
	}
	// A file named by several steps is read once.
	const cache = new Map<string, string | undefined>();
	const cached: TourFileHost = { roots: host.roots, readText: f => (cache.has(f) ? cache.get(f) : cache.set(f, host.readText(f)).get(f)) };
	const steps = raw.steps.map((s, i) => parseStep(s, i, cached));
	const tour: Tour = {
		id,
		title,
		origin: plain(raw.author).slice(0, 80) || 'Tour file',
		source: 'file',
		steps,
		// In the file the first step is 1.
		start: positive(raw.start) ? Math.min(raw.start, steps.length) - 1 : 0,
	};
	const agent = isObject(raw.agent) ? raw.agent : undefined;
	const label = agent && plain(agent.label).slice(0, 40);
	if (agent && label && typeof agent.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(agent.color)) {
		tour.agent = { label, color: agent.color };
	}
	return { tour, flow: parseFlow(raw.flow, host) };
}

/**
 * What the canvas says about the tour playing on it, accepted only for the tour the host sent (`playing`): the id is checked, the
 * index must be a whole number inside the tour. Anything else, including a made-up id, is nothing.
 */
export function tourReport(playing: { id: string; steps: number } | undefined, m: unknown): { exit: true } | { exit: false; index: number; paused: boolean } | undefined {
	if (!playing || !isObject(m) || m.id !== playing.id) {
		return undefined;
	}
	if (m.type === 'tourExit') {
		return { exit: true };
	}
	const index = m.index;
	return m.type === 'tourState' && typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < playing.steps
		? { exit: false, index, paused: m.paused === true }
		: undefined;
}
