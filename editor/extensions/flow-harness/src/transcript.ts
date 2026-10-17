/*---------------------------------------------------------------------------------------------
 *  Axle Harness: what a Claude Code transcript (a session's .jsonl) says about the harness. Hooks
 *  tell Axle what an agent does as it happens; the transcript adds what no hook reports: which
 *  memory files and path-scoped rules were loaded, the skill and subagent listings, MCP server
 *  instructions, hook failures, how long Stop hooks took, the API's own token usage, and the
 *  breakdown `/context` printed if the user ran it. Pure (no vscode), so it is tested on its own.
 *--------------------------------------------------------------------------------------------*/

export interface Usage {
	/** Input side of one API call: fresh + cache read + cache creation tokens, as the API reported them. */
	used: number;
	model?: string;
	at?: string;
}

export interface ContextReport {
	at?: string;
	/** "66.7k/1m tokens": what /context counted in use, and the window. */
	used?: number;
	size?: number;
	/** Claude Code's own estimate per category: System prompt, System tools, MCP tools, Memory files, Skills, Messages… */
	categories: { name: string; tokens: number }[];
	/** Per-item lines from `/context all`, when it was expanded (mcp__server__tool: 1.2k tokens and the like). */
	items: { name: string; tokens: number }[];
}

export interface ToolUse {
	id?: string;
	name: string;
	input: Record<string, unknown>;
	at?: string;
}

export interface TranscriptFacts {
	/** The first API call's input: system prompt, tools, memory, listings and the first prompt together. */
	firstUsage?: Usage;
	/** The latest API call's input after the last compaction: what the window holds now. */
	lastUsage?: Usage;
	compactions: number;
	/** Memory files Claude Code loaded at the start (CLAUDE.md, CLAUDE.local.md, rules without paths), with their text length. */
	memory: { path: string; type?: string; chars: number }[];
	/** Files loaded on demand: nested CLAUDE.md and path-scoped rules, as Claude touched files they cover. */
	nested: { path: string; chars: number; at?: string }[];
	skillListingChars: number;
	agentListingChars: number;
	/** MCP server instructions, by server name. */
	mcpInstructions: { server: string; chars: number }[];
	/** MCP tool names Claude Code listed (deferred or loaded), so a server's tool count is known. */
	mcpTools: string[];
	toolUses: ToolUse[];
	/** Tool calls whose result was an error, with the error's first line. */
	toolErrors: { tool: string; input: Record<string, unknown>; error: string; at?: string }[];
	hookErrors: { hookName: string; event?: string; blocking: boolean; message: string; at?: string }[];
	stopHooks: { command: string; durationMs?: number; at?: string }[];
	prompts: { text: string; at?: string }[];
	context?: ContextReport;
	/** Skills Claude Code reports as invoked (from the Skill tool or a /slash command). */
	invokedSkills: string[];
	/** Set when only the start and the end of the transcript were read: counts over the whole of it are lower bounds. */
	partial?: boolean;
}

type Entry = {
	type?: string;
	subtype?: string;
	isMeta?: boolean;
	timestamp?: string;
	content?: unknown;
	attachment?: Record<string, unknown>;
	message?: { role?: string; model?: string; usage?: Record<string, number>; content?: unknown };
	hookInfos?: { command?: string; durationMs?: number }[];
	toolUseResult?: unknown;
};

const str = (v: unknown) => typeof v === 'string' ? v : undefined;
const len = (v: unknown): number => typeof v === 'string' ? v.length : Array.isArray(v) ? v.reduce((a: number, x) => a + len(x), 0) : v && typeof v === 'object' ? len((v as { content?: unknown }).content) : 0;

/** "2.4k", "918", "1.2m" as a number of tokens. */
export function tokenCount(text: string): number {
	const m = /([\d.]+)\s*([km]?)/i.exec(text.replace(/,/g, ''));
	if (!m) {
		return 0;
	}
	const n = parseFloat(m[1]);
	return Math.round(m[2].toLowerCase() === 'k' ? n * 1000 : m[2].toLowerCase() === 'm' ? n * 1_000_000 : n);
}

/** The text `/context` printed (ANSI colours and the block grid removed), read into numbers. */
export function parseContextReport(raw: string, at?: string): ContextReport | undefined {
	// eslint-disable-next-line no-control-regex
	const text = raw.replace(/\u001b\[[0-9;]*m/g, '').replace(/<\/?local-command-stdout>/g, '');
	if (!/Context Usage/i.test(text)) {
		return undefined;
	}
	const report: ContextReport = { at, categories: [], items: [] };
	const total = /([\d.]+[km]?)\s*\/\s*([\d.]+[km]?)\s+tokens/i.exec(text);
	if (total) {
		report.used = tokenCount(total[1]);
		report.size = tokenCount(total[2]);
	}
	for (const rawLine of text.split(/\r?\n/)) {
		// The grid of block characters sits before the text on the same line.
		const line = rawLine.replace(/^[^A-Za-z└├│]*/u, '').trim();
		const cat = /^([A-Z][A-Za-z ]+?):\s*([\d.]+[km]?)(?:\s+tokens)?\s*\(/.exec(line);
		if (cat && !/^(?:Free space|Autocompact buffer|Auto-compact window)$/i.test(cat[1])) {
			report.categories.push({ name: cat[1].trim(), tokens: tokenCount(cat[2]) });
			continue;
		}
		const item = /^[└├│\s-]*([\w.:@/~-]+(?:__[\w.-]+)*|[^:]+\.md)\s*:\s*([\d.]+[km]?)\s+tokens/.exec(rawLine.replace(/^[^└├│\w~./]*/u, ''));
		if (item && !cat) {
			report.items.push({ name: item[1].trim(), tokens: tokenCount(item[2]) });
		}
	}
	return report;
}

/** A user line that is a prompt the person typed, not a tool result, a command echo or a reminder. */
function promptText(e: Entry): string | undefined {
	if (e.type !== 'user' || e.isMeta || e.message?.role !== 'user') {
		return undefined;
	}
	const c = e.message.content;
	const text = typeof c === 'string' ? c : Array.isArray(c) && c.every(b => (b as { type?: string }).type === 'text') ? c.map(b => str((b as { text?: unknown }).text) ?? '').join('\n') : undefined;
	if (!text?.trim() || /^\s*<(?:command-name|local-command|system-reminder|bash-|user-memory-input|task-notification)/.test(text) || /^\[Request interrupted/.test(text)) {
		return undefined;
	}
	return text.trim();
}

export function parseTranscript(lines: readonly string[]): TranscriptFacts {
	const f: TranscriptFacts = { compactions: 0, memory: [], nested: [], skillListingChars: 0, agentListingChars: 0, mcpInstructions: [], mcpTools: [], toolUses: [], toolErrors: [], hookErrors: [], stopHooks: [], prompts: [], invokedSkills: [] };
	const uses = new Map<string, ToolUse>();
	const mcpTools = new Set<string>();
	for (const line of lines) {
		if (!line.trim()) {
			continue;
		}
		let e: Entry;
		try {
			e = JSON.parse(line) as Entry;
		} catch {
			continue; // a line cut by a bounded read, or one still being written
		}
		const at = e.timestamp;
		if (e.type === 'assistant' && e.message?.usage) {
			const u = e.message.usage;
			const usage = { used: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), model: e.message.model, at };
			if (usage.used > 0) {
				f.firstUsage ??= usage;
				f.lastUsage = usage;
			}
		}
		if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
			for (const b of e.message.content as { type?: string; id?: string; name?: string; input?: Record<string, unknown> }[]) {
				if (b.type === 'tool_use' && b.name) {
					const use = { id: b.id, name: b.name, input: b.input ?? {}, at };
					f.toolUses.push(use);
					if (b.id) {
						uses.set(b.id, use);
					}
				}
			}
		}
		if (e.type === 'user' && Array.isArray(e.message?.content)) {
			for (const b of e.message.content as { type?: string; is_error?: boolean; tool_use_id?: string; content?: unknown }[]) {
				if (b.type === 'tool_result' && b.is_error) {
					const use = b.tool_use_id ? uses.get(b.tool_use_id) : undefined;
					const text = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map(x => str((x as { text?: unknown }).text) ?? '').join('\n') : '';
					f.toolErrors.push({ tool: use?.name ?? 'unknown', input: use?.input ?? {}, error: text.replace(/<\/?tool_use_error>/g, '').trim().slice(0, 600), at });
				}
			}
		}
		const prompt = promptText(e);
		if (prompt) {
			f.prompts.push({ text: prompt.slice(0, 2000), at });
		}
		if (e.type === 'system') {
			if (e.subtype === 'compact_boundary') {
				f.compactions++;
				f.lastUsage = undefined; // the window was rebuilt: only usage after this describes it
			} else if (e.subtype === 'stop_hook_summary') {
				for (const h of e.hookInfos ?? []) {
					if (h.command) {
						f.stopHooks.push({ command: h.command, durationMs: typeof h.durationMs === 'number' ? h.durationMs : undefined, at });
					}
				}
			} else if (e.subtype === 'local_command' && typeof e.content === 'string') {
				const report = parseContextReport(e.content, at);
				if (report) {
					f.context = report;
				}
			}
		}
		const a = e.attachment;
		if (e.type === 'attachment' && a) {
			switch (a.type) {
				case 'instructions':
					for (const file of Array.isArray(a.files) ? a.files as { path?: string; type?: string; content?: string }[] : []) {
						if (file.path && !f.memory.some(m => m.path === file.path)) {
							f.memory.push({ path: file.path, type: file.type, chars: len(file.content) });
						}
					}
					break;
				case 'nested_memory': {
					const p = str(a.path) ?? str((a.content as { path?: unknown } | undefined)?.path);
					if (p) {
						f.nested.push({ path: p, chars: len(a.content), at });
					}
					break;
				}
				case 'skill_listing':
					f.skillListingChars = Math.max(f.skillListingChars, len(a.content));
					break;
				case 'agent_listing_delta':
					f.agentListingChars += len(a.addedLines);
					break;
				case 'mcp_instructions_delta': {
					const names = Array.isArray(a.addedNames) ? a.addedNames as string[] : [];
					const blocks = Array.isArray(a.addedBlocks) ? a.addedBlocks as string[] : [];
					names.forEach((server, i) => {
						if (!f.mcpInstructions.some(m => m.server === server)) {
							f.mcpInstructions.push({ server, chars: len(blocks[i]) });
						}
					});
					break;
				}
				case 'deferred_tools_delta':
					for (const n of Array.isArray(a.addedNames) ? a.addedNames as string[] : []) {
						if (n.startsWith('mcp__')) {
							mcpTools.add(n);
						}
					}
					break;
				case 'invoked_skills':
					for (const s of Array.isArray(a.skills) ? a.skills as { name?: string }[] : []) {
						if (s.name && !f.invokedSkills.includes(s.name)) {
							f.invokedSkills.push(s.name);
						}
					}
					break;
				case 'hook_blocking_error':
				case 'hook_non_blocking_error':
					f.hookErrors.push({
						hookName: str(a.hookName) ?? '', event: str(a.hookEvent), blocking: a.type === 'hook_blocking_error',
						message: (str(a.stderr) ?? str((a.blockingError as { blockingError?: unknown } | undefined)?.blockingError) ?? '').slice(0, 400), at,
					});
					break;
			}
		}
	}
	f.mcpTools = [...mcpTools];
	return f;
}

/** `mcp__github__create_issue` → `github`; undefined for a tool that is not an MCP tool. */
export function mcpServerOf(tool: string): string | undefined {
	const m = /^mcp__(.+?)__[^_].*$/.exec(tool);
	return m?.[1];
}

/** The name an MCP server's tools carry: `.` and spaces become `_`, as Claude Code writes them. */
export function mcpToolPrefix(server: string): string {
	return server.replace(/[^\w-]/g, '_');
}

/** Axle's own observer hook and the SDK's in-process callbacks: never counted as the user's hooks. */
export function isAxleHook(command: string): boolean {
	return command === 'callback' || /flow-hook\.js|codex-hook\.js/.test(command);
}

/** A path with `.` and `..` resolved and `/` separators; undefined for a relative path. */
function absoluteNorm(p: string): string | undefined {
	const s = p.replace(/\\/g, '/');
	const drive = /^[A-Za-z]:\//.exec(s)?.[0];
	if (!drive && !s.startsWith('/')) {
		return undefined;
	}
	const out: string[] = [];
	for (const seg of s.slice(drive ? drive.length : 1).split('/')) {
		if (seg === '..') {
			out.pop();
		} else if (seg && seg !== '.') {
			out.push(seg);
		}
	}
	return `${drive ? drive.toLowerCase() : '/'}${out.join('/')}`;
}

/**
 * Whether `p` is a Claude Code transcript: a .jsonl file inside `configDir`/projects (~/.claude unless CLAUDE_CONFIG_DIR
 * says otherwise) once `..` is resolved. Paths come from
 * other extensions' commands; only these files are ever read as transcripts.
 */
export function isTranscriptPath(p: unknown, configDir: string): p is string {
	if (typeof p !== 'string' || !/\.jsonl$/i.test(p)) {
		return false;
	}
	const file = absoluteNorm(p);
	const root = absoluteNorm(`${configDir.replace(/\\/g, '/')}/projects`);
	if (!file || !root) {
		return false;
	}
	const windows = /^[a-z]:\//.test(root);
	const [f, r] = windows ? [file.toLowerCase(), root.toLowerCase()] : [file, root];
	return f.startsWith(`${r}/`);
}
