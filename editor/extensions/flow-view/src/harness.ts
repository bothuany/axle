/*---------------------------------------------------------------------------------------------
 *  Axle: "what applies here" — for one file, the instructions, rules, hooks and skills an agent
 *  would pick up when it works on that file, across Claude Code, Codex and Cursor conventions.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export type Agent = 'Claude' | 'Codex' | 'Cursor';

export interface ContextItem {
	group: 'instructions' | 'rules' | 'hooks' | 'skills';
	title: string;
	detail: string;
	agents: Agent[];
	file?: string;
}

export interface AgentContext {
	file: string;
	items: ContextItem[];
	/** Skills that exist but did not look related to this file. */
	moreSkills: number;
}

const exists = (p: string) => fs.stat(p).then(() => true, () => false);
const read = (p: string) => fs.readFile(p, 'utf8').catch(() => '');

/** Minimal glob → RegExp: `**`, `*`, `?` and `{a,b}`, matched against a workspace-relative path. */
function globToRegExp(glob: string): RegExp {
	return new RegExp(`^${globSource(glob)}$`);
}

/** The regular expression source of a glob; each `{a,b}` alternative is itself a glob (`{*.ts,*.js}`), so it is converted recursively. */
function globSource(glob: string): string {
	let re = '';
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (c === '*') {
			if (glob[i + 1] === '*') {
				re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
				i += glob[i + 2] === '/' ? 2 : 1;
			} else {
				re += '[^/]*';
			}
		} else if (c === '?') {
			re += '[^/]';
		} else if (c === '{' && closingBrace(glob, i) > i) {
			const end = closingBrace(glob, i);
			re += `(?:${splitGlobs(glob.slice(i + 1, end)).map(globSource).join('|')})`;
			i = end;
		} else {
			re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
		}
	}
	return re;
}

/** The index of the `}` that closes the `{` at `open` (braces nest), or -1. */
function closingBrace(glob: string, open: number): number {
	let depth = 0;
	for (let i = open; i < glob.length; i++) {
		if (glob[i] === '{') {
			depth++;
		} else if (glob[i] === '}' && --depth === 0) {
			return i;
		}
	}
	return -1;
}

/** A comma-separated list of globs; commas inside braces belong to the alternatives, so `src/{a,b}, docs` is two globs. */
function splitGlobs(list: string): string[] {
	const out: string[] = [];
	let cur = '';
	let depth = 0;
	for (const ch of list) {
		if (ch === '{') {
			depth++;
		} else if (ch === '}') {
			depth = Math.max(0, depth - 1);
		}
		if (ch === ',' && depth === 0) {
			out.push(cur);
			cur = '';
		} else {
			cur += ch;
		}
	}
	out.push(cur);
	return out.map(g => g.trim()).filter(Boolean);
}

/** Front matter as flat key → value (lists joined with commas), enough for rules and skills. */
function frontMatter(text: string): Record<string, string> {
	const m = /^---\r?\n(?<body>[\s\S]*?)\r?\n---/.exec(text);
	const out: Record<string, string> = {};
	let key = '';
	for (const line of m?.groups?.body.split(/\r?\n/) ?? []) {
		const kv = /^(?<k>[\w-]+):\s*(?<v>.*)$/.exec(line);
		if (kv?.groups) {
			key = kv.groups.k;
			out[key] = kv.groups.v.replace(/^["']|["']$/g, '');
		} else if (key && /^\s*-\s+/.test(line)) {
			out[key] = [out[key], line.replace(/^\s*-\s+/, '').replace(/^["']|["']$/g, '')].filter(Boolean).join(',');
		}
	}
	return out;
}

async function listFiles(dir: string, match: (name: string) => boolean, depth = 4): Promise<string[]> {
	const out: string[] = [];
	const walk = async (d: string, left: number) => {
		const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => []);
		for (const e of entries) {
			const p = path.join(d, e.name);
			if (e.isDirectory() && left > 0) {
				await walk(p, left - 1);
			} else if (e.isFile() && match(e.name)) {
				out.push(p);
			}
		}
	};
	await walk(dir, depth);
	return out.sort();
}

async function instructions(root: string, file: string): Promise<ContextItem[]> {
	const items: ContextItem[] = [];
	const home = os.homedir();
	const add = async (p: string, agents: Agent[], detail: string) => {
		if (await exists(p)) {
			items.push({ group: 'instructions', title: p.startsWith(root) ? path.relative(root, p) : p.replace(home, '~'), detail, agents, file: p });
		}
	};
	await add(path.join(home, '.claude', 'CLAUDE.md'), ['Claude'], 'Your instructions for every project');
	await add(path.join(home, '.codex', 'AGENTS.md'), ['Codex'], 'Your instructions for every project');
	// Root first, nearest folder last: later files are more specific and win on conflicts.
	const rel = path.relative(root, path.dirname(file));
	const dirs = [root, ...rel.split(path.sep).filter(Boolean).map((_, i, a) => path.join(root, ...a.slice(0, i + 1)))];
	for (const dir of dirs) {
		const where = dir === root ? 'Loaded in every session in this repo' : `Loaded when the agent works under ${path.relative(root, dir)}/`;
		await add(path.join(dir, 'CLAUDE.md'), ['Claude'], where);
		await add(path.join(dir, 'CLAUDE.local.md'), ['Claude'], `${where} (yours only, not committed)`);
		await add(path.join(dir, 'AGENTS.md'), ['Codex', 'Cursor'], where);
	}
	return items;
}

async function rules(root: string, relFile: string): Promise<ContextItem[]> {
	const items: ContextItem[] = [];
	const check = async (p: string, agents: Agent[], globKey: string, alwaysKey?: string) => {
		const fm = frontMatter(await read(p));
		const globs = splitGlobs(fm[globKey] ?? '');
		const always = alwaysKey ? fm[alwaysKey] === 'true' : !globs.length;
		// One rule file with a glob we cannot read must not hide the others.
		const hit = globs.find(g => {
			try {
				return globToRegExp(g).test(relFile);
			} catch {
				return false;
			}
		});
		if (always || hit) {
			items.push({
				group: 'rules',
				title: path.relative(root, p).replace(/^\.(?:claude|cursor)\/rules\//, ''),
				detail: hit ? `Matches ${hit}` : 'Applies to every file',
				agents,
				file: p,
			});
		}
	};
	for (const p of await listFiles(path.join(root, '.claude', 'rules'), n => n.endsWith('.md'))) {
		await check(p, ['Claude'], 'paths');
	}
	for (const p of await listFiles(path.join(root, '.cursor', 'rules'), n => n.endsWith('.mdc') || n.endsWith('.md'))) {
		await check(p, ['Cursor'], 'globs', 'alwaysApply');
	}
	return items;
}

interface HookEntry { matcher?: string; hooks?: { type?: string; command?: string }[] }

/** What a hook command does, in a few words: the script it runs, or the start of the command. */
function hookName(command: string) {
	const script = /(?<name>[\w.-]+\.(?:sh|py|js|mjs|ts|ps1))/.exec(command);
	if (script?.groups) {
		return script.groups.name;
	}
	// A binary: its name and first argument ("/…/bin/blamely record claude" → "blamely record").
	const program = /^(?<bin>\/[^\s]+)(?:\s+(?<arg>[\w-]+))?/.exec(command.trim());
	if (program?.groups) {
		return [path.basename(program.groups.bin), program.groups.arg].filter(Boolean).join(' ');
	}
	return command.length > 48 ? `${command.slice(0, 48)}…` : command;
}

async function hooks(root: string): Promise<ContextItem[]> {
	const items: ContextItem[] = [];
	const sources = [
		{ p: path.join(os.homedir(), '.claude', 'settings.json'), where: 'your settings' },
		{ p: path.join(root, '.claude', 'settings.json'), where: '.claude/settings.json' },
		{ p: path.join(root, '.claude', 'settings.local.json'), where: '.claude/settings.local.json' },
	];
	const edits = ['Edit', 'Write', 'MultiEdit'];
	for (const { p, where } of sources) {
		let config: { hooks?: Record<string, HookEntry[]> };
		try {
			config = JSON.parse(await read(p) || '{}');
		} catch {
			continue;
		}
		for (const [event, entries] of Object.entries(config.hooks ?? {})) {
			const when = event === 'PreToolUse' ? 'Before the agent edits this file' : event === 'PostToolUse' ? 'After the agent edits this file' : event === 'Stop' ? 'When the agent finishes a turn' : undefined;
			if (!when) {
				continue;
			}
			for (const entry of entries) {
				let matches = true;
				// `*` and an empty matcher mean "every tool"; anything else is a regular expression over tool names.
				if (event !== 'Stop' && entry.matcher && entry.matcher !== '*') {
					try {
						const re = new RegExp(`^(?:${entry.matcher})$`);
						matches = edits.some(t => re.test(t));
					} catch {
						matches = false;
					}
				}
				if (!matches) {
					continue;
				}
				for (const h of entry.hooks ?? []) {
					if (h.command) {
						items.push({ group: 'hooks', title: hookName(h.command), detail: `${when}. Set in ${where}.`, agents: ['Claude'], file: p });
					}
				}
			}
		}
	}
	return items;
}

async function skills(root: string, relFile: string): Promise<{ items: ContextItem[]; more: number }> {
	const dirs: { dir: string; agents: Agent[] }[] = [
		{ dir: path.join(root, '.claude', 'skills'), agents: ['Claude'] },
		{ dir: path.join(root, '.agents', 'skills'), agents: ['Codex'] },
		{ dir: path.join(root, '.cursor', 'skills'), agents: ['Cursor'] },
		{ dir: path.join(os.homedir(), '.claude', 'skills'), agents: ['Claude'] },
	];
	// Words from the file's path ("Business", "Commands", "StartSurvey") hint which skills are about it.
	// Only the nearest folders: top-level names (src, Backend) would match every skill.
	const near = relFile.split('/').slice(-4).join('/');
	const words = new Set(near.split(/[\\/._-]|(?=[A-Z][a-z])/).map(w => w.toLowerCase()).filter(w => w.length > 3));
	const scored: (ContextItem & { score: number })[] = [];
	for (const { dir, agents } of dirs) {
		for (const p of await listFiles(dir, n => n === 'SKILL.md', 2)) {
			const fm = frontMatter(await read(p));
			const name = fm.name || path.basename(path.dirname(p));
			const description = fm.description ?? '';
			const text = `${name} ${description}`.toLowerCase();
			const score = [...words].filter(w => text.includes(w) || text.includes(w.replace(/s$/, ''))).length;
			scored.push({ group: 'skills', title: name, detail: description.length > 110 ? `${description.slice(0, 110)}…` : description, agents, file: p, score });
		}
	}
	// The same skill is often shared by several agents: one row, every agent that has it.
	const byName = new Map<string, ContextItem & { score: number }>();
	for (const s of scored) {
		const seen = byName.get(s.title);
		if (seen) {
			seen.agents = [...new Set([...seen.agents, ...s.agents])];
		} else {
			byName.set(s.title, { ...s });
		}
	}
	const unique = [...byName.values()];
	const related = unique.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
	return { items: related.map(({ score: _score, ...item }) => item), more: unique.length - related.length };
}

export async function agentContext(file: string): Promise<AgentContext> {
	const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file));
	const root = folder?.uri.fsPath ?? path.dirname(file);
	const relFile = path.relative(root, file).split(path.sep).join('/');
	const [ins, rul, hks, sk] = await Promise.all([instructions(root, file), rules(root, relFile), hooks(root), skills(root, relFile)]);
	return { file: relFile, items: [...ins, ...rul, ...hks, ...sk.items], moreSkills: sk.more };
}
