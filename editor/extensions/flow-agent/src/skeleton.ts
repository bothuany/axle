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
	/** `id` stays the warning's own while the list changes: the dock sends it back, never a position. */
	warnings: { id: number; text: string; revert: boolean }[];
}

/** What a row's skeleton buttons may ask for. */
/** `enable` / `disable` turn skeleton first on or off for that one agent; the rest act on its current change. */
export const SKELETON_ACTIONS = ['enable', 'disable', 'write', 'just', 'check', 'handover', 'tour', 'finish', 'board'] as const;
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
		warnings: (Array.isArray(v.warnings) ? v.warnings : []).slice(0, MAX_WARNINGS).filter(w => typeof w?.text === 'string' && Number.isInteger(w.id) && w.id >= 0).map(w => ({ id: w.id as number, text: String(w.text).slice(0, 400), revert: w.revert === true })),
	};
}

/** Which buttons a row shows: "Just do it" stands next to the main choice at every stage before the hand-over. */
export function rowActions(v: SkeletonView, atPrompt: boolean): SkeletonAction[] {
	switch (v.stage) {
		case 'design':
			return v.drawn ? ['write', 'just', 'board'] : [];
		case 'skeleton':
			return [...(atPrompt ? ['check', 'handover'] as const : []), 'just', 'board'];
		case 'handover':
			return [...(atPrompt ? ['tour'] as const : []), 'finish', 'board'];
	}
}

/**
 * What Claude Code reads with every prompt while the switch is on (a UserPromptSubmit hook), so the gate holds outside plan mode too.
 * Short on purpose: it rides along with each prompt. A request that adds no types is not held up by it.
 */
export const SKELETON_PROMPT_GATE = 'Axle: skeleton first is ON. If this request makes you add or change types, entities or interfaces, call the axle MCP tool check_skeleton (mcp__axle__check_skeleton) once before your first edit and follow its answer. For a bug fix, a small edit or a question, go ahead as usual.';

/**
 * What Claude Code reads right after the user approves a plan while the switch is on (a PostToolUse hook on ExitPlanMode). The
 * server instructions say the same, but a small model goes straight to its first edit without this.
 */
export const SKELETON_GATE = 'Axle: skeleton first is ON (the developer chose it). Before you create or edit any file for this plan, call the axle MCP tool check_skeleton once (mcp__axle__check_skeleton; load it with ToolSearch if it is not loaded yet) and follow its answer. If the plan adds or changes no types, entities or interfaces, it tells you to go ahead as usual.';

/** Every reminder a hook may hand Claude, by the hook event it answers. The hook script prints these exact texts and nothing else. */
export const HOOK_CONTEXT: Readonly<Record<'PostToolUse' | 'UserPromptSubmit', string>> = { PostToolUse: SKELETON_GATE, UserPromptSubmit: SKELETON_PROMPT_GATE };

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
