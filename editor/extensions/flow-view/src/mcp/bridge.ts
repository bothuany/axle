/*---------------------------------------------------------------------------------------------
 *  Axle agent bridge, window side: a local HTTP server (127.0.0.1, random port, random token) that
 *  runs the `axle` MCP server's tool calls, advertised in ~/.axle/bridge/<pid>.json while the window
 *  lives. The file is removed when the window closes; files of windows that were killed are cleaned
 *  up by whoever starts next. Claude's /ide lock files (~/.claude/ide) are not touched.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { startBridgeServer, type BridgeServer } from './http';
import { AgentTools, type ToolDeps } from './handlers';
import { bridgeDir, cleanStale, removeBridgeFileSync, writeBridgeFile } from './registry';

export class AgentBridge implements vscode.Disposable {
	private server: BridgeServer | undefined;
	private disposed = false;
	private readonly startedAt = Date.now();
	private readonly disposables: vscode.Disposable[] = [];
	private readonly tools: AgentTools;

	constructor(deps: ToolDeps, private readonly log: vscode.LogOutputChannel) {
		this.tools = new AgentTools(deps);
	}

	/** The uncommitted changes on the flow canvas (marks and the affected flow); `only` narrows them to files or folders. */
	async showChangesInFlow(only?: string[]) {
		const tools = this.tools;
		const rows = only ? (await tools.changesOf(only)).list : undefined;
		return tools.changesInFlow(rows, true).catch(e => ({ ok: false, opened: false, message: (e as Error).message }));
	}

	/** A failure (no port, an unwritable home folder) is logged and leaves Axle working without the bridge. */
	async start() {
		try {
			const server = await startBridgeServer((tool, args) => this.tools.call(tool, args), { log: m => this.log.warn(m), info: () => ({ pid: process.pid }) });
			if (this.disposed) {
				await server.close();
				return;
			}
			this.server = server;
			await cleanStale(bridgeDir(), undefined, process.pid);
			await this.write();
			// Folders opened or closed later change which agents belong to this window.
			this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => void this.write().catch(() => undefined)));
			this.log.info(`Agent bridge listening on 127.0.0.1:${server.port}`);
		} catch (e) {
			this.log.error(`Agent bridge did not start: ${(e as Error)?.stack ?? e}`);
			await this.server?.close().catch(() => undefined);
			this.server = undefined;
		}
	}

	private async write() {
		if (!this.server || this.disposed) {
			return;
		}
		await writeBridgeFile({
			pid: process.pid,
			port: this.server.port,
			token: this.server.token,
			workspaceFolders: (vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file').map(f => f.uri.fsPath),
			createdAt: this.startedAt,
		});
	}

	dispose() {
		this.disposed = true;
		this.disposables.forEach(d => d.dispose());
		removeBridgeFileSync(process.pid);
		void this.server?.close();
		this.server = undefined;
	}
}
