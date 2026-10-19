/*---------------------------------------------------------------------------------------------
 *  Axle skeleton first: where each agent session is in the flow (design → skeleton → handover), what `check_skeleton` answers at
 *  each stage, and the row the dock draws for it. Held in the window's memory only: a reload starts over. Pure: no vscode.
 *--------------------------------------------------------------------------------------------*/

import type { BoardSpec } from '../board/spec';
import type { Header, Warning } from './guard';
import { warningText } from './guard';
import { countsText, diffText, type SkeletonDiff } from './match';

export type Stage = 'design' | 'skeleton' | 'handover';

/** What the MCP tools need of skeleton first: the answer of `check_skeleton`, and a board an agent drew. */
export interface SkeletonTools {
	check(session: string | undefined): Promise<string>;
	drawn(id: string, spec: BoardSpec, session: string | undefined): void;
}

export interface SkeletonSession {
	/** The Axle agent session (AXLE_SESSION); '' for an agent Axle did not start. */
	session: string;
	stage: Stage;
	/** The board the design is drawn on. */
	boardId: string;
	/** The design as the agent drew it (never the coloured copy). */
	plan?: BoardSpec;
	/** Files the developer saved since the design was drawn: a name two types share goes to the one in such a file. */
	recent: Set<string>;
	diff?: SkeletonDiff;
	/** The developer's declarations, kept at the hand-over. */
	headers: Header[];
	warnings: Warning[];
}

/** What the dock shows on the agent's row. Plain data: the dock never sees files or ids it could send back. */
export interface SkeletonView {
	stage: Stage;
	title?: string;
	drawn: boolean;
	summary: string;
	counts?: { matches: number; missing: number; differs: number };
	/** Each warning by a number that stays its own while the list changes: the dock sends it back, never a position. */
	warnings: { id: number; text: string; revert: boolean }[];
}

/** The board id a session's design goes on: letters and digits of the session only, so it is a valid board id. */
export const boardIdFor = (session: string) => session ? `skeleton-${session.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}` : 'skeleton';

export const newSession = (session: string): SkeletonSession => ({ session, stage: 'design', boardId: boardIdFor(session), recent: new Set(), headers: [], warnings: [] });

export function viewOf(s: SkeletonSession): SkeletonView {
	const drawn = !!s.plan;
	const summary = s.stage === 'design'
		? drawn ? 'The design is on the board. Not right? Tell the agent what to change.' : 'The agent is drawing the design…'
		: s.diff ? `Plan vs code: ${countsText(s.diff)}` : 'Waiting for the code index…';
	return {
		stage: s.stage, title: s.plan?.title, drawn, summary,
		counts: s.stage !== 'design' && s.diff?.ready ? { ...s.diff.counts } : undefined,
		warnings: s.warnings.map(w => ({ id: w.id ?? 0, text: warningText(w), revert: w.reason !== 'removed' && !!w.after })),
	};
}

const SIGNATURES = 'members as signatures (`name(param: Type): Return`, `field: Type`)';

/** What `check_skeleton` answers. `enabled` is the live switch; `s` is this session's stage, when it has one. */
export function toolAnswer(enabled: boolean, s: SkeletonSession | undefined, rel: (file: string) => string = f => f): string {
	if (!enabled) {
		return 'Skeleton first is off in Axle: implement the plan as usual. Do not call check_skeleton again for this plan.';
	}
	if (!s || (s.stage === 'design' && !s.plan)) {
		const id = s?.boardId ?? 'skeleton';
		return [
			'Skeleton first is ON in Axle: the developer writes the skeleton of this change (types, entities, interfaces, signatures, empty bodies) themselves, and you fill the bodies later.',
			'1. If the approved plan does NOT add or change types, entities or interfaces (a bug fix, a rename, a small edit), ignore this and implement the plan as usual.',
			`2. Otherwise draw your target design now with draw_board: id "${id}", kind "class" (or "er" for tables), one node per type with kind interface / class / service / repository / entity / dto / enum, ${SIGNATURES}, and edges for extends / implements / has / has-many / uses. Only the types this change adds or changes, and the ones they connect to.`,
			'3. Then STOP: do not create or edit any file. Tell the user in one line that the design is on the board in Axle, that they can ask you to change it, and that they choose "Write the skeleton" or "Just do it" in the Axle agent dock.',
			`4. If they ask for a change ("make X an interface", "remove the repository"), redraw with draw_board and the same id "${id}", then stop again.`,
		].join('\n');
	}
	const title = s.plan?.title ?? 'the design';
	switch (s.stage) {
		case 'design':
			return `The design "${title}" is on the board (id "${s.boardId}") and the developer has not chosen yet. If they asked for a change, redraw it with draw_board and the same id. Otherwise wait: do not create or edit files until they choose in the Axle dock.`;
		case 'skeleton':
			return [
				s.diff ? diffText(s.diff, title, rel) : 'The code index has not been read yet: try again in a few seconds.',
				'',
				'The developer is writing this skeleton themselves. Explain each MISSING or DIFFERS line: what the plan intended and why, phrased as a trade-off, not a verdict. Do NOT create or edit any file and do not write the code for them.',
				`If they reply that theirs is better, argue your case with reasons, or, if they are right, redraw the plan with draw_board and the same id "${s.boardId}" so the board follows their design.`,
			].join('\n');
		case 'handover':
			return [
				s.diff ? diffText(s.diff, title, rel) : '',
				s.warnings.length ? `\nSignatures you changed after the hand-over (the developer sees these and may revert them):\n${s.warnings.map(w => `- ${warningText(w)}`).join('\n')}` : '',
				'',
				'The developer handed the skeleton over: fill in the method bodies. Keep every type, signature, name and relation they wrote. If one must change, say so and why in your reply.',
			].filter(Boolean).join('\n');
	}
}
