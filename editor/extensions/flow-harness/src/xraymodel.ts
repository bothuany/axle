/*---------------------------------------------------------------------------------------------
 *  Axle Harness: the context X-ray's numbers. What fills a session's context window, each part
 *  labelled by how it is known: measured (the API's own token usage), Claude Code's estimate (the
 *  categories `/context` printed), Axle's estimate (about four characters per token), or derived
 *  (a measured total minus estimated parts). Then what looks like waste: MCP servers and skills
 *  that cost tokens in every session and were not used, and oversized memory files. Pure (no vscode).
 *--------------------------------------------------------------------------------------------*/

import type { TranscriptFacts } from './transcript';
import { MIN_SESSIONS, noUseSpan } from './activity';
import { mcpToolPrefix } from './transcript';

export type How = 'measured' | 'claude-estimate' | 'estimate' | 'derived';

export interface Segment {
	label: string;
	tokens: number;
	how: How;
	detail?: string;
}

export interface Waste {
	id: string;
	title: string;
	detail: string;
	tokens?: number;
	how?: How;
	/** What the page offers: open the file, disable a .mcp.json server for this project, run /context, compact. */
	action?: { kind: 'open'; file: string } | { kind: 'disable-mcp'; server: string } | { kind: 'measure' } | { kind: 'compact' };
}

export interface XrayModel {
	agent: string;
	/** What the window holds now: the latest API call's input after the last compaction. */
	used?: number;
	size: number;
	usedHow?: How;
	usedAt?: string;
	/** Where the breakdown comes from. */
	source: 'context' | 'baseline' | 'harness';
	contextAt?: string;
	segments: Segment[];
	waste: Waste[];
	compactions: number;
	/** The transcript was read only in part, so `compactions` is at least this many. */
	partial: boolean;
}

/** About four characters per token: Axle's estimate wherever no tokenizer count exists. */
export const estimate = (chars: number) => Math.round(chars / 4);

export interface HarnessPiece {
	kind: string;
	scope: string;
	label: string;
	file: string;
	tokens?: number;
	agents: string[];
}

export interface XrayInput {
	agent: string;
	cli: string;
	facts?: TranscriptFacts;
	/** The last usage flow-agent reported, when there is no transcript (Codex). */
	reported?: { used: number; size: number };
	items: readonly HarnessPiece[];
	/** Uses in the last 30 days by item, and how many days the counts cover. */
	usesOf: (item: HarnessPiece) => number;
	covered: number;
	/** How many sessions the counts rest on: one session says little about a month. */
	sessions?: number;
	/** Window size when nothing says otherwise. */
	defaultSize?: number;
}

const tok = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);

export function xray(input: XrayInput): XrayModel {
	const f = input.facts;
	const isClaude = input.cli !== 'codex';
	const last = f?.lastUsage;
	const size = f?.context?.size ?? (last && (last.used > 200_000 || /\[1m\]/.test(last.model ?? '')) ? 1_000_000 : input.reported?.size ?? input.defaultSize ?? 200_000);
	const model: XrayModel = {
		agent: input.agent, size, source: 'harness', segments: [], waste: [], compactions: f?.compactions ?? 0, partial: !!f?.partial,
		used: last?.used ?? input.reported?.used, usedHow: last || input.reported ? 'measured' : undefined, usedAt: last?.at,
	};
	const mine = input.items.filter(i => i.agents.includes(isClaude ? 'Claude' : 'Codex'));
	const sumKind = (k: string) => mine.filter(i => i.kind === k).reduce((a, i) => a + (i.tokens ?? 0), 0);

	if (f?.context?.categories.length) {
		model.source = 'context';
		model.contextAt = f.context.at;
		model.segments = f.context.categories.map(c => ({ label: c.name, tokens: c.tokens, how: 'claude-estimate' as const }));
	} else if (f?.firstUsage) {
		model.source = 'baseline';
		const memory = f.memory.reduce((a, m) => a + estimate(m.chars), 0);
		const skills = estimate(f.skillListingChars);
		const agents = estimate(f.agentListingChars);
		const mcp = f.mcpInstructions.reduce((a, m) => a + estimate(m.chars), 0);
		const firstPrompt = estimate(f.prompts[0]?.text.length ?? 0);
		const pieces = memory + skills + agents + mcp + firstPrompt;
		const rest = Math.max(0, f.firstUsage.used - pieces);
		model.segments = ([
			{ label: 'System prompt and tool schemas (built-in and MCP)', tokens: rest, how: 'derived', detail: `The first request (${tok(f.firstUsage.used)}, measured) minus the parts below` },
			{ label: 'Memory files (CLAUDE.md, rules)', tokens: memory, how: 'estimate', detail: f.memory.map(m => m.path.replace(/^.*[\\/]/, '')).join(', ') },
			{ label: 'Skill descriptions', tokens: skills, how: 'estimate' },
			{ label: 'Subagent descriptions', tokens: agents, how: 'estimate' },
			{ label: 'MCP server instructions', tokens: mcp, how: 'estimate', detail: f.mcpInstructions.map(m => m.server).join(', ') },
			{ label: 'Your first prompt', tokens: firstPrompt, how: 'estimate' },
		] as Segment[]).filter(s => s.tokens > 0);
		if (last && last.used > f.firstUsage.used) {
			model.segments.push({ label: f.compactions ? 'Conversation (summary and what followed it)' : 'Conversation since', tokens: last.used - f.firstUsage.used, how: 'derived', detail: 'What is in use now minus the first request' });
		}
	} else {
		model.segments = [
			{ label: isClaude ? 'Instructions (CLAUDE.md)' : 'Instructions (AGENTS.md)', tokens: sumKind('instructions'), how: 'estimate' as const },
			{ label: 'Always-on rules', tokens: sumKind('rules'), how: 'estimate' as const },
			{ label: 'Skill descriptions', tokens: sumKind('skills'), how: 'estimate' as const },
			{ label: 'Subagent descriptions', tokens: sumKind('agents'), how: 'estimate' as const },
		].filter(s => s.tokens > 0);
		if (model.used !== undefined) {
			const known = model.segments.reduce((a, s) => a + s.tokens, 0);
			model.segments.push({ label: 'System prompt, tools and conversation', tokens: Math.max(0, model.used - known), how: 'derived' });
		}
	}

	// What this very session called counts too, whether or not the counters have seen it yet.
	const calledHere = new Set((f?.toolUses ?? []).flatMap(u => u.name === 'Skill' && typeof u.input.skill === 'string' ? [`skill:${u.input.skill.toLowerCase()}`] : u.name.startsWith('mcp__') ? [`mcp:${u.name.split('__')[1]?.toLowerCase()}`] : []));
	const usedHere = (i: HarnessPiece) => calledHere.has(`${i.kind === 'skills' ? 'skill' : 'mcp'}:${(i.kind === 'mcp' ? mcpToolPrefix(i.label) : i.label).toLowerCase()}`);
	const unused = (i: HarnessPiece) => input.usesOf(i) === 0 && !usedHere(i);
	const span = noUseSpan(input.covered, input.sessions ?? MIN_SESSIONS).text;

	// MCP servers: every tool name (and, without tool search, every schema) sits in context whether it is called or not.
	if (isClaude) {
		const servers = new Map<string, HarnessPiece | undefined>();
		mine.filter(i => i.kind === 'mcp').forEach(i => servers.set(i.label, i));
		f?.mcpInstructions.forEach(m => servers.has(m.server) || servers.set(m.server, undefined));
		for (const [server, item] of servers) {
			if (item && !unused(item)) {
				continue;
			}
			if (!item && !unused({ kind: 'mcp', scope: 'user', label: server, file: '', agents: ['Claude'] })) {
				continue;
			}
			const prefix = `mcp__${mcpToolPrefix(server)}__`;
			const measuredTools = f?.context?.items.filter(x => x.name.startsWith(prefix)) ?? [];
			const toolCount = f?.mcpTools.filter(t => t.startsWith(prefix)).length ?? 0;
			const instr = f?.mcpInstructions.find(m => m.server === server);
			const tokens = measuredTools.length ? measuredTools.reduce((a, x) => a + x.tokens, 0) : instr ? estimate(instr.chars) : undefined;
			const how: How | undefined = measuredTools.length ? 'claude-estimate' : instr ? 'estimate' : undefined;
			const fromMcpJson = !!item && /\.mcp\.json$/i.test(item.file) && item.scope === 'project';
			model.waste.push({
				id: `mcp:${server}`,
				title: `MCP server ${server}: ${tokens === undefined ? 'cost unknown' : measuredTools.length ? `~${tok(tokens)} tokens of tool schemas` : `~${tok(tokens)} tokens of instructions`}, never called ${span}`,
				detail: [
					measuredTools.length ? `${measuredTools.length} tool schemas, as /context counted them` : toolCount ? `${toolCount} tools listed (names only while tool search defers them)` : '',
					instr && !measuredTools.length ? 'its server instructions' : '',
					!measuredTools.length ? 'Run /context in the session to see what its tools cost' : '',
				].filter(Boolean).join('; '),
				tokens, how,
				action: fromMcpJson ? { kind: 'disable-mcp', server } : item ? { kind: 'open', file: item.file } : f?.context ? undefined : { kind: 'measure' },
			});
		}
	}

	const idle = mine.filter(i => i.kind === 'skills' && unused(i) && (i.tokens ?? 0) > 0).sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0));
	if (idle.length) {
		const total = idle.reduce((a, i) => a + (i.tokens ?? 0), 0);
		model.waste.push({
			id: 'skills', tokens: total, how: 'estimate',
			title: `${idle.length} skill${idle.length === 1 ? '' : 's'} not used ${span}: ~${tok(total)} tokens of descriptions`,
			detail: `${idle.slice(0, 6).map(i => i.label).join(', ')}${idle.length > 6 ? `, and ${idle.length - 6} more` : ''}. Prune them, or sharpen the description so the agent knows when to reach for one.`,
			action: { kind: 'open', file: idle[0].file },
		});
	}
	for (const i of mine.filter(x => (x.kind === 'instructions' || x.kind === 'rules') && (x.tokens ?? 0) >= 4000)) {
		model.waste.push({
			id: `big:${i.file}`, tokens: i.tokens, how: 'estimate',
			title: `${i.label}: ~${tok(i.tokens ?? 0)} tokens in every session`,
			detail: 'Long memory files cost on every request. Move rarely needed parts into a path-scoped rule or a skill.',
			action: { kind: 'open', file: i.file },
		});
	}
	if (model.used !== undefined && model.used / size > 0.7) {
		model.waste.unshift({ id: 'full', title: `The window is ${Math.round(model.used / size * 100)}% full`, detail: 'Compacting keeps a summary and frees most of it.', action: { kind: 'compact' } });
	}
	return model;
}
