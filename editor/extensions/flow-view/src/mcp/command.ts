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
