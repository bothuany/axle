/*---------------------------------------------------------------------------------------------
 *  Insilode Harness: what each harness file costs, and how that changed. A file's cost is split in
 *  two: always-on (read before the first prompt, in every session: CLAUDE.md, rules without
 *  paths, skill and subagent descriptions) and on demand (read only when the agent works where
 *  it applies or uses it: a folder's CLAUDE.md, a path-scoped rule, a skill's body). The costs
 *  of the last scan are kept, so after an edit the map can say "710 tok, was 1.2k". All numbers
 *  are estimates, about four characters per token. Pure (no vscode).
 *--------------------------------------------------------------------------------------------*/

export interface Cost {
	always: number;
	onDemand: number;
}

export interface CostChange {
	before: Cost;
	after: Cost;
	at: number;
}

export interface CostState {
	version: 1;
	/** The cost of every file at the last scan, by path. */
	files: Record<string, Cost>;
	/** Files whose cost changed lately: shown as before/after until it is old. */
	changes: Record<string, CostChange>;
}

/** A change is shown this long after the edit that caused it. */
export const CHANGE_DAYS = 7;
const DAY = 86_400_000;
const MAX_FILES = 1000;

export const emptyCosts = (): CostState => ({ version: 1, files: {}, changes: {} });

export function loadCosts(raw: unknown): CostState {
	const r = raw as Partial<CostState> | undefined;
	return r && r.version === 1 && r.files && typeof r.files === 'object' && r.changes && typeof r.changes === 'object' ? r as CostState : emptyCosts();
}

const same = (a: Cost, b: Cost) => a.always === b.always && a.onDemand === b.onDemand;

/**
 * The state after a scan found `current`: a file whose cost moved since the last scan gets a change (before → after), and
 * changes older than CHANGE_DAYS are dropped. The very first scan records costs without changes.
 */
export function trackCosts(state: CostState, current: Readonly<Record<string, Cost>>, now: number): CostState {
	const first = !Object.keys(state.files).length;
	const changes: Record<string, CostChange> = {};
	for (const [file, c] of Object.entries(state.changes)) {
		// A change from nothing is a file that appeared, kept by an older version: not an edit.
		if (now - c.at < CHANGE_DAYS * DAY && (c.before.always || c.before.onDemand)) {
			changes[file] = c;
		}
	}
	if (!first) {
		// Only a file seen in both scans has a before and an after: one that appeared (or is newly tracked) or went away is not an edit to show.
		for (const file of Object.keys(current).filter(f => state.files[f])) {
			const before = state.files[file];
			const after = current[file];
			if (!same(before, after)) {
				// A second edit keeps the cost from before the first one, so the change shown is the whole of the recent trim.
				changes[file] = { before: changes[file]?.before ?? before, after, at: now };
				if (same(changes[file].before, after)) {
					delete changes[file];
				}
			}
		}
	}
	const files = Object.fromEntries(Object.entries(current).slice(0, MAX_FILES));
	return { version: 1, files, changes };
}

export function totals(costs: Readonly<Record<string, Cost>>): Cost {
	return Object.values(costs).reduce((a, c) => ({ always: a.always + c.always, onDemand: a.onDemand + c.onDemand }), { always: 0, onDemand: 0 });
}

/** The totals before the recent changes: what the harness cost before the edits still on show. */
export function totalsBefore(state: CostState): Cost {
	const now = totals(state.files);
	return Object.values(state.changes).reduce((a, c) => ({ always: a.always - c.after.always + c.before.always, onDemand: a.onDemand - c.after.onDemand + c.before.onDemand }), now);
}

export const tok = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);

/** A signed difference in tokens: "−400", "+1.2k". */
export const delta = (n: number) => `${n < 0 ? '−' : '+'}${tok(Math.abs(n))}`;

/** "710 tok", "+1.2k on demand", "710 tok (was 1.2k)": what a row of the map says about a file's cost. */
export function costLabel(c: Cost, change?: CostChange): string {
	const parts = [c.always ? `${tok(c.always)} tok` : '', c.onDemand ? `${c.always ? '+' : ''}${tok(c.onDemand)} on demand` : ''].filter(Boolean);
	const was = change && (change.before.always !== c.always ? change.before.always : change.before.onDemand !== c.onDemand ? change.before.onDemand : undefined);
	return `${parts.join(' ')}${was !== undefined && parts.length ? ` (was ${tok(was)})` : ''}`;
}
