/*---------------------------------------------------------------------------------------------
 *  Axle Harness: the text edits behind the MCP server manager. Each function turns a config file's
 *  current text into the new text and touches only the server it is about: JSON through jsonc-parser's
 *  edits (comments, key order and indentation elsewhere stay as they are), TOML through the line
 *  edits in mcptoml.ts. Also the command lines for the agents' own CLIs, which the manager prefers
 *  when they can be started without a shell:
 *    claude mcp add-json <name> <json> --scope user|project|local   (https://code.claude.com/docs/en/mcp)
 *    claude mcp remove <name> --scope …
 *    codex mcp add <name> [--env K=V]… -- <command> [args…]  |  codex mcp add <name> --url <url>
 *    codex mcp remove <name>                                          (`codex mcp add --help`, 0.162)
 *  The Codex CLI writes only $CODEX_HOME/config.toml, so a Codex project server is always a file edit.
 *
 *  Pure (no vscode), so it is tested on its own.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { applyEdits, modify, type FormattingOptions } from 'jsonc-parser';
import { parseJson, type McpHarness, type McpServer } from './mcpconfig';
import { parseToml, setKey, setTable } from './mcptoml';

/** What the manager's forms collect. Values in `env` and `headers` are the real ones (secrets included). */
export interface ServerDef {
	transport: 'stdio' | 'http' | 'sse';
	command?: string;
	args?: string[];
	url?: string;
	env?: Record<string, string>;
	headers?: Record<string, string>;
}

/** Names both agents accept: Codex needs [A-Za-z0-9_-], and Claude Code's allowlists the same. */
export const NAME = /^[A-Za-z0-9_-]{1,64}$/;

const STDIO_KEYS = ['command', 'args', 'env', 'cwd', 'env_vars'];
const HTTP_KEYS = ['url', 'headers', 'headersHelper', 'oauth', 'http_headers', 'env_http_headers', 'bearer_token_env_var'];

const nonEmpty = (m?: Record<string, string>) => m && Object.keys(m).length ? m : undefined;

/** A Claude Code entry for `def`, keeping every key of `raw` (timeout, oauth, alwaysLoad…) that still applies to the transport. */
export function claudeEntry(def: ServerDef, raw: Record<string, unknown> = {}): Record<string, unknown> {
	const out: Record<string, unknown> = { ...raw };
	for (const k of def.transport === 'stdio' ? HTTP_KEYS : STDIO_KEYS) {
		delete out[k];
	}
	out.type = def.transport;
	if (def.transport === 'stdio') {
		out.command = def.command ?? '';
		out.args = def.args ?? [];
		if (def.env !== undefined) {
			out.env = def.env;
		}
	} else {
		out.url = def.url ?? '';
		if (def.headers !== undefined) {
			out.headers = def.headers;
		}
		if (out.headers && !Object.keys(out.headers as object).length) {
			delete out.headers;
		}
	}
	// `type` first, as Claude Code writes it, then the rest in their old order.
	const { type, ...rest } = out;
	return { type, ...rest };
}

/** A Codex `[mcp_servers.<name>]` table for `def`, keeping the keys of `raw` (enabled_tools, timeouts…) that still apply. */
export function codexEntry(def: ServerDef, raw: Record<string, unknown> = {}): Record<string, unknown> {
	const out: Record<string, unknown> = { ...raw };
	for (const k of def.transport === 'stdio' ? HTTP_KEYS : STDIO_KEYS) {
		delete out[k];
	}
	delete out.type;
	if (def.transport === 'stdio') {
		out.command = def.command ?? '';
		out.args = def.args ?? [];
		if (def.env !== undefined) {
			out.env = nonEmpty(def.env);
		}
	} else {
		out.url = def.url ?? '';
		if (def.headers !== undefined) {
			out.http_headers = nonEmpty(def.headers);
		}
	}
	return out;
}

/** The indentation and line ends a JSON file already uses, so an edit looks like the rest of it. */
function formatting(text: string): FormattingOptions {
	const indent = /\n([ \t]+)\S/.exec(text)?.[1] ?? '  ';
	return { insertSpaces: !indent.startsWith('\t'), tabSize: indent.startsWith('\t') ? 1 : indent.length, eol: text.includes('\r\n') ? '\r\n' : '\n' };
}

/** `value` at `keyPath` in a JSON file (undefined removes it); an empty file becomes an object. */
export function jsonSet(text: string, keyPath: string[], value: unknown): string {
	const base = text.trim() ? text : '{}\n';
	const { value: parsed, error } = parseJson(base);
	if (error || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error(error ? `not valid JSON (${error})` : 'does not hold a JSON object');
	}
	// A parent that is not an object (a "projects" that is a list) cannot take the key: say so instead of replacing it.
	let at: unknown = parsed;
	for (const k of keyPath.slice(0, -1)) {
		at = (at as Record<string, unknown>)?.[k];
		if (at === undefined) {
			break;
		}
		if (!at || typeof at !== 'object' || Array.isArray(at)) {
			throw new Error(`"${k}" is not an object`);
		}
	}
	if (value === undefined && at === undefined) {
		return text;
	}
	const out = applyEdits(base, modify(base, keyPath, value, { formattingOptions: formatting(base) }));
	return text.trim() ? out : out.replace(/\s*$/, '\n');
}

/** Adds `name` to (or removes it from) the string list at `listPath`, leaving the other names in their order. */
export function jsonList(text: string, listPath: string[], name: string, present: boolean): string {
	const { value } = parseJson(text.trim() ? text : '{}');
	let cur: unknown = value;
	for (const k of listPath) {
		cur = cur && typeof cur === 'object' && !Array.isArray(cur) ? (cur as Record<string, unknown>)[k] : undefined;
	}
	if (cur !== undefined && !Array.isArray(cur)) {
		throw new Error(`"${listPath[listPath.length - 1]}" is not a list`);
	}
	const list = (cur as unknown[] | undefined) ?? [];
	if (present === list.includes(name)) {
		return text;
	}
	return jsonSet(text, listPath, present ? [...list, name] : list.filter(x => x !== name));
}

/** Writes, replaces or (entry undefined) removes the server at `keyPath` in a JSON or TOML file. */
export function setServer(text: string, format: 'json' | 'toml', keyPath: string[], entry: Record<string, unknown> | undefined): string {
	return format === 'json' ? jsonSet(text, keyPath, entry) : setTable(text, keyPath, entry);
}

/** Codex's switch: `enabled = false` in the server's table; turning it back on removes the line (on is the default). */
export function setCodexEnabled(text: string, keyPath: string[], enabled: boolean): string {
	return setKey(text, keyPath, 'enabled', enabled ? undefined : false);
}

/** The part of a file a change is about, for the preview: the values at `keyPaths` (JSON) or the server's tables (TOML), never the rest of the file. */
export function excerpt(text: string, format: 'json' | 'toml', keyPaths: string[][]): string {
	if (format === 'toml') {
		const doc = parseToml(text);
		const lines = text.split(/\r?\n/);
		const parts = keyPaths.map(p => {
			const tables = doc.tables.filter(t => p.every((k, n) => t.path[n] === k));
			return tables.length ? tables.map(t => lines.slice(t.start, t.end).join('\n')).join('\n\n') : `# [${p.join('.')}] is not there`;
		});
		return parts.join('\n\n') + '\n';
	}
	const { value } = parseJson(text.trim() ? text : '{}');
	return keyPaths.map(p => {
		let cur: unknown = value;
		for (const k of p) {
			cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined;
		}
		return `// ${p.map(k => JSON.stringify(k)).join(' › ')}\n${cur === undefined ? '// (not there)' : JSON.stringify(cur, null, 2)}`;
	}).join('\n\n') + '\n';
}

// ---------------------------------------------------------------------------------------------
// The agents' CLIs

export type ClaudeCliScope = 'user' | 'project' | 'local';

export function claudeAddArgs(name: string, def: ServerDef, scope: ClaudeCliScope): string[] {
	return ['mcp', 'add-json', name, JSON.stringify(claudeEntry(def)), '--scope', scope];
}

export function claudeRemoveArgs(name: string, scope: ClaudeCliScope): string[] {
	return ['mcp', 'remove', name, '--scope', scope];
}

/** `codex mcp add`, or undefined when the definition needs what the CLI cannot say (headers on an HTTP server). */
export function codexAddArgs(name: string, def: ServerDef): string[] | undefined {
	if (def.transport === 'stdio') {
		return ['mcp', 'add', name, ...Object.entries(def.env ?? {}).flatMap(([k, v]) => ['--env', `${k}=${v}`]), '--', def.command ?? '', ...(def.args ?? [])];
	}
	if (def.transport === 'http' && !Object.keys(def.headers ?? {}).length) {
		return ['mcp', 'add', name, '--url', def.url ?? ''];
	}
	return undefined;
}

export const codexRemoveArgs = (name: string) => ['mcp', 'remove', name];

/**
 * A program on PATH that can be started without a shell: on Windows a .exe or .com (a .cmd shim needs cmd.exe, so the
 * caller falls back to editing the file); elsewhere the first match.
 */
export function findExecutable(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, isFile: (p: string) => boolean): string | undefined {
	const pathVar = env.PATH ?? env.Path ?? '';
	const p = platform === 'win32' ? path.win32 : path.posix;
	const dirs = pathVar.split(platform === 'win32' ? ';' : ':').filter(Boolean);
	const exts = platform === 'win32' ? ['.exe', '.com'] : [''];
	for (const d of dirs) {
		for (const e of exts) {
			const f = p.join(d.replace(/^"|"$/g, ''), name + e);
			if (isFile(f)) {
				return f;
			}
		}
	}
	return undefined;
}

/** A command line as the confirm dialog shows it: one line, quoted where needed, secrets already masked by the caller. */
export function commandLine(program: string, args: string[]): string {
	const q = (a: string) => /^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/(["\\])/g, '\\$1')}"`;
	return [program, ...args].map(q).join(' ');
}

/** Splits what the user typed as "command and arguments", honouring double and single quotes. */
export function splitCommandLine(line: string): string[] {
	const out: string[] = [];
	let cur = '';
	let quote: string | undefined;
	let has = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (quote) {
			if (c === quote) {
				quote = undefined;
			} else if (c === '\\' && quote === '"' && (line[i + 1] === '"' || line[i + 1] === '\\')) {
				cur += line[++i];
			} else {
				cur += c;
			}
		} else if (c === '"' || c === "'") {
			quote = c;
			has = true;
		} else if (/\s/.test(c)) {
			if (cur || has) {
				out.push(cur);
			}
			cur = '';
			has = false;
		} else {
			cur += c;
		}
	}
	if (cur || has) {
		out.push(cur);
	}
	return out;
}

/** What a server currently is, as a ServerDef the forms can start from (values included: they stay in the host). */
export function defOf(s: McpServer): ServerDef {
	return {
		transport: s.transport === 'http' || s.transport === 'sse' ? s.transport : 'stdio',
		command: s.command, args: [...s.args], url: s.url, env: { ...s.env }, headers: { ...s.headers },
	};
}

/** Where a new server goes, per harness and scope. */
export function targetFile(harness: McpHarness, scope: 'user' | 'project' | 'local', files: { claudeJson: string; mcpJson: string; codexUser: string; codexProject: string }, projectKey: string): { file: string; format: 'json' | 'toml'; keyPath: string[] } {
	if (harness === 'Codex') {
		return { file: scope === 'project' ? files.codexProject : files.codexUser, format: 'toml', keyPath: ['mcp_servers'] };
	}
	return scope === 'project' ? { file: files.mcpJson, format: 'json', keyPath: ['mcpServers'] }
		: scope === 'local' ? { file: files.claudeJson, format: 'json', keyPath: ['projects', projectKey, 'mcpServers'] }
			: { file: files.claudeJson, format: 'json', keyPath: ['mcpServers'] };
}
