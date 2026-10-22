/*---------------------------------------------------------------------------------------------
 *  Insilode agent bridge: the pieces of the `claude mcp add` command line, kept pure so they can be
 *  tested and shown to the user word for word before anything runs.
 *--------------------------------------------------------------------------------------------*/

import { existsSync } from 'fs';
import * as path from 'path';

/** The first `name` (or `name.exe`/`.cmd` on Windows) found on PATH, or undefined. */
export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = existsSync): string | undefined {
	const win = platform === 'win32';
	const sep = win ? ';' : ':';
	const exts = win ? (env.PATHEXT ?? '.EXE;.CMD').split(';').filter(Boolean) : [''];
	const join = win ? path.win32.join : path.posix.join;
	for (const dir of (env.PATH ?? env.Path ?? '').split(sep).filter(Boolean)) {
		for (const ext of exts) {
			const candidate = join(dir.replace(/^"|"$/g, ''), name + ext.toLowerCase());
			if (exists(candidate)) {
				return candidate;
			}
		}
	}
	return undefined;
}

export interface McpCommand {
	/** Words for `claude mcp add`, without the leading `claude`. */
	args: string[];
	/** The Node that will run the server. */
	node: string;
	/** True when PATH has no node and the editor's own is used (it needs ELECTRON_RUN_AS_NODE). */
	electron: boolean;
}

/**
 * `claude mcp add insilode --scope user [-e ELECTRON_RUN_AS_NODE=1] -- <node> <script>`. The name comes first: `-e` takes
 * any number of values, and would swallow it otherwise.
 */
export function mcpAddCommand(script: string, o: { pathNode?: string; execPath: string }): McpCommand {
	const electron = !o.pathNode;
	const node = o.pathNode ?? o.execPath;
	return { node, electron, args: ['mcp', 'add', 'insilode', '--scope', 'user', ...(electron ? ['-e', 'ELECTRON_RUN_AS_NODE=1'] : []), '--', node, script] };
}

/** One argument for a shell line (cmd, PowerShell-free): quoted when it has anything but safe characters. */
export function shellQuote(arg: string, platform: NodeJS.Platform = process.platform): string {
	if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) {
		return arg;
	}
	return platform === 'win32' ? `"${arg.replace(/"/g, '\\"')}"` : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** How to start `claude <args>` without a shell: a file, its arguments, and whether Node must pass them verbatim. */
export interface ClaudeLaunch {
	file: string;
	args: string[];
	windowsVerbatimArguments?: boolean;
}

/**
 * The process that runs `claude <args>`, with no shell parsing the words. On Windows `claude` is either a real .exe (the native
 * installer) or npm's .cmd shim; Node runs a .cmd only through cmd.exe, so that one goes as `cmd.exe /d /s /c "<line>"` with every
 * argument quoted (scripts/lib.mjs does the same). cmd.exe expands %VAR% even inside quotes and a line break ends the command:
 * an argument with either is refused, never rewritten, so what runs is always what the confirmation showed. Undefined when
 * there is no `claude` on PATH.
 */
export function claudeLaunch(args: string[], platform: NodeJS.Platform = process.platform, find: (name: string) => string | undefined = n => findOnPath(n)): ClaudeLaunch | undefined {
	if (platform !== 'win32') {
		return { file: 'claude', args };
	}
	const found = find('claude');
	if (!found) {
		return undefined;
	}
	if (!/\.(cmd|bat)$/i.test(found)) {
		return { file: found, args };
	}
	const line = [found, ...args].map(cmdQuote).join(' ');
	return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true };
}

/**
 * One argument for cmd.exe and then Node's own command line parser, quoted. A " cannot be in a Windows path and would need
 * different escaping for each of the two parsers, so it is refused like % and line breaks; backslashes at the end are doubled,
 * or `"C:\"` would escape its own closing quote and run into the next argument.
 */
function cmdQuote(arg: string): string {
	if (/[%"\r\n]/.test(arg)) {
		throw new Error(`Cannot pass "${arg.replace(/[\r\n]/g, ' ')}" to claude.cmd: cmd.exe would expand a %, end the quotes at a " or cut the line at a line break. Move Insilode or Node to a folder without one.`);
	}
	return `"${arg.replace(/(\\+)$/, '$1$1')}"`;
}

export const commandLine = (args: string[], platform: NodeJS.Platform = process.platform) => ['claude', ...args.map(a => shellQuote(a, platform))].join(' ');

/** The Claude Code MCP config the Insilode agents get with --mcp-config: the `insilode` server for one workspace folder. */
export function mcpConfig(script: string, o: { execPath: string; electron: boolean; workspace?: string }) {
	return {
		mcpServers: {
			insilode: {
				command: o.execPath,
				args: [script],
				env: { ...(o.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}), ...(o.workspace ? { INSILODE_WORKSPACE: o.workspace } : {}) },
			},
		},
	};
}
