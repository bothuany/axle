/*---------------------------------------------------------------------------------------------
 *  Axle: the agent's gaze on the host. flow-agent sends batches of looks (`flow.agent.gaze`);
 *  each look is checked (a workspace path, whole line numbers, a colour literal) and becomes a
 *  GazeEvent. The GazeLog keeps the last events of every session in memory only, for a canvas
 *  that opens later and for "Replay trail", which turns a session's latest turn into a Tour.
 *  Pure: no `vscode`, so it is tested under plain Node.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import type { GazeEvent, Tour, TourStep } from '../../../../../protocol/flow';
import { insideWorkspace, MAX_STEPS, peekOf } from './validate';

/** Events kept per session. */
export const GAZE_KEEP = 300;
/** Looks taken from one batch. flow-agent sends far fewer: anything more is not from it. */
const MAX_BATCH = 200;
/** What a newly opened canvas is sent: the trail it would still be showing. */
export const GAZE_RECENT_MS = 60_000;
/** Sessions kept: the ones that looked at something last. */
export const GAZE_SESSIONS = 20;

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const whole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 10_000_000;
const ACTS: readonly GazeEvent['act'][] = ['read', 'edit', 'search'];

/** A look as the log keeps it: the event, and the prompt of its session it belongs to. */
interface Kept {
	event: GazeEvent;
	turn: number;
}

/**
 * The looks of one batch that hold up: a session id, a known act, an absolute path inside the workspace (a search may name a
 * workspace folder itself), whole lines in order. Labels are cut, control characters dropped, and a colour that is not a
 * `#hex` literal is replaced: it ends up in the canvas's CSS.
 */
export function parseGaze(raw: unknown, roots: readonly string[], now = Date.now()): { event: GazeEvent; turn: number }[] {
	const looks = obj(raw) && Array.isArray(raw.looks) ? raw.looks.slice(0, MAX_BATCH) : [];
	return looks.flatMap(l => {
		if (!obj(l) || typeof l.session !== 'string' || !l.session || l.session.length > 200 || typeof l.file !== 'string' || !path.isAbsolute(l.file)) {
			return [];
		}
		const act = ACTS.find(a => a === l.act);
		const file = act === 'search' && roots.some(r => path.relative(r, l.file as string) === '') ? path.resolve(l.file) : insideWorkspace(roots, l.file);
		if (!act || !file) {
			return [];
		}
		const label = (typeof l.agent === 'string' ? l.agent : '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40) || 'Agent';
		const color = typeof l.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(l.color) ? l.color : '#c6a8ff';
		const event: GazeEvent = { session: l.session, agent: { label, color }, act, file, at: typeof l.at === 'number' && Number.isFinite(l.at) && l.at >= 0 ? Math.min(Math.round(l.at), now) : now };
		if (act !== 'search' && whole(l.startLine)) {
			event.startLine = l.startLine;
			if (whole(l.endLine) && l.endLine >= l.startLine) {
				event.endLine = l.endLine;
			}
		}
		return [{ event, turn: typeof l.turn === 'number' && Number.isInteger(l.turn) && l.turn >= 0 ? l.turn : 0 }];
	});
}

/** The last GAZE_KEEP events of each session, in memory only: nothing here is ever written anywhere. */
export class GazeLog {
	private readonly sessions = new Map<string, Kept[]>();

	add(kept: readonly Kept[]) {
		for (const k of kept) {
			const list = this.sessions.get(k.event.session) ?? [];
			list.push(k);
			if (list.length > GAZE_KEEP) {
				list.splice(0, list.length - GAZE_KEEP);
			}
			// Re-inserted, so the map runs from the session that looked least recently to the latest one.
			this.sessions.delete(k.event.session);
			this.sessions.set(k.event.session, list);
		}
		for (const old of [...this.sessions.keys()].slice(0, Math.max(0, this.sessions.size - GAZE_SESSIONS))) {
			this.sessions.delete(old);
		}
	}

	has(session: unknown): session is string {
		return typeof session === 'string' && this.sessions.has(session);
	}

	/** Every session's events of the last `ms`, oldest first: the trail a canvas that opens now still shows. */
	recent(now: number, ms = GAZE_RECENT_MS): GazeEvent[] {
		return [...this.sessions.values()].flat().map(k => k.event).filter(e => now - e.at <= ms).sort((a, b) => a.at - b.at);
	}

	/** The session's events since its latest prompt. */
	lastTurn(session: string): GazeEvent[] {
		const list = this.sessions.get(session) ?? [];
		const turn = list.at(-1)?.turn;
		return list.filter(k => k.turn === turn).map(k => k.event);
	}

	clear(session?: string) {
		if (session === undefined) {
			this.sessions.clear();
		} else {
			this.sessions.delete(session);
		}
	}
}

/** Ranges this far apart are two steps, even in one file. */
const NEAR = 20;

interface Run {
	act: GazeEvent['act'];
	file: string;
	start?: number;
	end?: number;
	count: number;
}

const near = (r: Run, e: GazeEvent) =>
	r.start === undefined || e.startLine === undefined || (e.startLine <= (r.end ?? r.start) + NEAR && r.start <= (e.endLine ?? e.startLine) + NEAR);

const lines = (a: number, b: number) => a === b ? `line ${a}` : `lines ${a}–${b}`;

/**
 * A session's trail as a tour for the one player: consecutive looks at the same place merge into one step ("Read ×2"), an edit
 * is "Edited", a search is "Searched in <folder>" and points at nothing. A look at a whole file points at its first line. A
 * step on no drawn card shows its code beside the flow (`readText` gives it), else just its caption: never "missing", since
 * the code is there. A trail longer than a tour keeps its last steps.
 */
export function gazeTour(events: readonly GazeEvent[], roots: readonly string[], readText: (file: string) => string | undefined): Tour | undefined {
	const first = events[0];
	if (!first) {
		return undefined;
	}
	const runs: Run[] = [];
	for (const e of events) {
		const last = runs.at(-1);
		if (last && last.act === e.act && last.file === e.file && near(last, e)) {
			last.count++;
			if (last.start !== undefined && e.startLine !== undefined) {
				last.end = Math.max(last.end ?? last.start, e.endLine ?? e.startLine);
				last.start = Math.min(last.start, e.startLine);
			}
			continue;
		}
		runs.push({ act: e.act, file: e.file, start: e.startLine, end: e.endLine ?? e.startLine, count: 1 });
	}
	const rel = (file: string) => {
		const root = roots.find(r => insideWorkspace([r], file) || path.relative(r, file) === '');
		return (root ? path.relative(root, file) : path.basename(file)).replace(/\\/g, '/') || path.basename(file);
	};
	const texts = new Map<string, string | undefined>();
	let steps: TourStep[] = runs.map(r => {
		const name = path.basename(r.file);
		if (r.act === 'search') {
			return { title: `Searched in ${rel(r.file)}`, caption: `Searched in ${rel(r.file)}${r.count > 1 ? ` ×${r.count}` : ''}.`, state: 'ok' };
		}
		const verb = r.act === 'edit' ? 'Edited' : 'Read';
		if (!texts.has(r.file)) {
			texts.set(r.file, readText(r.file));
		}
		const text = texts.get(r.file);
		// The whole file: its whole range, so the step lands on the file's first drawn card rather than on line 1.
		const startLine = r.start ?? 1;
		const endLine = r.end ?? (r.start === undefined && text !== undefined ? text.split('\n').length : startLine);
		const where = r.start === undefined ? `all of ${name}` : `${lines(startLine, endLine)} of ${name}`;
		const step: TourStep = {
			title: `${verb} ${name}${r.count > 1 ? ` ×${r.count}` : ''}`,
			caption: `${verb}${r.count > 1 ? ` ×${r.count}` : ''}: ${where}.`,
			at: { file: r.file, startLine, endLine, label: name },
			state: 'ok',
		};
		if (r.start !== undefined) {
			step.highlights = [[startLine, Math.min(endLine, startLine + 79)]];
		}
		const peek = text === undefined ? undefined : peekOf(text, startLine, endLine);
		if (peek) {
			step.peek = peek;
		}
		return step;
	});
	if (steps.length > MAX_STEPS) {
		const left = steps.length - (MAX_STEPS - 1);
		steps = [{ title: 'Earlier', caption: `${left} earlier ${left === 1 ? 'place' : 'places'} left out: this replays the last ${MAX_STEPS - 1}.`, state: 'ok' }, ...steps.slice(-(MAX_STEPS - 1))];
	}
	return {
		id: `gaze-${first.session}-${first.at}`,
		title: `${first.agent.label}'s trail`,
		origin: first.agent.label,
		source: 'gaze',
		agent: { ...first.agent },
		steps,
		start: 0,
	};
}
