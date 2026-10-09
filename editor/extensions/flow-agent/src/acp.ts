/*---------------------------------------------------------------------------------------------
 *  Flow: one ACP adapter process per agent kind, many sessions over it.
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

export class AgentHost implements vscode.Disposable {
	private child: ChildProcess | undefined;
	private starting: Promise<ClientSideConnection> | undefined;
	private readonly sinks = new Map<string, SessionSink>();
	/** Sees every session update, also the ones that arrive outside a request (e.g. the commands list). */
	private readonly anyUpdate = new vscode.EventEmitter<SessionNotification>();
	readonly onAnyUpdate = this.anyUpdate.event;

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
		const script = path.join(this.extensionPath, 'node_modules', ADAPTER[this.kind], 'dist', 'index.js');
		// process.execPath is plain node in server mode and Electron on desktop; ELECTRON_RUN_AS_NODE covers both.
		const child = this.child = spawn(process.execPath, [script], {
			cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
			env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		child.stderr!.on('data', d => this.log.debug(`[${this.kind}] ${String(d).trimEnd()}`));
		child.on('exit', code => {
			this.log.info(`[${this.kind}] adapter exited (${code})`);
			this.child = undefined;
			this.starting = undefined;
		});

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
		await conn.initialize({
			protocolVersion: PROTOCOL_VERSION,
			// Edits go straight to disk; we surface them through the chat's external-edit tracking instead.
			clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
			clientInfo: { name: 'flow', version: '0.1.0' },
		});
		this.log.info(`[${this.kind}] adapter ready`);
		return conn;
	}

	dispose() {
		this.child?.kill();
	}
}

/** Turns an ACP auth failure into something a user can act on. */
export function explain(kind: AgentKind, e: unknown): string {
	const msg = (e as { message?: string })?.message ?? String(e);
	if (/auth/i.test(msg)) {
		return kind === 'codex'
			? 'Codex is not signed in. Run `codex login` in a terminal, then try again.'
			: 'Claude is not signed in. Run `claude` once in a terminal and sign in, then try again.';
	}
	return msg;
}
