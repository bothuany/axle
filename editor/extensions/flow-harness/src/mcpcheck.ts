/*---------------------------------------------------------------------------------------------
 *  Insilode Harness: "Check" for one MCP server. It does what an agent does at session start, once, on
 *  the user's click: starts the server (a stdio process from its own command and argument array, never
 *  through a shell, with no window) or POSTs to its URL, sends `initialize`, `notifications/initialized`
 *  and `tools/list` (following nextCursor), and reports whether that worked, how many tools came back
 *  and roughly what their definitions cost (characters / 4, the estimate the rest of the map uses).
 *  Everything is bounded by a timeout, after which the whole process tree is killed.
 *
 *  The agents' own CLIs can answer too (`claude mcp get <name>` health-checks a server with the sign-in
 *  Claude Code holds for it): runCli runs one with an argument array and the same limits, and the
 *  result says which way the answer came.
 *
 *  Protocol: https://modelcontextprotocol.io/specification (lifecycle, stdio and Streamable HTTP
 *  transports: newline-delimited JSON-RPC on stdio; POST with Accept: application/json,
 *  text/event-stream and an Mcp-Session-Id header over HTTP).
 *
 *  Pure node (no vscode), so it is tested on its own.
 *--------------------------------------------------------------------------------------------*/

import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';

export interface CheckResult {
	ok: boolean;
	/** How the answer was got: Insilode's own handshake, or an agent's CLI. */
	how: 'handshake' | 'claude mcp get' | 'not run';
	/** One line for the page. */
	status: string;
	serverName?: string;
	serverVersion?: string;
	tools?: { name: string; description?: string }[];
	/** Rough tokens of the tool definitions (name, description, input schema), as an agent would be sent them. */
	schemaTokens?: number;
	ms: number;
	/** An HTTP server that wants a sign-in first (401). */
	needsAuth?: boolean;
	/** A Windows .cmd/.bat script: only cmd.exe runs one, and Insilode does not start a shell; the caller may ask the agent's CLI instead. */
	needsShell?: boolean;
	/** The last lines the server wrote to stderr, secrets masked by the caller. */
	stderr?: string;
	at: number;
}

const PROTOCOL = '2025-06-18';
const CLIENT = { name: 'insilode-harness', version: '0.1.0' };
export const DEFAULT_TIMEOUT = 30_000;

/** `${VAR}` and `${VAR:-default}`, as Claude Code expands them in command, args, env, url and headers. */
export function expandVars(value: string, env: NodeJS.ProcessEnv): string {
	return value.replace(/\$\{([A-Za-z_][\w]*)(?::-([^}]*))?\}/g, (whole, name: string, dflt: string | undefined) => env[name] ?? dflt ?? whole);
}

const tokensOf = (v: unknown) => Math.round(JSON.stringify(v).length / 4);

function summary(tools: { name: string; description?: string }[] | undefined, schemaTokens: number | undefined): string {
	return tools ? `${tools.length} tool${tools.length === 1 ? '' : 's'}, ~${(schemaTokens ?? 0).toLocaleString()} tokens of definitions` : 'Started';
}

/** Kills a process and everything it started: `npx` leaves the real server running when only npx is killed. */
export function killTree(child: ChildProcess, platform: NodeJS.Platform = process.platform) {
	if (child.exitCode !== null || child.pid === undefined) {
		return;
	}
	if (platform === 'win32') {
		spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
	} else {
		try {
			// The child leads its own process group (detached), so the negative pid reaches its children too.
			process.kill(-child.pid, 'SIGKILL');
		} catch {
			child.kill('SIGKILL');
		}
	}
}

/**
 * The program a command names, as an absolute path found on PATH (with PATHEXT on Windows), so a bare `node` never
 * resolves to a node.exe sitting in the folder the check runs in. `script` marks a Windows .cmd/.bat.
 */
export function resolveCommand(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, isFile: (p: string) => boolean): { file?: string; script: boolean } {
	const p = platform === 'win32' ? path.win32 : path.posix;
	const isScript = (f: string) => platform === 'win32' && /\.(cmd|bat)$/i.test(f);
	if (/[\\/]/.test(command)) {
		return { file: command, script: isScript(command) };
	}
	const dirs = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
	const exts = platform === 'win32' ? (p.extname(command) ? [''] : ['.com', '.exe', '.bat', '.cmd']) : [''];
	for (const d of dirs) {
		for (const ext of exts) {
			const f = p.join(d.replace(/^"|"$/g, ''), command + ext);
			if (isFile(f)) {
				return { file: f, script: isScript(f) };
			}
		}
	}
	return { script: false };
}

/** What a server may print or send before the check gives up on it. */
const MAX_BYTES = 1 << 20;

interface Rpc { id?: number | string; result?: unknown; error?: { code: number; message: string }; method?: string }

export interface StdioDef { command: string; args: string[]; env: Record<string, string>; cwd?: string }

export function checkStdio(def: StdioDef, opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; isFile: (p: string) => boolean; cwd?: string }): Promise<CheckResult> {
	const started = Date.now();
	const platform = opts.platform ?? process.platform;
	const base = opts.env ?? process.env;
	const env: NodeJS.ProcessEnv = { ...base };
	for (const [k, v] of Object.entries(def.env)) {
		env[k] = expandVars(v, base);
	}
	const command = expandVars(def.command, base);
	const args = def.args.map(a => expandVars(a, base));
	const done = (r: Omit<CheckResult, 'ms' | 'at' | 'how'>): CheckResult => ({ how: 'handshake', ...r, ms: Date.now() - started, at: Date.now() });
	const program = resolveCommand(command, env, platform, opts.isFile);
	if (!program.file) {
		return Promise.resolve(done({ ok: false, status: `Could not start ${command}: not found on PATH` }));
	}
	if (program.script) {
		return Promise.resolve({ ...done({ ok: false, status: `${path.basename(program.file)} is a script only cmd.exe runs, and Insilode does not start a shell` }), how: 'not run', needsShell: true });
	}
	return new Promise(resolve => {
		let child: ChildProcess;
		try {
			child = spawn(program.file!, args, { cwd: def.cwd ? expandVars(def.cwd, base) : opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: platform !== 'win32' });
		} catch (e) {
			resolve(done({ ok: false, status: `Could not start: ${(e as Error).message}` }));
			return;
		}
		let settled = false;
		let stdout = '';
		let stderr = '';
		let initResult: { serverInfo?: { name?: string; version?: string } } | undefined;
		const tools: { name: string; description?: string; inputSchema?: unknown }[] = [];
		const finish = (r: Omit<CheckResult, 'ms' | 'at' | 'how'>) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			child.stdin?.end();
			killTree(child, platform);
			resolve(done({ ...r, stderr: stderr.trim().split(/\r?\n/).slice(-6).join('\n') || undefined }));
		};
		const timer = setTimeout(() => finish({ ok: false, status: initResult ? `Started, but tools/list did not answer within ${Math.round((opts.timeoutMs ?? DEFAULT_TIMEOUT) / 1000)} s` : `No answer to initialize within ${Math.round((opts.timeoutMs ?? DEFAULT_TIMEOUT) / 1000)} s` }), opts.timeoutMs ?? DEFAULT_TIMEOUT);
		const send = (msg: object) => child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
		child.on('error', e => finish({ ok: false, status: `Could not start ${command}: ${(e as NodeJS.ErrnoException).code === 'ENOENT' ? 'not found on PATH' : e.message}` }));
		child.on('exit', code => finish({ ok: false, status: `Exited with code ${code} before answering` }));
		child.stdin?.on('error', () => undefined);
		child.stderr?.on('data', d => stderr = (stderr + d).slice(-4000));
		child.stdout?.on('data', d => {
			stdout += d;
			if (stdout.length > MAX_BYTES) {
				return finish({ ok: false, status: 'Wrote more than 1 MB without a line end: not an MCP server on stdio' });
			}
			let nl: number;
			while ((nl = stdout.indexOf('\n')) >= 0) {
				const line = stdout.slice(0, nl).trim();
				stdout = stdout.slice(nl + 1);
				let m: Rpc;
				try {
					m = JSON.parse(line);
				} catch {
					continue; // Logging on stdout breaks the agents too, but one stray line is not worth failing for.
				}
				if (m.id === 1) {
					if (m.error) {
						return finish({ ok: false, status: `initialize failed: ${m.error.message}` });
					}
					initResult = m.result as typeof initResult;
					send({ method: 'notifications/initialized' });
					send({ id: 2, method: 'tools/list', params: {} });
				} else if (typeof m.id === 'number' && m.id >= 2) {
					if (m.error) {
						// A server without tools may answer tools/list with "method not found".
						return finish({ ok: true, status: `Started; tools/list failed: ${m.error.message}`, serverName: initResult?.serverInfo?.name, serverVersion: initResult?.serverInfo?.version, tools: [] });
					}
					const r = m.result as { tools?: typeof tools; nextCursor?: string };
					tools.push(...(r.tools ?? []));
					if (r.nextCursor && m.id < 50) {
						send({ id: m.id + 1, method: 'tools/list', params: { cursor: r.nextCursor } });
					} else {
						const schemaTokens = tokensOf(tools);
						finish({ ok: true, status: summary(tools, schemaTokens), serverName: initResult?.serverInfo?.name, serverVersion: initResult?.serverInfo?.version, tools: tools.map(t => ({ name: t.name, description: t.description })), schemaTokens });
					}
				}
			}
		});
		send({ id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: CLIENT } });
	});
}

export interface HttpDef { url: string; headers: Record<string, string> }

/** The JSON-RPC answer to request `id` in a response body: plain JSON, or the matching `data:` event of an SSE stream. */
export function rpcFromBody(body: string, contentType: string, id: number): Rpc | undefined {
	if (/text\/event-stream/i.test(contentType)) {
		for (const event of body.split(/\r?\n\r?\n/)) {
			const data = event.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
			try {
				const m = JSON.parse(data) as Rpc;
				if (m.id === id) {
					return m;
				}
			} catch {
				// not JSON: a comment or a ping
			}
		}
		return undefined;
	}
	try {
		const m = JSON.parse(body) as Rpc | Rpc[];
		return Array.isArray(m) ? m.find(x => x.id === id) : m;
	} catch {
		return undefined;
	}
}

export async function checkHttp(def: HttpDef, opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}): Promise<CheckResult> {
	const started = Date.now();
	const env = opts.env ?? process.env;
	const doFetch = opts.fetch ?? fetch;
	const deadline = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT);
	const url = expandVars(def.url, env);
	const headers: Record<string, string> = Object.fromEntries(Object.entries(def.headers).map(([k, v]) => [k, expandVars(v, env)]));
	const done = (r: Omit<CheckResult, 'ms' | 'at' | 'how'>): CheckResult => ({ how: 'handshake', ...r, ms: Date.now() - started, at: Date.now() });
	let session: string | undefined;
	let version = PROTOCOL;
	// Every request goes through here, so none can forget it: redirects are never followed, since the configured headers
	// (an API key, a token read from the environment) would go to wherever the server points. fetch strips only
	// Authorization across origins, not custom headers.
	const send = (init: RequestInit) => doFetch(url, { ...init, redirect: 'manual' });
	const post = async (msg: object, id?: number): Promise<{ status: number; rpc?: Rpc }> => {
		const res = await send({
			method: 'POST', signal: deadline,
			headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': version, ...(session ? { 'mcp-session-id': session } : {}), ...headers },
			body: JSON.stringify({ jsonrpc: '2.0', ...msg }),
		});
		session = res.headers.get('mcp-session-id') ?? session;
		if (res.status >= 300 && res.status < 400) {
			await res.body?.cancel().catch(() => undefined);
			throw Object.assign(new Error(`HTTP ${res.status}: redirects${res.headers.get('location') ? ` to ${new URL(res.headers.get('location')!, url).host}` : ''}, which the check does not follow with your headers`), { name: 'Redirect' });
		}
		if (id === undefined || res.status >= 400) {
			await res.body?.cancel().catch(() => undefined);
			return { status: res.status };
		}
		// An SSE answer may stay open after the reply: read until the reply arrives, then stop.
		const type = res.headers.get('content-type') ?? '';
		let body = '';
		const reader = res.body?.getReader();
		const decoder = new TextDecoder();
		for (; reader;) {
			const { value, done: end } = await reader.read();
			if (end) {
				break;
			}
			body += decoder.decode(value, { stream: true });
			if (body.length > MAX_BYTES) {
				await reader.cancel().catch(() => undefined);
				throw Object.assign(new Error('The answer is larger than 1 MB'), { name: 'TooLarge' });
			}
			const rpc = rpcFromBody(body, type, id);
			if (rpc) {
				await reader.cancel().catch(() => undefined);
				return { status: res.status, rpc };
			}
		}
		return { status: res.status, rpc: rpcFromBody(body, type, id) };
	};
	try {
		const init = await post({ id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: CLIENT } }, 1);
		if (init.status === 401 || init.status === 403) {
			return done({ ok: false, needsAuth: true, status: `Needs sign-in (HTTP ${init.status}): sign in from the agent (/mcp in Claude Code, \`codex mcp login\`)` });
		}
		if (init.status >= 400 || !init.rpc) {
			return done({ ok: false, status: init.status >= 400 ? `HTTP ${init.status} to initialize` : 'No JSON-RPC answer to initialize' });
		}
		if (init.rpc.error) {
			return done({ ok: false, status: `initialize failed: ${init.rpc.error.message}` });
		}
		const info = init.rpc.result as { protocolVersion?: string; serverInfo?: { name?: string; version?: string } };
		version = info.protocolVersion ?? version;
		await post({ method: 'notifications/initialized' });
		const tools: { name: string; description?: string }[] = [];
		let cursor: string | undefined;
		for (let id = 2; id < 50; id++) {
			const r = await post({ id, method: 'tools/list', params: cursor ? { cursor } : {} }, id);
			if (r.rpc?.error || !r.rpc) {
				return done({ ok: true, status: `Started; tools/list failed${r.rpc?.error ? `: ${r.rpc.error.message}` : ` (HTTP ${r.status})`}`, serverName: info.serverInfo?.name, serverVersion: info.serverInfo?.version, tools: [] });
			}
			const page = r.rpc.result as { tools?: typeof tools; nextCursor?: string };
			tools.push(...(page.tools ?? []));
			cursor = page.nextCursor;
			if (!cursor) {
				break;
			}
		}
		// Ending the session is a courtesy; a server that does not support it says 405.
		if (session) {
			// A redirect answer is simply not followed: the session ends when it times out on the server.
			void send({ method: 'DELETE', headers: { 'mcp-session-id': session, ...headers }, signal: AbortSignal.timeout(3000) })
				.then(res => res.body?.cancel(), () => undefined).catch(() => undefined);
		}
		const schemaTokens = tokensOf(tools);
		return done({ ok: true, status: summary(tools, schemaTokens), serverName: info.serverInfo?.name, serverVersion: info.serverInfo?.version, tools: tools.map(t => ({ name: t.name, description: t.description })), schemaTokens });
	} catch (e) {
		const err = e as Error & { cause?: { code?: string } };
		return done({ ok: false, status: err.name === 'TimeoutError' || err.name === 'AbortError' ? `No answer within ${Math.round((opts.timeoutMs ?? DEFAULT_TIMEOUT) / 1000)} s` : err.name === 'Redirect' || err.name === 'TooLarge' ? err.message : `Could not connect: ${err.cause?.code ?? err.message}` });
	}
}

export interface CliRun { code: number | null; out: string; timedOut: boolean }

/** Runs an agent CLI with an argument array (no shell, no window), in `cwd`, killed after `timeoutMs`. */
export function runCli(program: string, args: string[], opts: { cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }): Promise<CliRun> {
	return new Promise(resolve => {
		let out = '';
		let timedOut = false;
		let child: ChildProcess;
		try {
			child = spawn(program, args, { cwd: opts.cwd, env: opts.env ?? process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
		} catch (e) {
			resolve({ code: null, out: (e as Error).message, timedOut: false });
			return;
		}
		const timer = setTimeout(() => {
			timedOut = true;
			killTree(child);
		}, opts.timeoutMs ?? 60_000);
		child.stdout?.on('data', d => out = (out + d).slice(-20_000));
		child.stderr?.on('data', d => out = (out + d).slice(-20_000));
		child.on('error', e => {
			clearTimeout(timer);
			resolve({ code: null, out: e.message, timedOut });
		});
		child.on('close', code => {
			clearTimeout(timer);
			resolve({ code, out: out.trim(), timedOut });
		});
	});
}

/**
 * The Status and Issue lines of `claude mcp get <name>` ("Status: ✔ Connected", "Status: ✘ Failed to connect" with
 * "Issue: CONNECTION_CLOSED: …", "⏸ Pending approval"). Only those two lines: the rest of the output prints the
 * server's environment values.
 */
export function parseClaudeGet(out: string): { ok: boolean; status: string } | undefined {
	const line = /^\s*Status:\s*(.+)$/im.exec(out)?.[1]?.trim();
	if (!line) {
		return undefined;
	}
	const issue = /^\s*Issue:\s*(.+)$/im.exec(out)?.[1]?.trim();
	const status = line.replace(/^[^\p{L}]+/u, '');
	return { ok: /connected/i.test(line) && !/fail|not connected/i.test(line), status: issue ? `${status}: ${issue}` : status };
}
