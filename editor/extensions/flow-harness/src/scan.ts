/*---------------------------------------------------------------------------------------------
 *  Axle Harness: one merged picture of everything that shapes an agent in this workspace —
 *  instructions, rules, skills, subagents, hooks, MCP servers and permission rules — with the
 *  scope each comes from, what it costs in context, and what looks broken.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { globList } from './effective';
import { lint, ruleGlobs, type InstructionKind, type LintFile } from './lint';
import { projectGaps, type Gap } from './gaps';
import { gitIgnoredOf } from './ignored';

export type Scope = 'user' | 'project' | 'local' | 'directory';
export type Kind = 'instructions' | 'rules' | 'skills' | 'agents' | 'hooks' | 'mcp' | 'permissions';
export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
	severity: Severity;
	message: string;
	/** 0-based line in `file`, when the problem is on a line. */
	line?: number;
	/** What to do about it, from the lint. */
	fix?: string;
}

export interface HarnessItem {
	kind: Kind;
	scope: Scope;
	label: string;
	detail: string;
	file: string;
	/** Tokens this costs in every session (memory files, skill descriptions); undefined when unknown. */
	tokens?: number;
	issues: Issue[];
	/** Hooks: what to run and when. */
	hook?: { event: string; matcher?: string; command: string; settingsFile: string };
	/** Hooks and permission rules: the 0-based line they are written on in their settings file. */
	line?: number;
	/** Permission rules: allow / ask / deny. */
	rule?: { effect: 'allow' | 'ask' | 'deny'; pattern: string };
	/** Path-scoped rules: the globs they apply to (empty for an always-on rule). */
	paths?: string[];
	agents: string[];
}

export interface Harness {
	root: string;
	items: HarnessItem[];
	score: number;
	counts: Record<Severity, number>;
	/** What this project has not set up (see gaps.ts); missing instructions also lower the score. */
	gaps: Gap[];
	/** Tokens loaded into every new session before the first prompt. */
	startupTokens: number;
}

const home = os.homedir();
const tokensOf = (text: string) => Math.round(text.length / 4);
const read = (p: string) => fs.readFile(p, 'utf8').catch(() => undefined);
const exists = (p: string) => fs.stat(p).then(() => true, () => false);
const show = (root: string, p: string) => p.startsWith(root + path.sep) ? path.relative(root, p) : p.replace(home, '~');

function frontMatter(text: string): Record<string, string> {
	const m = /^---\r?\n(?<body>[\s\S]*?)\r?\n---/.exec(text);
	const out: Record<string, string> = {};
	const lines = m?.groups?.body.split(/\r?\n/) ?? [];
	let key = '';
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const kv = /^(?<k>[\w-]+):\s*(?<v>.*)$/.exec(line);
		if (!kv?.groups) {
			if (key && /^\s*-\s+/.test(line)) {
				out[key] = [out[key], line.replace(/^\s*-\s+/, '')].filter(Boolean).join(',');
			}
			continue;
		}
		key = kv.groups.k;
		const inline = kv.groups.v.trim();
		const next = () => lines[i + 1] ?? '';
		// `description: >` and `description: |`: the text is the indented lines below, shown as one line.
		if (/^[>|][+-]?\d*$/.test(inline)) {
			const parts: string[] = [];
			while (i + 1 < lines.length && (!next().trim() || /^\s/.test(next()))) {
				parts.push(lines[++i].trim());
			}
			out[key] = parts.join(' ').replace(/\s+/g, ' ').trim();
			continue;
		}
		// A value that goes on over indented lines (or starts on the next one); list items and nested keys are not part of it.
		const parts = inline ? [inline] : [];
		while (/^\s+\S/.test(next()) && !/^\s*-\s+/.test(next()) && (parts.length || !/^\s+[\w-]+:(\s|$)/.test(next()))) {
			parts.push(lines[++i].trim());
		}
		out[key] = parts.join(' ').replace(/^(["'])(.*)\1$/, '$2');
	}
	return out;
}

async function listDir(dir: string): Promise<string[]> {
	return (await fs.readdir(dir).catch(() => [] as string[])).map(n => path.join(dir, n));
}

/**
 * Prose often names a path relative to some project folder ("Data/Extensions/X.cs"): it is only
 * broken when nothing in the workspace ends with it.
 */
const somewhere = new Map<string, Promise<boolean>>();
/** Every distinct path costs a workspace search: past this many in one scan, the rest are given the benefit of the doubt. */
const MAX_LOOKUPS = 25;
function existsSomewhere(ref: string): Promise<boolean> {
	const clean = ref.replace(/^\.\//, '');
	if (!somewhere.has(clean)) {
		if (somewhere.size >= MAX_LOOKUPS) {
			return Promise.resolve(true);
		}
		somewhere.set(clean,Promise.resolve(vscode.workspace.findFiles(`**/${clean}`, '{**/node_modules/**,**/.git/**}', 1)).then(r => r.length > 0, () => true));
	}
	return somewhere.get(clean)!;
}

/**
 * Paths a memory file points at: `@imports` and backticked relative paths that look like files.
 * Only what is clearly meant as a path is checked, so prose never turns into false alarms.
 */
async function brokenPaths(file: string, text: string, root: string): Promise<Issue[]> {
	const issues: Issue[] = [];
	const lines = text.split(/\r?\n/);
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^\s*```/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) {
			continue;
		}
		const candidates: { ref: string; isImport: boolean }[] = [];
		for (const m of line.matchAll(/(?:^|\s)@(?<p>[~.\w/-]+\.\w+)/g)) {
			candidates.push({ ref: m.groups!.p, isImport: true });
		}
		for (const m of line.matchAll(/`(?<p>(?:\.{1,2}\/|[\w.-]+\/)[\w./-]+\.[a-zA-Z]{1,6})`/g)) {
			if (!/[*{}$<>]/.test(m.groups!.p)) {
				candidates.push({ ref: m.groups!.p, isImport: false });
			}
		}
		for (const c of candidates) {
			const target = c.ref.startsWith('~') ? path.join(home, c.ref.slice(1)) : path.resolve(c.ref.startsWith('.') ? path.dirname(file) : root, c.ref);
			if (!await exists(target) && !await exists(path.resolve(path.dirname(file), c.ref)) && !(!c.isImport && await existsSomewhere(c.ref))) {
				issues.push({ severity: c.isImport ? 'error' : 'warning', message: c.isImport ? `Import @${c.ref} does not exist` : `Mentions ${c.ref}, which does not exist`, line: i });
			}
		}
	}
	return issues;
}

async function memoryFile(items: HarnessItem[], root: string, file: string, scope: Scope, agents: string[], where: string) {
	const text = await read(file);
	if (text === undefined) {
		return;
	}
	const tokens = tokensOf(text);
	const issues = await brokenPaths(file, text, root);
	const lines = text.split(/\r?\n/).length;
	if (lines > 300) {
		issues.push({ severity: 'info', message: `${lines} lines: costs about ${tokens.toLocaleString()} tokens in every session` });
	}
	items.push({ kind: 'instructions', scope, label: show(root, file), detail: where, file, tokens: scope === 'directory' ? undefined : tokens, issues, agents });
}

interface HookEntry { matcher?: string; hooks?: { type?: string; command?: string }[] }
interface Settings {
	hooks?: Record<string, HookEntry[]>;
	permissions?: { allow?: string[]; ask?: string[]; deny?: string[]; defaultMode?: string };
	mcpServers?: Record<string, unknown>;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Valid JSON of the wrong shape (`"allow": "Bash"`, `"hooks": []`) must not break the scan of every other file. */
function settingsShape(raw: unknown): Settings {
	if (!isObject(raw)) {
		return {};
	}
	const hooks: Record<string, HookEntry[]> = {};
	for (const [event, entries] of Object.entries(isObject(raw.hooks) ? raw.hooks : {})) {
		hooks[event] = (Array.isArray(entries) ? entries : []).filter(isObject).map(e => ({
			matcher: typeof e.matcher === 'string' ? e.matcher : undefined,
			hooks: (Array.isArray(e.hooks) ? e.hooks : []).filter(isObject).map(h => ({ type: typeof h.type === 'string' ? h.type : undefined, command: typeof h.command === 'string' ? h.command : undefined })),
		}));
	}
	const perms = isObject(raw.permissions) ? raw.permissions : {};
	return {
		hooks,
		permissions: { allow: strings(perms.allow), ask: strings(perms.ask), deny: strings(perms.deny), defaultMode: typeof perms.defaultMode === 'string' ? perms.defaultMode : undefined },
		mcpServers: isObject(raw.mcpServers) ? raw.mcpServers : {},
	};
}

async function settingsFile(items: HarnessItem[], root: string, file: string, scope: Scope) {
	const text = await read(file);
	if (text === undefined) {
		return;
	}
	let s: Settings;
	try {
		s = settingsShape(JSON.parse(text));
	} catch (e) {
		items.push({ kind: 'hooks', scope, label: show(root, file), detail: 'Not valid JSON: the agent ignores this file', file, issues: [{ severity: 'error', message: `Invalid JSON: ${(e as Error).message}` }], agents: ['Claude'] });
		return;
	}
	const lineOf = (needle: string) => Math.max(0, text.split(/\r?\n/).findIndex(l => l.includes(needle)));
	for (const [event, entries] of Object.entries(s.hooks ?? {})) {
		for (const entry of entries) {
			for (const h of entry.hooks ?? []) {
				if (!h.command) {
					continue;
				}
				const issues: Issue[] = [];
				// A script the hook runs must exist, or every matching tool call fails the hook.
				const script = /(?:bash|sh|node|python3?)\s+["']?(?<p>[^\s"']+\.(?:sh|js|mjs|py))/.exec(h.command)?.groups?.p
					?? /^["']?(?<p>[^\s"']+\.(?:sh|js|mjs|py))/.exec(h.command.trim())?.groups?.p;
				if (script) {
					const resolved = script
						.replace(/\$\{CLAUDE_PROJECT_DIR(?::-[^}]*)?\}|\$CLAUDE_PROJECT_DIR\b|%CLAUDE_PROJECT_DIR%/gi, () => root)
						.replace(/\$\{HOME\}|\$HOME\b|%USERPROFILE%/gi, () => home)
						.replace(/^~(?=[\\/]|$)/, () => home);
					// Whatever is still a variable (${CLAUDE_PLUGIN_ROOT}, say) is only known to Claude Code: no verdict, no penalty.
					if (!/[$%]/.test(resolved) && !await exists(path.resolve(root, resolved))) {
						issues.push({ severity: 'error', message: `Script ${script} does not exist`, line: lineOf(script) });
					}
				}
				// Inline shell gets a readable name from the variable it checks or the first program it runs.
				const inlineVar = /\$\{?(?<v>[A-Z][A-Z0-9_]{3,})/.exec(h.command)?.groups?.v;
				const name = script ? path.basename(script)
					: h.command.trim().startsWith('[') || h.command.includes(';') ? `inline script${inlineVar ? ` (${inlineVar})` : ''}`
						: h.command.split(/\s+/).slice(0, 2).map(t => path.basename(t)).join(' ');
				items.push({
					kind: 'hooks', scope, label: name,
					detail: `${event}${entry.matcher ? ` · ${entry.matcher}` : ''}`,
					file, issues, agents: ['Claude'],
					hook: { event, matcher: entry.matcher, command: h.command, settingsFile: file },
					line: lineOf(h.command.slice(0, 60).replace(/"/g, '\\"')),
				});
			}
		}
	}
	for (const effect of ['allow', 'ask', 'deny'] as const) {
		for (const pattern of s.permissions?.[effect] ?? []) {
			items.push({ kind: 'permissions', scope, label: pattern, detail: effect, file, issues: [], agents: ['Claude'], rule: { effect, pattern }, line: lineOf(JSON.stringify(pattern)) });
		}
	}
	for (const name of Object.keys(s.mcpServers ?? {})) {
		items.push({ kind: 'mcp', scope, label: name, detail: `Defined in ${show(root, file)}`, file, issues: [], agents: ['Claude'] });
	}
}

async function skillsIn(items: HarnessItem[], dir: string, scope: Scope, agents: string[]) {
	for (const d of await listDir(dir)) {
		const file = path.join(d, 'SKILL.md');
		const text = await read(file);
		if (text === undefined) {
			continue;
		}
		const fm = frontMatter(text);
		const issues: Issue[] = [];
		if (!fm.description) {
			issues.push({ severity: 'warning', message: 'No description: the agent cannot tell when to use this skill', line: 0 });
		}
		// Only name + description sit in context until the skill is used.
		items.push({ kind: 'skills', scope, label: fm.name || path.basename(d), detail: fm.description ?? '', file, tokens: tokensOf(`${fm.name ?? ''} ${fm.description ?? ''}`), issues, agents });
	}
}

async function agentsIn(items: HarnessItem[], dir: string, scope: Scope) {
	for (const file of (await listDir(dir)).filter(f => f.endsWith('.md'))) {
		const fm = frontMatter(await read(file) ?? '');
		items.push({ kind: 'agents', scope, label: fm.name || path.basename(file, '.md'), detail: fm.description ?? '', file, tokens: tokensOf(`${fm.name ?? ''} ${fm.description ?? ''}`), issues: [], agents: ['Claude'] });
	}
}

async function rulesIn(items: HarnessItem[], root: string, dir: string, scope: Scope, agents: string[], globKey: string) {
	const walk = async (d: string): Promise<string[]> => (await Promise.all((await listDir(d)).map(async p => (await fs.stat(p).catch(() => undefined))?.isDirectory() ? walk(p) : [p]))).flat();
	for (const file of (await walk(dir)).filter(f => /\.mdc?$/.test(f))) {
		const text = await read(file) ?? '';
		const fm = frontMatter(text);
		const always = fm.alwaysApply === 'true' || !fm[globKey];
		items.push({ kind: 'rules', scope, label: path.relative(dir, file), detail: always ? 'Every file' : `Files matching ${fm[globKey]}`, file, tokens: always ? tokensOf(text) : undefined, issues: await brokenPaths(file, text, root), agents, paths: always ? [] : globList(fm[globKey]) });
	}
}

async function mcpJson(items: HarnessItem[], root: string, file: string, scope: Scope) {
	const text = await read(file);
	if (text === undefined) {
		return;
	}
	try {
		const servers = (JSON.parse(text) as { mcpServers?: Record<string, { command?: string; url?: string }> }).mcpServers ?? {};
		for (const [name, def] of Object.entries(servers)) {
			items.push({ kind: 'mcp', scope, label: name, detail: def.url ?? def.command ?? '', file, issues: [], agents: ['Claude'] });
		}
	} catch (e) {
		items.push({ kind: 'mcp', scope, label: show(root, file), detail: 'Not valid JSON', file, issues: [{ severity: 'error', message: `Invalid JSON: ${(e as Error).message}` }], agents: ['Claude'] });
	}
}

/** Same rule allowed in one place and denied in another: the stricter one wins, which surprises people. */
function conflicts(items: HarnessItem[]) {
	const rules = items.filter(i => i.rule);
	for (const r of rules) {
		const clash = rules.find(o => o !== r && o.rule!.pattern === r.rule!.pattern && o.rule!.effect !== r.rule!.effect);
		if (clash && r.rule!.effect === 'allow') {
			r.issues.push({ severity: 'warning', message: `Also "${clash.rule!.effect}" in ${clash.scope} settings, which wins` });
		}
	}
	const seen = new Map<string, HarnessItem>();
	for (const s of items.filter(i => i.kind === 'skills')) {
		const first = seen.get(s.label);
		if (first && first.scope !== s.scope && first.agents.join() === s.agents.join()) {
			s.issues.push({ severity: 'info', message: `Same name as a ${first.scope} skill; one shadows the other` });
		}
		seen.set(s.label, s);
	}
}

/** Which lint rules apply to an item's file. */
function lintKind(i: HarnessItem): InstructionKind | undefined {
	const base = path.basename(i.file).toLowerCase();
	if (i.kind === 'instructions') {
		return base === 'agents.md' ? 'agents-md' : base === 'copilot-instructions.md' ? 'copilot' : 'claude-md';
	}
	if (i.kind === 'rules') {
		return i.agents.includes('Cursor') ? 'cursor-rule' : 'claude-rule';
	}
	return i.kind === 'skills' ? 'skill' : i.kind === 'agents' ? 'agent' : undefined;
}

/** The harness lint (lint.ts) over what the scan found; each finding becomes an issue on the item whose file (and line) it names. */
async function lintItems(items: HarnessItem[], root: string) {
	const seen = new Set<string>();
	const files: LintFile[] = [];
	for (const i of items) {
		const kind = lintKind(i);
		if (kind && !seen.has(i.file)) {
			seen.add(i.file);
			files.push({ file: i.file, label: show(root, i.file), kind, text: await read(i.file) ?? '' });
		}
	}
	// Listing the project is only worth it when some rule is scoped to globs.
	const scoped = files.some(f => (f.kind === 'claude-rule' || f.kind === 'cursor-rule') && ruleGlobs(f).length);
	const limit = 20_000;
	const listed = scoped ? await vscode.workspace.findFiles('**/*', '{**/node_modules/**,**/.git/**,**/.claude/worktrees/**}', limit) : [];
	const findings = lint({
		files,
		hooks: items.filter(i => i.hook).map(i => ({ ...i.hook!, line: i.line ?? 0 })),
		rules: items.filter(i => i.rule).map(i => ({ ...i.rule!, scope: i.scope === 'directory' ? 'project' : i.scope, file: i.file, line: i.line ?? 0 })),
		projectFiles: scoped ? listed.map(u => path.relative(root, u.fsPath).split(path.sep).join('/')) : undefined,
		projectFilesTruncated: listed.length >= limit,
		cwd: root, home,
	});
	for (const f of findings) {
		const here = items.filter(i => i.file === f.file);
		const item = here.find(i => i.line === f.line) ?? here[0];
		item?.issues.push({ severity: f.severity, message: f.message, line: f.line, fix: f.fix });
	}
}

export async function scan(): Promise<Harness | undefined> {
	somewhere.clear();
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return undefined;
	}
	const root = folder.uri.fsPath;
	const items: HarnessItem[] = [];

	// Instructions: user, then project, then nested folders (more specific wins).
	await memoryFile(items, root, path.join(home, '.claude', 'CLAUDE.md'), 'user', ['Claude'], 'Your instructions, every project');
	await memoryFile(items, root, path.join(home, '.codex', 'AGENTS.md'), 'user', ['Codex'], 'Your instructions, every project');
	await memoryFile(items, root, path.join(root, 'CLAUDE.md'), 'project', ['Claude'], 'Loaded in every session');
	await memoryFile(items, root, path.join(root, 'CLAUDE.local.md'), 'local', ['Claude'], 'Yours only, not committed');
	await memoryFile(items, root, path.join(root, 'AGENTS.md'), 'project', ['Codex', 'Cursor'], 'Loaded in every session');
	await memoryFile(items, root, path.join(root, '.github', 'copilot-instructions.md'), 'project', ['Copilot'], 'Copilot reads it in every chat');
	const found = await vscode.workspace.findFiles('**/{CLAUDE,AGENTS}.md', '{**/node_modules/**,**/.git/**,**/bin/**,**/obj/**,**/.claude/worktrees/**}', 200);
	// Git answers with the paths as it was given them.
	const ignored = await gitIgnoredOf(root, found.map(u => u.fsPath));
	const nested = found.filter(u => !ignored.has(u.fsPath));
	for (const uri of nested) {
		if (path.dirname(uri.fsPath) !== root) {
			await memoryFile(items, root, uri.fsPath, 'directory', path.basename(uri.fsPath) === 'CLAUDE.md' ? ['Claude'] : ['Codex', 'Cursor'], `When working under ${path.relative(root, path.dirname(uri.fsPath))}/`);
		}
	}

	await rulesIn(items, root, path.join(root, '.claude', 'rules'), 'project', ['Claude'], 'paths');
	await rulesIn(items, root, path.join(home, '.claude', 'rules'), 'user', ['Claude'], 'paths');
	await rulesIn(items, root, path.join(root, '.cursor', 'rules'), 'project', ['Cursor'], 'globs');

	await skillsIn(items, path.join(root, '.claude', 'skills'), 'project', ['Claude']);
	await skillsIn(items, path.join(root, '.agents', 'skills'), 'project', ['Codex']);
	await skillsIn(items, path.join(root, '.cursor', 'skills'), 'project', ['Cursor']);
	await skillsIn(items, path.join(home, '.claude', 'skills'), 'user', ['Claude']);

	await agentsIn(items, path.join(root, '.claude', 'agents'), 'project');
	await agentsIn(items, path.join(home, '.claude', 'agents'), 'user');

	await settingsFile(items, root, path.join(home, '.claude', 'settings.json'), 'user');
	await settingsFile(items, root, path.join(root, '.claude', 'settings.json'), 'project');
	await settingsFile(items, root, path.join(root, '.claude', 'settings.local.json'), 'local');
	await mcpJson(items, root, path.join(root, '.mcp.json'), 'project');

	conflicts(items);
	await lintItems(items, root);

	const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
	items.forEach(i => i.issues.forEach(x => counts[x.severity]++));
	const gaps = projectGaps(items);
	const score = Math.max(0, 100 - counts.error * 12 - counts.warning * 4 - counts.info - gaps.reduce((a, g) => a + g.cost, 0));
	const claudeStartup = items.filter(i => i.agents.includes('Claude') && i.tokens && (i.kind === 'instructions' || i.kind === 'skills' || i.kind === 'agents' || i.kind === 'rules'));
	return { root, items, score, counts, gaps, startupTokens: claudeStartup.reduce((a, i) => a + (i.tokens ?? 0), 0) };
}
