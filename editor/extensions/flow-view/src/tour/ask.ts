/*---------------------------------------------------------------------------------------------
 *  Axle: the reader's questions. During a tour the reader may ask about the step they are on (`tourAsk`), and on any card they may
 *  point at some code and ask about it (`pointAsk`). The canvas is not trusted: each message is checked here (the tour must be the
 *  one this host sent, the lines whole numbers, the file inside the workspace, the question short plain text), and the prompt that
 *  goes to the agent is built here, from the host's own record of the tour, with the question quoted as the user's own words.
 *  Pure: no `vscode`.
 *--------------------------------------------------------------------------------------------*/

export const MAX_QUESTION = 1000;
const MAX_LABEL = 200;
/** At most this many notes hang on one step (docs/design/guided-tours.md, 1.4). */
export const MAX_NOTES = 10;
export const MAX_NOTE = 2000;

const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f' + String.fromCharCode(0x2028, 0x2029) + ']+', 'g');

/** Plain text on one line, cut to `max`; nothing when it is empty or not text. */
export function oneLine(v: unknown, max: number): string {
	return typeof v === 'string' ? v.replace(CONTROL, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max) : '';
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const whole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10_000_000;

/** The reader asks about step `index` (0-based) of the tour that is playing. A made-up id, a step that does not exist or an empty question is nothing. */
export function parseTourAsk(m: unknown, playing: { id: string; steps: number } | undefined): { index: number; question: string } | undefined {
	if (!playing || !isObject(m) || m.type !== 'tourAsk' || m.id !== playing.id) {
		return undefined;
	}
	const question = oneLine(m.question, MAX_QUESTION);
	const index = m.index;
	return question && typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < playing.steps ? { index, question } : undefined;
}

export interface PointAsk {
	/** Absolute, inside the workspace. */
	file: string;
	startLine: number;
	endLine: number;
	label: string;
	question: string;
}

/** The reader points at lines of a file and asks. `fileOf` resolves the file against the workspace (nothing outside it). */
export function parsePointAsk(m: unknown, fileOf: (file: unknown) => string | undefined): PointAsk | undefined {
	if (!isObject(m) || m.type !== 'pointAsk') {
		return undefined;
	}
	const file = fileOf(m.file);
	const question = oneLine(m.question, MAX_QUESTION);
	if (!file || !question || !whole(m.startLine) || !whole(m.endLine) || m.endLine < m.startLine) {
		return undefined;
	}
	return { file, startLine: m.startLine, endLine: m.endLine, label: oneLine(m.label, MAX_LABEL) || 'this code', question };
}

/** `file:58-90`, or `file:58` for one line. */
export const place = (file: string, startLine: number, endLine: number) => `${file}:${startLine}${endLine > startLine ? `-${endLine}` : ''}`;

/** What the agent that made the tour is told when the reader asks about a step (3.6 of the design). `step` is 1-based. */
export function tourAskPrompt(tour: { id: string; title: string }, step: number, steps: number, what: { label: string; where?: string }, question: string): string {
	return [
		`The user is on step ${step} of ${steps} of your tour "${oneLine(tour.id, 80)}" (${oneLine(what.label, MAX_LABEL)}${what.where ? `, ${oneLine(what.where, MAX_LABEL)}` : ''}) and asks, in their own words: ${JSON.stringify(question)}.`,
		`Answer with the axle tool \`tour_control\`: action "note" for id "${oneLine(tour.id, 80)}" step ${step} (and action "go" with the step that answers it better, if there is one), then action "resume".`,
		'Keep the note short; if the answer needs more than a note, start a new tour with `tour`.',
	].join(' ');
}

/** What the agent is told when the reader points at code and asks (6 of the design). `where`: a workspace-relative path with lines. */
export function pointAskPrompt(p: { label: string; where: string; flow?: string; question: string }): string {
	return [
		`The user points at ${oneLine(p.label, MAX_LABEL)} (${oneLine(p.where, MAX_LABEL)})${p.flow ? ` on the flow "${oneLine(p.flow, MAX_LABEL)}"` : ''} and asks, in their own words: ${JSON.stringify(p.question)}.`,
		'Answer by showing: call the axle tool `tour` with 1 to 5 steps starting at that code (leave `flow` out: the canvas already shows it), captions that answer the question; then a one-paragraph answer here.',
		'If you cannot call mcp__axle__tour, answer in text.',
	].join(' ');
}

const KEEP_BREAKS = new RegExp('[\u0000-\u0009\u000b-\u001f\u007f-\u009f' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');

/**
 * Markdown text the canvas renders (captions and notes): control characters become spaces, but line breaks stay (a list or a code
 * block needs them) and so does indentation; trailing spaces go and more than one blank line becomes one. Cut to `max`.
 */
export function prose(v: unknown, max = Infinity): string {
	return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(KEEP_BREAKS, ' ').replace(/ +\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '';
}

/** A note an agent pins to a step: Markdown, cut, or nothing. */
export const noteText = (v: unknown) => prose(v, MAX_NOTE);
