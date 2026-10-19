/*---------------------------------------------------------------------------------------------
 *  Axle: skeleton first in the Agents dock. The row flow-view sends for a session (its own copy of the shape: flow-agent does not
 *  import flow-view), the actions the dock may take on it, and the prompts the dock types into the agent's session for each
 *  click. Nothing here decides the stage: flow-view does (src/skeletonHost.ts there), and check_skeleton tells the agent.
 *  Pure (no vscode): tested on its own (test/skeleton.test.mjs). See docs/design/skeleton-first.md.
 *--------------------------------------------------------------------------------------------*/

/** What flow-view's `viewOf` sends: plain text and counts, never a file or an id. */
export interface SkeletonView {
	stage: 'design' | 'skeleton' | 'handover';
	title?: string;
	drawn: boolean;
	summary: string;
	counts?: { matches: number; missing: number; differs: number };
	warnings: { text: string; revert: boolean }[];
}

/** What a row's skeleton buttons may ask for. */
export const SKELETON_ACTIONS = ['write', 'just', 'check', 'handover', 'tour', 'finish', 'board'] as const;
export type SkeletonAction = typeof SKELETON_ACTIONS[number];
export const WARNING_ACTIONS = ['accept', 'revert', 'open'] as const;
export type WarningAction = typeof WARNING_ACTIONS[number];

const STAGES = new Set(['design', 'skeleton', 'handover']);
const MAX_WARNINGS = 20;
const str = (v: unknown, max: number) => typeof v === 'string' ? v.slice(0, max) : undefined;
const count = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 ? Math.min(v, 9999) : 0;

/** flow-view's message checked for its shape: anything else is no row. */
export function readView(raw: unknown): SkeletonView | undefined {
	const v = raw as Record<string, unknown> | null;
	if (!v || typeof v !== 'object' || !STAGES.has(v.stage as string)) {
		return undefined;
	}
	const c = v.counts as Record<string, unknown> | undefined;
	return {
		stage: v.stage as SkeletonView['stage'],
		title: str(v.title, 120),
		drawn: v.drawn === true,
		summary: str(v.summary, 300) ?? '',
		counts: c && typeof c === 'object' ? { matches: count(c.matches), missing: count(c.missing), differs: count(c.differs) } : undefined,
		warnings: (Array.isArray(v.warnings) ? v.warnings : []).slice(0, MAX_WARNINGS).filter(w => typeof w?.text === 'string').map(w => ({ text: String(w.text).slice(0, 400), revert: w.revert === true })),
	};
}

/** Which buttons a row shows: "Just do it" stands next to the main choice at every stage before the hand-over. */
export function rowActions(v: SkeletonView, atPrompt: boolean): SkeletonAction[] {
	switch (v.stage) {
		case 'design':
			return v.drawn ? ['write', 'just', 'board'] : ['just'];
		case 'skeleton':
			return [...(atPrompt ? ['check', 'handover'] as const : []), 'just', 'board'];
		case 'handover':
			return [...(atPrompt ? ['tour'] as const : []), 'finish', 'board'];
	}
}

/** One line: a terminal prompt submits at a line break, and nothing a terminal takes for a key gets through. */
// eslint-disable-next-line no-control-regex
const oneLine = (lines: string[]) => lines.join(' ').replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').replace(/ {2,}/g, ' ').trim();

/** The prompt a click types into the agent's session; nothing for a click that only changes what Axle shows. */
export function skeletonPrompt(action: SkeletonAction): string | undefined {
	switch (action) {
		case 'just':
			return oneLine(['Skeleton first skipped: implement the approved plan now, as usual.']);
		case 'check':
			return oneLine([
				'I wrote part of the skeleton. Call the axle tool check_skeleton and go through each MISSING or DIFFERS line: what your plan intended and why, as a trade-off, not a verdict.',
				'Do not create or edit any file and do not write the code for me.',
				'If I answer that mine is better, argue your case with reasons, or, if I am right, redraw the plan with draw_board and the same id so it follows my design.',
			]);
		case 'handover':
			return oneLine([
				'I am done with the skeleton: fill in the method bodies now.',
				'Keep every type, signature, name and relation I wrote; if one must change, say so and why (Axle shows me any you change).',
				'When you are done, play a closing tour with the axle tool tour, flow {"changes": true}: one step per method you filled, in the order a request runs through them, captions on why, and a last caption-only step on what you did not test. Then one line.',
			]);
		case 'tour':
			return oneLine([
				'Play a closing tour of the bodies you filled with the axle tool tour, flow {"changes": true}: one step per method, in the order a request runs through them, captions on why and what could break, and a last caption-only step on what you did not test.',
			]);
		default:
			return undefined;
	}
}
