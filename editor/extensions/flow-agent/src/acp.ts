/*---------------------------------------------------------------------------------------------
 *  Insilode: one ACP adapter process per agent kind, many sessions over it.
 *--------------------------------------------------------------------------------------------*/

import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import { Readable, Writable } from 'stream';
import * as vscode from 'vscode';
import {
	ClientSideConnection,
	ndJsonStream,
	PROTOCOL_VERSION,
	type RequestPermissionRequest,
	type RequestPermissionResponse,
	type SessionNotification,
} from '@agentclientprotocol/sdk';
import { agentCwd, agentProcessEnv } from './env';

export type AgentKind = 'claude' | 'codex';

/** Receives the updates of one ACP session (the turn currently streaming, or a history replay). */
export interface SessionSink {
	onUpdate(n: SessionNotification): void;
	onPermission(r: RequestPermissionRequest): Promise<RequestPermissionResponse>;
}

const ADAPTER: Record<AgentKind, string> = {
	claude: '@agentclientprotocol/claude-agent-acp',
	codex: '@agentclientprotocol/codex-acp',
};

/** How long an adapter gets to answer `initialize` before it is treated as hung. */
const INIT_TIMEOUT_MS = 30_000;

/** Ends a child and everything it started; on Windows `kill()` alone leaves the adapter's own children running. */
function killTree(child: ChildProcess) {
	if (child.exitCode !== null || child.signalCode !== null) {
		return;
	}
	if (process.platform === 'win32' && child.pid) {
		try {
			spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true }).on('error', () => child.kill());
			return;
		} catch {
			// fall through to a plain kill
		}
	}
	child.kill();
}

export class AgentHost implements vscode.Disposable {
	private child: ChildProcess | undefined;
	private starting: Promise<ClientSideConnection> | undefined;
	private readonly sinks = new Map<string, SessionSink>();
	/** Sees every session update, also the ones that arrive outside a request (e.g. the commands list). */
	private readonly anyUpdate = new vscode.EventEmitter<SessionNotification>();
	readonly onAnyUpdate = this.anyUpdate.event;
	/** The adapter process ended: whatever was live inside it (sessions, configs) is gone with it. */
	private readonly exited = new vscode.EventEmitter<void>();
	readonly onDidExit = this.exited.event;

	constructor(
		readonly kind: AgentKind,
		private readonly extensionPath: string,
		private readonly log: vscode.LogOutputChannel,
	) { }

	connection(): Promise<ClientSideConnection> {
		this.starting ??= this.start().catch(e => {
			this.starting = undefined;
			throw e;
		});
		return this.starting;
	}

	setSink(sessionId: string, sink: SessionSink | undefined) {
		if (sink) {
			this.sinks.set(sessionId, sink);
		} else {
			this.sinks.delete(sessionId);
		}
	}

	private async start(): Promise<ClientSideConnection> {
		if (!vscode.workspace.isTrusted) {
			throw new Error('Trust this workspace to run agents.');
		}
		const script = path.join(this.extensionPath, 'node_modules', ADAPTER[this.kind], 'dist', 'index.js');
		// process.execPath is Electron on desktop (it needs ELECTRON_RUN_AS_NODE to behave as node) and plain node in server mode.
		// The adapter needs it for its own children too, so it stays; the session variables of a host Claude Code do not.
		const child = this.child = spawn(process.execPath, [script], {
			cwd: agentCwd(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath),
			env: agentProcessEnv(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true,
		});
		// A dead adapter takes its sessions with it; only the process that is still current may reset the shared state.
		const gone = (why: string) => {
			this.log.info(`[${this.kind}] adapter ${why}`);
			if (this.child === child) {
				this.child = undefined;
				this.starting = undefined;
				this.exited.fire();
			}
		};
		const dead = new Promise<never>((_, reject) => {
			child.once('error', e => reject(new Error(`could not start the ${this.kind} adapter: ${e.message}`)));
			child.once('exit', code => reject(new Error(`the ${this.kind} adapter exited (${code})`)));
		});
		child.on('error', e => gone(`failed: ${e.message}`));
		child.on('exit', code => gone(`exited (${code})`));
		child.stdin!.on('error', () => undefined); // EPIPE once it is gone: the exit handler reports it
		child.stderr!.on('data', d => this.log.debug(`[${this.kind}] ${String(d).trimEnd()}`));

		const conn = new ClientSideConnection(
			() => ({
				sessionUpdate: async n => {
					this.anyUpdate.fire(n);
					this.sinks.get(n.sessionId)?.onUpdate(n);
				},
				requestPermission: async r =>
					(await this.sinks.get(r.sessionId)?.onPermission(r)) ?? { outcome: { outcome: 'cancelled' } },
			}),
			ndJsonStream(Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>),
		);
		let timer: NodeJS.Timeout | undefined;
		try {
			await Promise.race([
				conn.initialize({
					protocolVersion: PROTOCOL_VERSION,
					// Edits go straight to disk; we surface them through the chat's external-edit tracking instead.
					clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
					clientInfo: { name: 'flow', version: '0.1.0' },
				}),
				dead,
				new Promise<never>((_, reject) => timer = setTimeout(() => reject(new Error(`the ${this.kind} adapter did not answer within ${INIT_TIMEOUT_MS / 1000}s`)), INIT_TIMEOUT_MS)),
			]);
		} catch (e) {
			// No half-started adapter left behind: the next attempt starts a clean one.
			killTree(child);
			gone('stopped (initialize failed)');
			throw e;
		} finally {
			clearTimeout(timer);
		}
		this.log.info(`[${this.kind}] adapter ready`);
		return conn;
	}

	dispose() {
		if (this.child) {
			killTree(this.child);
		}
		this.child = undefined;
		this.exited.dispose();
		this.anyUpdate.dispose();
	}
}

/** Turns an ACP auth failure into something a user can act on. */
export function explain(kind: AgentKind, e: unknown): string {
	const msg = (e as { message?: string })?.message ?? String(e);
	// Only a real "not signed in": a bare /auth/ also matches "author" and "Authorization failed for MCP server …".
	const code = (e as { code?: number })?.code;
	if (code === -32000 || /not (logged|signed) in|(log|sign) in (first|again|required)|please (log|sign) in|\/login\b|auth(entication)?[ _-]required|unauthenticated|invalid api key|invalid (authentication )?credentials|\b401\b/i.test(msg)) {
		return kind === 'codex'
			? 'Codex is not signed in. Run `codex login` in a terminal, then try again.'
			: 'Claude is not signed in. Run `claude` once in a terminal and sign in, then try again.';
	}
	return msg;
}
