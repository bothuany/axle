/*---------------------------------------------------------------------------------------------
 *  Flow as a Claude Code IDE. `claude` in any terminal finds Flow through a lock file in
 *  ~/.claude/ide and talks to it over a local WebSocket (MCP, JSON-RPC). Claude's edits arrive as
 *  `openDiff`: Flow shows the diff, marks the methods on the canvas, and answers with the user's
 *  Accept or Reject. Selections and @-mentions flow the other way, from Flow to the CLI.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { structuredPatch } from 'diff';
import * as vscode from 'vscode';
import { WebSocketServer, type WebSocket } from 'ws';

interface Rpc { jsonrpc: '2.0'; id?: number | string; method?: string; params?: Record<string, unknown> }
type Content = { type: 'text'; text: string }[];

const SCHEME = 'flow-proposed';
const PROTOCOL = '2024-11-05';

interface PendingDiff {
	id: string;
	tab: string;
	file: string;
	proposed: vscode.Uri;
	/** The terminal that asked; when it goes away, only its diffs are rejected. */
	owner: WebSocket;
	resolve: (accepted: boolean) => void;
}

/** Hooks into the rest of Flow: the canvas (to mark what a diff touches) and the agent-change tracker. */
export interface IdeHost {
	propose(p: { id: string; agent: string; title: string; files: string[]; spans: { file: string; start: number; end: number }[] }): void;
	proposalDone(): void;
	/** Right before the CLI writes an accepted diff: remember the file as it was, for Keep/Undo. */
	willEdit(file: string, prompt: string): Promise<void>;
	refresh(): void;
}

export class ClaudeIdeBridge implements vscode.Disposable {
	/** The port new terminals get, plus earlier ports of this folder that agents may still dial. */
	private readonly servers = new Map<number, WebSocketServer>();
	private port = 0;
	private token = randomBytes(16).toString('hex');
	private adoptTimer: NodeJS.Timeout | undefined;
	private readonly clients = new Set<WebSocket>();
	private readonly pending = new Map<string, PendingDiff>();
	private readonly proposals = new Map<string, string>();
	private latestSelection: Record<string, unknown> | undefined;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly status = vscode.window.createStatusBarItem('flow.ide', vscode.StatusBarAlignment.Right, 150);
	private ping: NodeJS.Timeout | undefined;
	private selTimer: NodeJS.Timeout | undefined;
	private seq = 0;

	constructor(private readonly context: vscode.ExtensionContext, private readonly host: IdeHost) {
		this.status.name = 'Claude Code connection';
		this.status.command = 'flow.ide.howTo';
		this.disposables.push(
			vscode.workspace.registerTextDocumentContentProvider(SCHEME, { provideTextDocumentContent: uri => this.proposals.get(uri.toString()) ?? '' }),
			vscode.window.onDidChangeTextEditorSelection(e => this.selectionChanged(e.textEditor)),
			// Closing the diff tab is a rejection, the same as in VS Code's own Claude extension.
			vscode.window.tabGroups.onDidChangeTabs(e => {
				for (const tab of e.closed) {
					const input = tab.input as { modified?: vscode.Uri } | undefined;
					const hit = [...this.pending.values()].find(p => input?.modified?.toString() === p.proposed.toString());
					if (hit) {
						this.answer(hit.id, false);
					}
				}
			}),
		);
	}

	async start() {
		// Shared by every window of this folder, so a `claude` that outlives a window reload still
		// holds a valid token, and can reach the new window on the port it already knows.
		const key = `flow.ide:${vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''}`;
		const saved = this.context.globalState.get<{ token: string; ports: number[] }>(key);
		this.token = saved?.token ?? this.token;
		for (let attempt = 0; attempt < 5 && !this.port; attempt++) {
			const port = 10000 + Math.floor(Math.random() * 55000);
			if (await this.listen(port)) {
				this.port = port;
			}
		}
		if (!this.port) {
			return;
		}
		await this.context.globalState.update(key, { token: this.token, ports: [this.port, ...(saved?.ports ?? []).filter(p => p !== this.port)].slice(0, 6) });
		await this.writeLock(this.port);
		// `claude` started in a Flow terminal connects straight away.
		this.context.environmentVariableCollection.replace('CLAUDE_CODE_SSE_PORT', String(this.port));
		this.context.environmentVariableCollection.replace('ENABLE_IDE_INTEGRATION', 'true');
		this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => [...this.servers.keys()].forEach(p => void this.writeLock(p))));
		this.ping = setInterval(() => this.clients.forEach(c => c.ping()), 30_000);
		this.adopt(saved?.ports ?? []);
		this.render();
	}

	private async listen(port: number) {
		try {
			const server = await new Promise<WebSocketServer>((resolve, reject) => {
				const wss = new WebSocketServer({
					host: '127.0.0.1', port,
					// The CLI proves it read our lock file by sending its token.
					verifyClient: (info, done) => done(info.req.headers['x-claude-code-ide-authorization'] === this.token, 401),
				});
				wss.once('listening', () => resolve(wss));
				wss.once('error', reject);
			});
			server.on('connection', ws => this.connected(ws));
			this.servers.set(port, server);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * After a window reload the old extension host keeps this folder's earlier ports until it exits.
	 * Take them over as they free up, so agents started before the reload reconnect to this window.
	 */
	private adopt(ports: number[]) {
		let left = ports.filter(p => !this.servers.has(p));
		let rounds = 0;
		const tick = async () => {
			for (const p of left) {
				if (await this.listen(p)) {
					await this.writeLock(p);
					// The old host may delete its lock on the way out: write ours again after it is gone.
					setTimeout(() => void this.writeLock(p), 3000);
				}
			}
			left = left.filter(p => !this.servers.has(p));
			if (!left.length || ++rounds > 36) {
				clearInterval(this.adoptTimer);
			}
		};
		if (left.length) {
			this.adoptTimer = setInterval(() => void tick(), 5000);
			void tick();
		}
	}

	private get lockDir() {
		return path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'ide');
	}

	private async writeLock(port: number) {
		const dir = this.lockDir;
		await fs.mkdir(dir, { recursive: true, mode: 0o700 });
		// A Flow that was killed could not delete its lock: remove ours whose process is gone.
		for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
			if (!name.endsWith('.lock')) {
				continue;
			}
			try {
				const lock = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as { ideName?: string; pid?: number };
				if (lock.ideName === 'Flow' && lock.pid && lock.pid !== process.pid) {
					try {
						process.kill(lock.pid, 0);
					} catch {
						await fs.rm(path.join(dir, name), { force: true });
					}
				}
			} catch {
				// not ours or unreadable
			}
		}
		const file = path.join(dir, `${port}.lock`);
		const lock = {
			pid: process.pid,
			workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath),
			ideName: 'Flow',
			transport: 'ws',
			runningInWindows: process.platform === 'win32',
			authToken: this.token,
		};
		const tmp = `${file}.${process.pid}.tmp`;
		await fs.writeFile(tmp, JSON.stringify(lock), { mode: 0o600 });
		await fs.rename(tmp, file);
	}

	private render() {
		const n = this.clients.size;
		this.status.text = n ? '$(plug) Claude' : '$(debug-disconnect) Claude';
		this.status.color = n ? new vscode.ThemeColor('flowView.get') : undefined;
		this.status.tooltip = n
			? `Claude Code is connected to Flow (${n}). Its diffs open here and on the canvas.`
			: 'No Claude Code terminal connected. Run `claude` in a Flow terminal, or `/ide` in any terminal and pick Flow.';
		this.status.show();
	}

	private connected(ws: WebSocket) {
		this.clients.add(ws);
		this.render();
		ws.on('message', raw => void this.onMessage(ws, String(raw)));
		ws.on('close', () => {
			this.clients.delete(ws);
			// Nobody is waiting for this terminal's answers any more; other terminals keep theirs.
			[...this.pending.values()].filter(p => p.owner === ws).forEach(p => this.answer(p.id, false));
			this.render();
		});
	}

	private send(ws: WebSocket, msg: object) {
		if (ws.readyState === ws.OPEN) {
			ws.send(JSON.stringify({ jsonrpc: '2.0', ...msg }));
		}
	}

	private broadcast(method: string, params: object) {
		this.clients.forEach(ws => this.send(ws, { method, params }));
	}

	private async onMessage(ws: WebSocket, raw: string) {
		let msg: Rpc;
		try {
			msg = JSON.parse(raw);
		} catch {
			return;
		}
		if (msg.id === undefined) {
			if (msg.method === 'notifications/initialized' && vscode.window.activeTextEditor) {
				this.selectionChanged(vscode.window.activeTextEditor, true);
			}
			return; // ide_connected and other notifications need no answer
		}
		try {
			switch (msg.method) {
				case 'initialize':
					return this.send(ws, { id: msg.id, result: { protocolVersion: PROTOCOL, capabilities: { logging: {}, prompts: { listChanged: true }, tools: { listChanged: true } }, serverInfo: { name: 'flow', version: '0.1.0' } } });
				case 'prompts/list':
					return this.send(ws, { id: msg.id, result: { prompts: [] } });
				case 'tools/list':
					return this.send(ws, { id: msg.id, result: { tools: TOOLS } });
				case 'tools/call': {
					const name = String(msg.params?.name);
					const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
					const content = await this.call(name, args, ws);
					return this.send(ws, { id: msg.id, result: { content } });
				}
				default:
					return this.send(ws, { id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
			}
		} catch (e) {
			this.send(ws, { id: msg.id, error: { code: -32603, message: (e as Error).message } });
		}
	}

	private text(value: unknown): Content {
		return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }];
	}

	private async call(name: string, a: Record<string, unknown>, ws: WebSocket): Promise<Content> {
		switch (name) {
			case 'openFile': {
				const uri = vscode.Uri.file(String(a.filePath));
				const doc = await vscode.workspace.openTextDocument(uri);
				let selection: vscode.Range | undefined;
				if (typeof a.startText === 'string') {
					const text = doc.getText();
					const s = text.indexOf(a.startText);
					if (s >= 0) {
						const e = typeof a.endText === 'string' ? text.indexOf(a.endText, s) : -1;
						const end = e >= 0 ? e + (a.endText as string).length : s + a.startText.length;
						selection = new vscode.Range(doc.positionAt(s), a.selectToEndOfLine ? doc.lineAt(doc.positionAt(end).line).range.end : doc.positionAt(end));
					}
				}
				await vscode.window.showTextDocument(doc, { preview: a.preview === true, selection, preserveFocus: a.makeFrontmost === false });
				return a.makeFrontmost === false
					? this.text({ success: true, filePath: uri.fsPath, languageId: doc.languageId, lineCount: doc.lineCount })
					: this.text(`Opened file: ${uri.fsPath}`);
			}
			case 'openDiff':
				return this.openDiff(String(a.old_file_path), String(a.new_file_path ?? a.old_file_path), String(a.new_file_contents ?? ''), String(a.tab_name ?? 'Claude'), ws);
			case 'getCurrentSelection': {
				const ed = vscode.window.activeTextEditor;
				return this.text(ed ? this.selectionOf(ed) : { success: false, message: 'No active editor found' });
			}
			case 'getLatestSelection':
				return this.text(this.latestSelection ?? { success: false, message: 'No selection available' });
			case 'getOpenEditors':
				return this.text({
					tabs: vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input instanceof vscode.TabInputText).map(t => {
						const uri = (t.input as vscode.TabInputText).uri;
						const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
						return { uri: uri.toString(), isActive: t.isActive, label: t.label, languageId: doc?.languageId, isDirty: t.isDirty };
					}),
				});
			case 'getWorkspaceFolders': {
				const folders = vscode.workspace.workspaceFolders ?? [];
				return this.text({ success: true, folders: folders.map(f => ({ name: f.name, uri: f.uri.toString(), path: f.uri.fsPath })), rootPath: folders[0]?.uri.fsPath });
			}
			case 'getDiagnostics': {
				const only = typeof a.uri === 'string' ? vscode.Uri.parse(a.uri) : undefined;
				const entries = only ? [[only, vscode.languages.getDiagnostics(only)] as const] : vscode.languages.getDiagnostics();
				const sev = ['Error', 'Warning', 'Information', 'Hint'];
				return this.text(entries.filter(([, d]) => d.length).map(([uri, d]) => ({
					uri: uri.toString(),
					diagnostics: d.map(x => ({ message: x.message, severity: sev[x.severity], range: { start: { line: x.range.start.line, character: x.range.start.character }, end: { line: x.range.end.line, character: x.range.end.character } }, source: x.source })),
				})));
			}
			case 'checkDocumentDirty': {
				const doc = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && d.uri.fsPath === a.filePath);
				return this.text(doc ? { success: true, filePath: doc.uri.fsPath, isDirty: doc.isDirty, isUntitled: doc.isUntitled } : { success: false, message: `Document not open: ${a.filePath}` });
			}
			case 'saveDocument': {
				const doc = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && d.uri.fsPath === a.filePath);
				if (!doc) {
					return this.text({ success: false, message: `Document not open: ${a.filePath}` });
				}
				await doc.save();
				return this.text({ success: true, filePath: doc.uri.fsPath, saved: true, message: 'Document saved' });
			}
			case 'close_tab': {
				const tab = vscode.window.tabGroups.all.flatMap(g => g.tabs).find(t => t.label === a.tab_name);
				if (tab) {
					await vscode.window.tabGroups.close(tab);
				}
				return this.text('TAB_CLOSED');
			}
			case 'closeAllDiffTabs': {
				const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => (t.input as { modified?: vscode.Uri })?.modified?.scheme === SCHEME);
				await vscode.window.tabGroups.close(tabs);
				return this.text(`CLOSED_${tabs.length}_DIFF_TABS`);
			}
			default:
				throw new Error(`Unknown tool: ${name}`);
		}
	}

	/**
	 * Claude wants to change a file. Show the diff (editable on the right), mark the methods it touches
	 * on the canvas, and hold the answer until the user accepts or rejects. The CLI writes the file.
	 */
	private async openDiff(oldPath: string, newPath: string, contents: string, tab: string, owner: WebSocket): Promise<Content> {
		const id = `d${++this.seq}`;
		const proposed = vscode.Uri.from({ scheme: SCHEME, path: newPath, query: id });
		this.proposals.set(proposed.toString(), contents);
		const current = await fs.readFile(oldPath, 'utf8').catch(() => '');
		const left = current ? vscode.Uri.file(oldPath) : vscode.Uri.from({ scheme: SCHEME, path: oldPath, query: `${id}-empty` });

		// The canvas marks the changed line ranges (in today's file) on the methods that hold them.
		const spans = structuredPatch('a', 'b', current.replace(/\r\n/g, '\n'), contents.replace(/\r\n/g, '\n'), '', '', { context: 0 }).hunks
			.map(h => ({ file: oldPath, start: Math.max(1, h.oldStart), end: Math.max(h.oldStart, h.oldStart + h.oldLines - 1) }));
		this.host.propose({ id, agent: 'Claude Code', title: tab, files: spans.length ? [] : [oldPath], spans });

		const accepted = await new Promise<boolean>(resolve => {
			this.pending.set(id, { id, tab, file: oldPath, proposed, owner, resolve });
			void vscode.commands.executeCommand('vscode.diff', left, proposed, `${tab} (Claude) ⟷ Accept or Reject`, { preview: false });
		});
		this.host.proposalDone();
		this.proposals.delete(proposed.toString());
		if (!accepted) {
			return [{ type: 'text', text: 'DIFF_REJECTED' }];
		}
		await this.host.willEdit(oldPath, tab);
		setTimeout(() => this.host.refresh(), 1200);
		return [{ type: 'text', text: 'FILE_SAVED' }, { type: 'text', text: contents }];
	}

	/** Accept or reject a pending diff: by id (canvas), or the one whose tab is active (editor title button). */
	answer(id: string | undefined, accept: boolean) {
		const target = id ? this.pending.get(id) : this.activePending();
		if (!target) {
			return;
		}
		this.pending.delete(target.id);
		target.resolve(accept);
		const tab = vscode.window.tabGroups.all.flatMap(g => g.tabs).find(t => (t.input as { modified?: vscode.Uri })?.modified?.toString() === target.proposed.toString());
		if (tab) {
			void vscode.window.tabGroups.close(tab);
		}
	}

	private activePending(): PendingDiff | undefined {
		const active = vscode.window.tabGroups.activeTabGroup.activeTab?.input as { modified?: vscode.Uri } | undefined;
		return [...this.pending.values()].find(p => p.proposed.toString() === active?.modified?.toString()) ?? [...this.pending.values()].at(-1);
	}

	private selectionOf(ed: vscode.TextEditor) {
		const s = ed.selection;
		return {
			success: true,
			text: ed.document.getText(s),
			filePath: ed.document.uri.fsPath,
			fileUrl: ed.document.uri.toString(),
			selection: { start: { line: s.start.line, character: s.start.character }, end: { line: s.end.line, character: s.end.character }, isEmpty: s.isEmpty },
		};
	}

	private selectionChanged(ed: vscode.TextEditor, now = false) {
		if (ed.document.uri.scheme !== 'file') {
			return;
		}
		clearTimeout(this.selTimer);
		this.selTimer = setTimeout(() => {
			this.latestSelection = this.selectionOf(ed);
			const { success: _s, ...params } = this.latestSelection;
			this.broadcast('selection_changed', params);
		}, now ? 0 : 100);
	}

	/** Puts a file and line range into Claude's prompt in the terminal, like @-mentioning it. */
	mention(file: string, startLine: number, endLine: number) {
		if (!this.clients.size) {
			void vscode.window.showInformationMessage('No Claude Code terminal is connected. Run `claude` in a Flow terminal first.', 'Open Terminal').then(p => p && vscode.commands.executeCommand('workbench.action.terminal.new'));
			return;
		}
		this.broadcast('at_mentioned', { filePath: file, lineStart: startLine, lineEnd: endLine });
	}

	get isConnected() {
		return this.clients.size > 0;
	}

	dispose() {
		clearInterval(this.ping);
		clearInterval(this.adoptTimer);
		[...this.pending.keys()].forEach(id => this.answer(id, false));
		this.clients.forEach(c => c.close());
		for (const [port, server] of this.servers) {
			server.close();
			void fs.rm(path.join(this.lockDir, `${port}.lock`), { force: true });
		}
		this.status.dispose();
		this.disposables.forEach(d => d.dispose());
	}
}

const TOOLS = [
	{ name: 'openFile', description: 'Open a file in the editor and optionally select a range of text', inputSchema: { type: 'object', properties: { filePath: { type: 'string' }, preview: { type: 'boolean' }, startText: { type: 'string' }, endText: { type: 'string' }, selectToEndOfLine: { type: 'boolean' }, makeFrontmost: { type: 'boolean' } }, required: ['filePath'], additionalProperties: false } },
	{ name: 'openDiff', description: 'Open a diff view comparing a file with new contents and wait for the user to accept or reject it', inputSchema: { type: 'object', properties: { old_file_path: { type: 'string' }, new_file_path: { type: 'string' }, new_file_contents: { type: 'string' }, tab_name: { type: 'string' } }, required: ['old_file_path', 'new_file_path', 'new_file_contents', 'tab_name'], additionalProperties: false } },
	{ name: 'getCurrentSelection', description: 'Get the current text selection in the active editor', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
	{ name: 'getLatestSelection', description: 'Get the most recent text selection, even if the editor lost focus', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
	{ name: 'getOpenEditors', description: 'Get the files open in editor tabs', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
	{ name: 'getWorkspaceFolders', description: 'Get the workspace folders', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
	{ name: 'getDiagnostics', description: 'Get language diagnostics (errors, warnings) from the editor', inputSchema: { type: 'object', properties: { uri: { type: 'string' } }, additionalProperties: false } },
	{ name: 'checkDocumentDirty', description: 'Check whether a document has unsaved changes', inputSchema: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'], additionalProperties: false } },
	{ name: 'saveDocument', description: 'Save a document with unsaved changes', inputSchema: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'], additionalProperties: false } },
	{ name: 'closeAllDiffTabs', description: 'Close all diff tabs opened for review', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];
