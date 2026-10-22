/*---------------------------------------------------------------------------------------------
 *  Insilode agent bridge: the `insilode` MCP server process. Claude Code starts it (stdio) in the folder it
 *  works in; each tool call finds the Insilode window for that folder at call time (a window reload
 *  changes its port) and forwards the call to it. Everything else (what a tool does, which paths
 *  are allowed) is decided by the window.
 *--------------------------------------------------------------------------------------------*/

import type { Readable, Writable } from 'stream';
import { callBridge, Unreachable } from './http';
import { errorResult, serve, type Forward } from './protocol';
import { bridgeDir, isAlive, matchWindows, readBridges, type BridgeInfo } from './registry';

export interface StdioOptions {
	env?: NodeJS.ProcessEnv;
	argv?: string[];
	cwd?: string;
	stdin: Readable;
	stdout: Writable;
	stderr?: Writable;
	/** Pid liveness check; tests inject their own. */
	alive?: (pid: number) => boolean;
	timeoutMs?: number;
}

/** The folder this server works for: --workspace, else INSILODE_WORKSPACE (AXLE_WORKSPACE in a registration made before the rename), else where it was started. */
export function workspaceOf(argv: string[], env: NodeJS.ProcessEnv, cwd: string): string {
	const i = argv.indexOf('--workspace');
	return (i >= 0 && argv[i + 1]) || env.INSILODE_WORKSPACE || env.AXLE_WORKSPACE || cwd;
}

export function makeForward(o: Required<Pick<StdioOptions, 'env' | 'argv' | 'cwd'>> & Pick<StdioOptions, 'alive' | 'timeoutMs'>): Forward {
	const workspace = workspaceOf(o.argv, o.env, o.cwd);
	return async (tool, args) => {
		const windows = matchWindows(await readBridges(bridgeDir(o.env)), workspace, o.alive ?? isAlive);
		if (!windows.length) {
			return errorResult(`No Insilode window has this folder open (${workspace}). Open the folder in Insilode (and keep that window running), then try again.`);
		}
		let lastError: Error | undefined;
		for (const w of windows) {
			try {
				return await callBridge(w as BridgeInfo, tool, args, o.timeoutMs, o.env.INSILODE_SESSION);
			} catch (e) {
				lastError = e as Error;
				if (!(e instanceof Unreachable)) {
					break; // the window is there but failed: another window of the folder would not know better
				}
			}
		}
		return errorResult(lastError instanceof Unreachable
			? `The Insilode window for ${workspace} is not reachable (${lastError.message}). Reload that Insilode window and try again.`
			: `Insilode did not complete ${tool}: ${lastError?.message}`);
	};
}

/** Runs the server on the given streams; resolves when stdin ends. */
export function runStdio(o: StdioOptions): Promise<void> {
	const env = o.env ?? process.env;
	const log = (message: string) => o.stderr?.write(`[insilode-mcp] ${message}\n`);
	return serve(o.stdin, o.stdout, makeForward({ env, argv: o.argv ?? [], cwd: o.cwd ?? process.cwd(), alive: o.alive, timeoutMs: o.timeoutMs }), log);
}
