/*---------------------------------------------------------------------------------------------
 *  Axle agent bridge: how an MCP server finds the Axle window of a folder. Every window writes
 *  <bridge dir>/<pid>.json (port, token, folders) while it runs; the MCP server reads them and picks
 *  the window whose folder holds its working directory. Pure Node: no `vscode`, so the stdio server
 *  (a separate process) and the tests share it.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface BridgeInfo {
	pid: number;
	port: number;
	token: string;
	workspaceFolders: string[];
	createdAt: number;
}

/** AXLE_BRIDGE_DIR lets tests (and unusual setups) keep this away from the real ~/.axle. */
export const bridgeDir = (env: NodeJS.ProcessEnv = process.env) => env.AXLE_BRIDGE_DIR || path.join(os.homedir(), '.axle', 'bridge');

/** One spelling per path: forward slashes, no trailing slash, and lower case where the file system ignores case. */
export function normalizePath(p: string, platform: NodeJS.Platform = process.platform): string {
	let s = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
	// `file:///c:/x` and `/c:/x` forms: the drive letter is all that matters.
	s = s.replace(/^\/([a-zA-Z]:)/, '$1');
	if (s.length > 1 && s.endsWith('/') && !/^[a-zA-Z]:\/$/.test(s)) {
		s = s.slice(0, -1);
	}
	return platform === 'win32' || platform === 'darwin' ? s.toLowerCase() : s;
}

/** Whether `target` is `folder` or inside it, comparing whole path segments (`C:\foo` does not hold `C:\foobar`). */
export function isInside(folder: string, target: string, platform: NodeJS.Platform = process.platform): boolean {
	const f = normalizePath(folder, platform);
	const t = normalizePath(target, platform);
	return t === f || t.startsWith(f.endsWith('/') ? f : f + '/');
}

/** True for a running process; a process we may not signal (EPERM) is still running. */
export function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === 'EPERM';
	}
}

const file = (dir: string, pid: number) => path.join(dir, `${pid}.json`);

export async function writeBridgeFile(info: BridgeInfo, dir = bridgeDir()): Promise<string> {
	await fs.mkdir(dir, { recursive: true, mode: 0o700 });
	const target = file(dir, info.pid);
	const tmp = `${target}.${process.pid}.tmp`;
	await fs.writeFile(tmp, JSON.stringify(info), { mode: 0o600 });
	await fs.rename(tmp, target);
	return target;
}

export async function removeBridgeFile(pid: number, dir = bridgeDir()): Promise<void> {
	await fs.rm(file(dir, pid), { force: true });
}

/** For shutdown: the process may exit before an asynchronous removal finishes. */
export function removeBridgeFileSync(pid: number, dir = bridgeDir()): void {
	try {
		rmSync(file(dir, pid), { force: true });
	} catch {
		// a stale file is cleaned up by the next window
	}
}

/** Only what has the right shape: the files are plain text on disk and may be damaged or foreign. */
export function parseBridgeInfo(raw: unknown): BridgeInfo | undefined {
	const o = raw as Partial<BridgeInfo> | null;
	if (!o || typeof o !== 'object' || !Number.isInteger(o.pid) || !Number.isInteger(o.port) || typeof o.token !== 'string' || !o.token || !Array.isArray(o.workspaceFolders)) {
		return undefined;
	}
	return {
		pid: o.pid!,
		port: o.port!,
		token: o.token,
		workspaceFolders: o.workspaceFolders.filter((f): f is string => typeof f === 'string'),
		createdAt: typeof o.createdAt === 'number' ? o.createdAt : 0,
	};
}

export async function readBridges(dir = bridgeDir()): Promise<BridgeInfo[]> {
	const out: BridgeInfo[] = [];
	for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
		if (!/^\d+\.json$/.test(name)) {
			continue;
		}
		try {
			const info = parseBridgeInfo(JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')));
			if (info && `${info.pid}.json` === name) {
				out.push(info);
			}
		} catch {
			// unreadable or half written: not a window
		}
	}
	return out;
}

/** Removes the files of windows that are gone (a killed Axle cannot delete its own). Returns the pids it removed. */
export async function cleanStale(dir = bridgeDir(), alive: (pid: number) => boolean = isAlive, keepPid?: number): Promise<number[]> {
	const removed: number[] = [];
	for (const info of await readBridges(dir)) {
		if (info.pid !== keepPid && !alive(info.pid)) {
			await removeBridgeFile(info.pid, dir).catch(() => undefined);
			removed.push(info.pid);
		}
	}
	return removed;
}

/**
 * The live windows that hold `cwd`, best first: the longest matching folder wins (a window with the
 * repository open beats one with its parent), then the newest window.
 */
export function matchWindows(bridges: BridgeInfo[], cwd: string, alive: (pid: number) => boolean = isAlive, platform: NodeJS.Platform = process.platform): BridgeInfo[] {
	const scored: { info: BridgeInfo; length: number }[] = [];
	for (const info of bridges) {
		if (!alive(info.pid)) {
			continue;
		}
		const length = Math.max(-1, ...info.workspaceFolders.filter(f => isInside(f, cwd, platform)).map(f => normalizePath(f, platform).length));
		if (length >= 0) {
			scored.push({ info, length });
		}
	}
	return scored.sort((a, b) => b.length - a.length || b.info.createdAt - a.info.createdAt).map(s => s.info);
}

/**
 * Resolves a path the agent sent to a file inside one of the workspace folders: a relative path is
 * taken from the first folder. Returns undefined for anything outside (including `..` escapes).
 */
export function resolveInWorkspace(input: string, folders: string[], platform: NodeJS.Platform = process.platform): string | undefined {
	if (typeof input !== 'string' || !input || input.includes('\0') || !folders.length) {
		return undefined;
	}
	const win = platform === 'win32';
	const p = win ? path.win32 : path.posix;
	const absolute = win ? /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(input) : input.startsWith('/');
	const resolved = p.normalize(absolute ? input : p.join(folders[0], input));
	return folders.some(f => isInside(f, resolved, platform)) ? resolved : undefined;
}
