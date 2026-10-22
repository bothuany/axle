/*---------------------------------------------------------------------------------------------
 *  Insilode agent bridge: the HTTP hop between the `insilode` MCP server (a separate process) and the Insilode
 *  window. The window listens on 127.0.0.1 only, on a random port, and answers requests that carry
 *  its token; like the analyzer, it refuses anything with an Origin header (a web page cannot reach
 *  it) and a Host that is not itself (DNS rebinding). Pure Node: no `vscode`.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes, timingSafeEqual } from 'crypto';
import * as http from 'http';
import type { AddressInfo } from 'net';
import type { BridgeInfo } from './registry';
import type { ToolResult } from './protocol';

export const TOKEN_HEADER = 'x-insilode-token';
const MAX_BODY = 4 * 1024 * 1024;

/** Constant-time comparison; false for anything that is not a string of the same length. */
export function sameSecret(given: unknown, expected: string): boolean {
	return typeof given === 'string' && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export const newToken = () => randomBytes(24).toString('hex');

/** What the caller said about itself. Only the shape is checked: the session is a name the window looks up, never a path or a command. */
export interface Caller {
	session?: string;
}

export type Handler = (tool: string, args: Record<string, unknown>, caller: Caller) => Promise<ToolResult>;

export const SESSION_HEADER = 'x-insilode-session';
const SESSION = /^[A-Za-z0-9_-]{1,64}$/;

export interface BridgeServer {
	port: number;
	token: string;
	close(): Promise<void>;
}

export async function startBridgeServer(handle: Handler, opts: { token?: string; log?: (message: string) => void; info?: () => object; maxBody?: number } = {}): Promise<BridgeServer> {
	const token = opts.token ?? newToken();
	const maxBody = opts.maxBody ?? MAX_BODY;
	let port = 0;
	const reply = (res: http.ServerResponse, status: number, body: object) => {
		res.statusCode = status;
		res.setHeader('content-type', 'application/json');
		res.end(JSON.stringify(body));
	};
	const server = http.createServer((req, res) => {
		// A browser always sends Origin on cross-site requests; our own client never does.
		if (req.headers.origin !== undefined) {
			req.resume();
			return reply(res, 403, { error: 'forbidden' });
		}
		const host = String(req.headers.host ?? '').toLowerCase();
		if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
			req.resume();
			return reply(res, 403, { error: 'forbidden' });
		}
		if (!sameSecret(req.headers[TOKEN_HEADER], token)) {
			req.resume();
			return reply(res, 401, { error: 'unauthorized' });
		}
		if (req.method === 'GET' && req.url === '/ping') {
			req.resume();
			return reply(res, 200, { ok: true, ...opts.info?.() });
		}
		if (req.method !== 'POST' || req.url !== '/call') {
			req.resume();
			return reply(res, 404, { error: 'not found' });
		}
		// Counted in bytes as they arrive, before any decoding: a limit on decoded characters lets a multibyte body be about three times as big.
		const chunks: Buffer[] = [];
		let size = 0;
		let tooBig = false;
		req.on('data', (d: Buffer) => {
			if (tooBig) {
				return;
			}
			size += d.length;
			chunks.push(d);
			if (size > maxBody) {
				tooBig = true;
				reply(res, 413, { error: 'too large' });
				req.destroy();
			}
		});
		req.on('end', () => {
			if (tooBig) {
				return;
			}
			void (async () => {
				let msg: { tool?: unknown; args?: unknown };
				try {
					msg = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof msg;
				} catch {
					return reply(res, 400, { error: 'bad json' });
				}
				if (typeof msg.tool !== 'string') {
					return reply(res, 400, { error: 'missing tool' });
				}
				const args = typeof msg.args === 'object' && msg.args !== null && !Array.isArray(msg.args) ? msg.args as Record<string, unknown> : {};
				try {
					const session = req.headers[SESSION_HEADER];
					reply(res, 200, await handle(msg.tool, args, typeof session === 'string' && SESSION.test(session) ? { session } : {}));
				} catch (e) {
					opts.log?.(`bridge: ${msg.tool} failed: ${(e as Error)?.stack ?? e}`);
					reply(res, 200, { content: [{ type: 'text', text: `${msg.tool} failed: ${(e as Error)?.message ?? e}` }], isError: true } satisfies ToolResult);
				}
			})();
		});
		req.on('error', () => undefined);
	});
	server.on('clientError', (_e, socket) => socket.destroy());
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve());
	});
	server.on('error', () => undefined); // after listening: not an uncaught exception
	port = (server.address() as AddressInfo).port;
	return {
		port,
		token,
		close: () => new Promise<void>(resolve => {
			server.close(() => resolve());
			server.closeAllConnections?.();
		}),
	};
}

/** The window did not answer at all (gone, wrong port): the caller may try another window. */
export class Unreachable extends Error { }

export function callBridge(info: Pick<BridgeInfo, 'port' | 'token'>, tool: string, args: Record<string, unknown>, timeoutMs = 150_000, session?: string): Promise<ToolResult> {
	return new Promise((resolve, reject) => {
		const payload = JSON.stringify({ tool, args });
		const req = http.request({
			host: '127.0.0.1', port: info.port, path: '/call', method: 'POST', timeout: timeoutMs, agent: false,
			headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), [TOKEN_HEADER]: info.token, ...(session && SESSION.test(session) ? { [SESSION_HEADER]: session } : {}) },
		}, res => {
			let body = '';
			res.setEncoding('utf8');
			res.on('data', d => body += d);
			// The window can go away after it started answering (a reload, a crash). The response then emits 'error' ("aborted"),
			// which without a listener is an uncaught exception that ends this whole MCP server; or only 'close'. Either way the
			// tool may already have run, so it is a failure of this call, not an unreachable window to try another one for.
			const broken = (why: string) => reject(new Error(`the Insilode window closed the connection before it finished answering (${why})`));
			res.on('error', e => broken(e.message));
			res.on('close', () => {
				if (!res.complete) {
					broken('closed');
				}
			});
			res.on('end', () => {
				if (res.statusCode === 401 || res.statusCode === 403) {
					return reject(new Unreachable('the Insilode window refused the request (it was restarted?)'));
				}
				try {
					const result = JSON.parse(body) as ToolResult;
					if (res.statusCode !== 200 || !Array.isArray(result?.content)) {
						return reject(new Error(`the Insilode window answered ${res.statusCode}`));
					}
					resolve(result);
				} catch {
					reject(new Error(`the Insilode window sent something unreadable (${res.statusCode})`));
				}
			});
		});
		req.on('timeout', () => req.destroy(new Error(`the Insilode window did not answer within ${Math.round(timeoutMs / 1000)}s`)));
		req.on('error', e => reject((e as NodeJS.ErrnoException).code === 'ECONNREFUSED' || (e as NodeJS.ErrnoException).code === 'ECONNRESET' ? new Unreachable(e.message) : e));
		req.end(payload);
	});
}
