/*---------------------------------------------------------------------------------------------
 *  Axle: what an agent says about its context window and its plan's usage limits, read from what
 *  the CLI itself reports. Nothing here guesses a window size: a number the CLI did not give stays
 *  unknown, and the views show the tokens without a percentage.
 *
 *  - Claude Code hands its status-line command a JSON object on every refresh: `model`, a
 *    `context_window` with `context_window_size` and `total_input_tokens` (the last request's input,
 *    cached tokens included), and, on a claude.ai plan, `rate_limits.five_hour` / `seven_day` with a
 *    `used_percentage` (0-100) and `resets_at` (epoch seconds). Hooks get none of this.
 *  - Claude's transcript has the token counts but only the API model id (never a `[1m]` suffix), so it
 *    gives the used tokens and no window.
 *  - Codex writes `token_count` events into its rollout file (the hooks' `transcript_path`):
 *    `info.last_token_usage`, `info.model_context_window`, and `rate_limits.primary` / `secondary`
 *    with `used_percent`, `window_minutes` and `resets_at` (epoch seconds).
 *
 *  Pure (no vscode), so it is tested on its own.
 *--------------------------------------------------------------------------------------------*/

/** How full one agent's context window is. `size` is absent when the agent did not say. */
export interface ContextUsage {
	used: number;
	size?: number;
	model?: string;
}

/** One usage window of a plan: the 5-hour or the weekly limit, say. */
export interface LimitWindow {
	/** Short, for the status bar: `5h`, `wk`. */
	label: string;
	/** Share of the window used, 0-100. */
	usedPercent: number;
	/** When the window resets, in ms since the epoch. */
	resetsAt?: number;
}

/** A harness's usage limits as its CLI last reported them. Limits are per account, not per session. */
export interface UsageLimits {
	harness: string;
	windows: LimitWindow[];
}

const num = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined => typeof v === 'string' && v ? v : undefined;
const obj = (v: unknown): Record<string, unknown> | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;

/** A reset time as epoch seconds (what both CLIs send today) or an ISO string, as ms since the epoch. */
export function resetTime(v: unknown): number | undefined {
	const n = num(v);
	if (n !== undefined) {
		// Seconds today; a value already in milliseconds would be a date thousands of years out, so take it as it is.
		return n > 1e12 ? n : n * 1000;
	}
	const s = str(v);
	const t = s ? Date.parse(s) : NaN;
	return Number.isNaN(t) ? undefined : t;
}

/** A window length in minutes as a status bar label. */
export function windowLabel(minutes: number | undefined): string {
	if (minutes === undefined) {
		return '';
	}
	if (minutes === 7 * 24 * 60) {
		return 'wk';
	}
	return minutes % (24 * 60) === 0 ? `${minutes / (24 * 60)}d` : minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

function window(label: string, w: unknown, percent: string): LimitWindow | undefined {
	const o = obj(w);
	const used = num(o?.[percent]);
	if (!o || used === undefined) {
		return undefined;
	}
	const resetsAt = resetTime(o.resets_at);
	return { label, usedPercent: Math.max(0, Math.min(100, used)), ...(resetsAt !== undefined ? { resetsAt } : {}) };
}

/** Claude Code's status-line JSON: the session it is about, its context fill, and the plan's limits when known. */
export function parseClaudeStatus(payload: unknown): { sessionId?: string; transcript?: string; usage?: ContextUsage; limits?: UsageLimits } {
	const p = obj(payload) ?? {};
	const model = obj(p.model);
	const name = str(model?.display_name) ?? str(model?.id);
	const cw = obj(p.context_window);
	const size = num(cw?.context_window_size);
	// total_input_tokens is the last request's input side (fresh + cache read + cache write): what fills the window now.
	// Before the first request it is 0, and the window is still worth showing.
	const used = num(cw?.total_input_tokens);
	const usage: ContextUsage | undefined = cw && (used !== undefined || size !== undefined)
		? { used: used ?? 0, ...(size ? { size } : {}), ...(name ? { model: name } : {}) }
		: undefined;
	const rl = obj(p.rate_limits);
	const windows = [window('5h', rl?.five_hour, 'used_percentage'), window('wk', rl?.seven_day, 'used_percentage')].filter((w): w is LimitWindow => !!w);
	return {
		sessionId: str(p.session_id),
		transcript: str(p.transcript_path),
		usage,
		limits: windows.length ? { harness: 'Claude Code', windows } : undefined,
	};
}

/**
 * Context in use from the end of a Claude transcript: the last assistant message's input side. The window
 * is left out on purpose: the transcript carries the API model id, which never says whether the session
 * runs with the 1M window.
 */
export function claudeTranscriptUsage(lines: string[]): ContextUsage | undefined {
	for (let i = lines.length - 1; i >= 0; i--) {
		let entry: { type?: string; message?: { model?: string; usage?: Record<string, number> } };
		try {
			entry = JSON.parse(lines[i]);
		} catch {
			continue;
		}
		const u = entry.type === 'assistant' ? entry.message?.usage : undefined;
		if (u) {
			const used = (num(u.input_tokens) ?? 0) + (num(u.cache_read_input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0);
			const model = str(entry.message?.model);
			return { used, ...(model ? { model } : {}) };
		}
	}
	return undefined;
}

/** The newest context fill and limits in the end of a Codex rollout file. Either can be missing. */
export function codexRolloutUsage(lines: string[]): { usage?: ContextUsage; limits?: UsageLimits } {
	let usage: ContextUsage | undefined;
	let limits: UsageLimits | undefined;
	let model: string | undefined;
	for (let i = lines.length - 1; i >= 0 && (!usage || !limits || !model); i--) {
		let entry: { type?: string; payload?: Record<string, unknown> };
		try {
			entry = JSON.parse(lines[i]);
		} catch {
			continue;
		}
		const p = obj(entry.payload);
		if (!p) {
			continue;
		}
		if (entry.type === 'turn_context') {
			model ??= str(p.model);
			continue;
		}
		if (entry.type !== 'event_msg' || p.type !== 'token_count') {
			continue;
		}
		const info = obj(p.info);
		const last = obj(info?.last_token_usage);
		if (!usage && last) {
			// The last request's tokens are what the window holds now; the running total counts every turn again.
			const used = num(last.total_tokens) ?? (num(last.input_tokens) ?? 0) + (num(last.output_tokens) ?? 0);
			const size = num(info?.model_context_window);
			usage = { used, ...(size ? { size } : {}) };
		}
		const rl = obj(p.rate_limits);
		if (!limits && rl) {
			const windows = ['primary', 'secondary']
				.map(k => window(windowLabel(num(obj(rl[k])?.window_minutes)) || (k === 'primary' ? 'short' : 'long'), rl[k], 'used_percent'))
				.filter((w): w is LimitWindow => !!w);
			if (windows.length) {
				limits = { harness: 'Codex', windows };
			}
		}
	}
	if (usage && model) {
		usage.model = model;
	}
	return { usage, limits };
}

/** A new report merged into what is known: a report without a window never forgets the window an earlier one gave. */
export function mergeUsage(before: ContextUsage | undefined, next: ContextUsage): ContextUsage {
	const size = next.size ?? before?.size;
	const model = next.model ?? before?.model;
	return { used: next.used, ...(size ? { size } : {}), ...(model ? { model } : {}) };
}
