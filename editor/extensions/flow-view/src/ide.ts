/*---------------------------------------------------------------------------------------------
 *  Axle as a Claude Code IDE. `claude` in any terminal finds Axle through a lock file in
 *  ~/.claude/ide and talks to it over a local WebSocket (MCP, JSON-RPC). Claude's edits arrive as
 *  `openDiff`: Axle shows the diff, marks the methods on the canvas, and answers with the user's
 *  Accept or Reject. Selections and @-mentions flow the other way, from Axle to the CLI.
 *  Note: Claude Code only shows a model getDiagnostics (and executeCode) of this channel; the tools a model
 *  can call to open files, show flows or draw boards live in the separate `axle` MCP server (./mcp).
 *--------------------------------------------------------------------------------------------*/

import { randomBytes, timingSafeEqual } from 'crypto';
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
/** getDiagnostics answers go into a model's context: at most this many files, and entries per file. */
const MAX_DIAGNOSTIC_FILES = 50;
const MAX_DIAGNOSTICS_PER_FILE = 25;

/** The path as VS Code spells it (the CLI says `C:\x`, documents say `c:\x`): compare and key files by this. */
const fsPath = (p: string) => vscode.Uri.file(p).fsPath;

/** Constant-time comparison; false for anything that is not a string of the same length. */
function sameSecret(given: unknown, expected: string) {
	return typeof given === 'string' && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

interface PendingDiff {
	id: string;
	proposed: vscode.Uri;
	/** The terminal that asked; when it goes away, only its diffs are rejected. */
	owner: WebSocket;
	resolve: (accepted: boolean) => void;
}

/** Hooks into the rest of Axle: the canvas (to mark what a diff touches) and the agent-change tracker. */
export interface IdeHost {
	propose(p: { id: string; agent: string; title: string; files: string[]; spans: { file: string; start: number; end: number }[] }): void;
	proposalDone(id: string): void;
	/** Right before the CLI writes an accepted diff: remember the file as it was, for Keep/Undo. */
	willEdit(file: string, prompt: string): Promise<void>;
	/** After the CLI wrote the accepted diff: remember the file as the agent left it. */
	didEdit(file: string): Promise<void>;
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
	private static readonly ENV = ['CLAUDE_CODE_SSE_PORT', 'ENABLE_IDE_INTEGRATION'];

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
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('flow.ide.enabled')) {
					void vscode.window.showInformationMessage('Axle: reload the window to apply the Claude Code connection setting.', 'Reload Window')
						.then(pick => pick && vscode.commands.executeCommand('workbench.action.reloadWindow'));
				}
			}),
		);
	}

	/** Set by `dispose`: work that was waiting on the disk or a socket must not start anything after it. */
	private disposed = false;
	private readonly timers = new Set<NodeJS.Timeout>();

	/** Starts the bridge; a failure (an unwritable ~/.claude/ide, no free port) is logged and leaves Axle working without it. */
	async start(log?: vscode.LogOutputChannel) {
		// Off by choice: no server, no lock file, and no port left in new terminals from an earlier run.
		if (!vscode.workspace.getConfiguration('flow').get<boolean>('ide.enabled', true)) {
			this.clearEnv();
			return;
		}
		try {
			await this.startServers();
		} catch (e) {
			log?.error(`Claude Code bridge did not start: ${e instanceof Error ? e.stack ?? e.message : e}`);
			this.stopServers();
			this.clearEnv();
		}
	}

	/** Terminals opened later must not be pointed at a port nothing listens on. */
	private clearEnv() {
		ClaudeIdeBridge.ENV.forEach(name => this.context.environmentVariableCollection.delete(name));
	}

	private async startServers() {
		// Shared by every window of this folder, so a `claude` that outlives a window reload still
		// holds a valid token, and can reach the new window on the port it already knows.
		const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
		const key = `flow.ide:${folder}`;
		const tokenKey = `flow.ide.token:${folder}`;
		const saved = this.context.globalState.get<{ ports: number[] }>(key);
		try {
			const stored = await this.context.secrets.get(tokenKey);
			if (stored) {
				this.token = stored;
			} else {
				await this.context.secrets.store(tokenKey, this.token);
			}
		} catch {
			// no secret storage here: the token lasts until this window closes
		}
		for (let attempt = 0; attempt < 5 && !this.port; attempt++) {
			const port = 10000 + Math.floor(Math.random() * 55000);
			if (await this.listen(port)) {
				this.port = port;
			}
		}
		if (!this.port || this.disposed) {
			this.clearEnv();
			return;
		}
		await this.context.globalState.update(key, { ports: [this.port, ...(saved?.ports ?? []).filter(p => p !== this.port)].slice(0, 6) });
		await this.writeLock(this.port);
		if (this.disposed) {
			return;
		}
		// `claude` started in a Axle terminal connects straight away.
		this.context.environmentVariableCollection.replace('CLAUDE_CODE_SSE_PORT', String(this.port));
		this.context.environmentVariableCollection.replace('ENABLE_IDE_INTEGRATION', 'true');
		this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => [...this.servers.keys()].forEach(p => void this.writeLock(p).catch(() => undefined))));
		this.ping = setInterval(() => this.clients.forEach(c => c.ping()), 30_000);
		this.adopt(saved?.ports ?? []);
		this.render();
	}

	private async listen(port: number) {
		try {
			const server = await new Promise<WebSocketServer>((resolve, reject) => {
				const wss = new WebSocketServer({
					host: '127.0.0.1', port,
					// Diffs carry whole files, but nothing a terminal sends is larger than a few MiB.
					maxPayload: 8 * 1024 * 1024,
					// The CLI proves it read our lock file by sending its token.
					verifyClient: (info, done) => done(sameSecret(info.req.headers['x-claude-code-ide-authorization'], this.token), 401),
				});
				wss.once('listening', () => resolve(wss));
				wss.once('error', reject);
			});
			if (this.disposed) {
				server.close();
				return false;
			}
			server.on('connection', ws => this.connected(ws));
			// A server error after listening (not the first one, which `listen` handled) must not escape.
			server.on('error', () => undefined);
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
				if (this.disposed) {
					return;
				}
				if (await this.listen(p)) {
					// A lock that cannot be written (disk full, permissions) must not end the takeover of the other ports.
					await this.writeLock(p).catch(() => undefined);
					// The old host may delete its lock on the way out: write ours again after it is gone.
					this.later(() => void this.writeLock(p).catch(() => undefined), 3000);
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

	/** A one-off timer that `dispose` cancels. */
	private later(fn: () => void, ms: number) {
		const t = setTimeout(() => {
			this.timers.delete(t);
			fn();
		}, ms);
		this.timers.add(t);
	}

	private get lockDir() {
		return path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'ide');
	}

	private async writeLock(port: number) {
		const dir = this.lockDir;
		await fs.mkdir(dir, { recursive: true, mode: 0o700 });
		// A Axle that was killed could not delete its lock: remove ours whose process is gone.
		for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
			if (!name.endsWith('.lock')) {
				continue;
			}
			try {
				const lock = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as { ideName?: string; pid?: number };
				if (lock.ideName === 'Axle' && lock.pid && lock.pid !== process.pid) {
					try {
						process.kill(lock.pid, 0);
					} catch (e) {
						// Only "no such process" means it is gone; EPERM is a live process we may not signal.
						if ((e as NodeJS.ErrnoException).code === 'ESRCH') {
							await fs.rm(path.join(dir, name), { force: true });
						}
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
			ideName: 'Axle',
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
			? `Claude Code is connected to Axle (${n}). Its diffs open here and on the canvas.`
			: 'No Claude Code terminal connected. Run `claude` in a Axle terminal, or `/ide` in any terminal and pick Axle.';
		this.status.show();
	}

	private connected(ws: WebSocket) {
		this.clients.add(ws);
		this.render();
		// A malformed frame or a reset connection is that client's problem, not an uncaught exception.
		ws.on('error', () => ws.terminate());
		ws.on('message', raw => void this.onMessage(ws, String(raw)).catch(() => undefined));
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
			const parsed: unknown = JSON.parse(raw);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				return;
			}
			msg = parsed as Rpc;
		} catch {
			return;
		}
		if (typeof msg.method !== 'string' || (msg.id !== undefined && typeof msg.id !== 'string' && typeof msg.id !== 'number')) {
			return; // a response to something we sent, or not JSON-RPC at all: nothing to answer
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

	/** The open document for a path the CLI sent, whichever way it spells the drive letter and separators. */
	private openDocument(filePath: unknown) {
		const want = typeof filePath === 'string' ? fsPath(filePath) : undefined;
		return want === undefined ? undefined : vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && d.uri.fsPath === want);
	}

	private async call(name: string, a: Record<string, unknown>, ws: WebSocket): Promise<Content> {
		switch (name) {
			case 'openFile': {
				const uri = vscode.Uri.file(String(a.filePath));
				const doc = await vscode.workspace.openTextDocument(uri);
				let selection: vscode.Range | undefined;
				// A line range (1-based, inclusive) wins over text search.
				if (typeof a.line === 'number' && Number.isFinite(a.line) && doc.lineCount > 0) {
					const first = Math.min(Math.max(1, Math.floor(a.line)), doc.lineCount);
					const last = typeof a.endLine === 'number' && Number.isFinite(a.endLine) ? Math.min(Math.max(first, Math.floor(a.endLine)), doc.lineCount) : first;
					selection = new vscode.Range(first - 1, 0, last - 1, doc.lineAt(last - 1).text.length);
				} else if (typeof a.startText === 'string') {
					const text = doc.getText();
					const s = text.indexOf(a.startText);
					if (s >= 0) {
						const e = typeof a.endText === 'string' ? text.indexOf(a.endText, s) : -1;
						const end = e >= 0 ? e + (a.endText as string).length : s + a.startText.length;
						selection = new vscode.Range(doc.positionAt(s), a.selectToEndOfLine ? doc.lineAt(doc.positionAt(end).line).range.end : doc.positionAt(end));
					}
				}
				// The terminal keeps the keyboard unless the CLI explicitly asks for the editor to come to the front.
				await vscode.window.showTextDocument(doc, { preview: a.preview === true, selection, preserveFocus: a.makeFrontmost !== true });
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
				// Bounded: a big workspace can hold thousands of problems, and the answer goes into the model's context.
				const only = typeof a.uri === 'string' ? vscode.Uri.parse(a.uri) : undefined;
				const entries = only ? [[only, vscode.languages.getDiagnostics(only)] as const] : vscode.languages.getDiagnostics();
				const sev = ['Error', 'Warning', 'Information', 'Hint'];
				const wanted = entries.filter(([uri, d]) => d.length && (only || uri.scheme === 'file'));
				// Errors first: they are what the model is asked about.
				const rank = (d: readonly vscode.Diagnostic[]) => Math.min(...d.map(x => x.severity));
				const files = wanted.sort((x, y) => rank(x[1]) - rank(y[1])).slice(0, MAX_DIAGNOSTIC_FILES);
				const result: { uri: string; diagnostics: object[]; truncated?: number; moreFiles?: number }[] = files.map(([uri, d]) => {
					const list = [...d].sort((x, y) => x.severity - y.severity).slice(0, MAX_DIAGNOSTICS_PER_FILE);
					return {
						uri: uri.toString(),
						diagnostics: list.map(x => ({ message: x.message.slice(0, 500), severity: sev[x.severity], range: { start: { line: x.range.start.line, character: x.range.start.character }, end: { line: x.range.end.line, character: x.range.end.character } }, source: x.source })),
						...(d.length > list.length ? { truncated: d.length - list.length } : {}),
					};
				});
				// Overflow is noted on the last real entry: an entry with an empty uri could trip the CLI.
				if (wanted.length > files.length && result.length) {
					result[result.length - 1].moreFiles = wanted.length - files.length;
				}
				return this.text(result);
			}
			case 'checkDocumentDirty': {
				const doc = this.openDocument(a.filePath);
				return this.text(doc ? { success: true, filePath: doc.uri.fsPath, isDirty: doc.isDirty, isUntitled: doc.isUntitled } : { success: false, message: `Document not open: ${a.filePath}` });
			}
			case 'saveDocument': {
				const doc = this.openDocument(a.filePath);
				if (!doc) {
					return this.text({ success: false, message: `Document not open: ${a.filePath}` });
				}
				await doc.save();
				return this.text({ success: true, filePath: doc.uri.fsPath, saved: true, message: 'Document saved' });
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
	 * Claude wants to change a file. Show the diff (read-only on the right), mark the methods it touches
	 * on the canvas, and hold the answer until the user accepts or rejects. The CLI writes the file.
	 */
	private async openDiff(oldPath: string, newPath: string, contents: string, tab: string, owner: WebSocket): Promise<Content> {
		const rejected: Content = [{ type: 'text', text: 'DIFF_REJECTED' }];
		const oldFile = fsPath(oldPath);
		const id = `d${++this.seq}`;
		const proposed = vscode.Uri.file(fsPath(newPath)).with({ scheme: SCHEME, query: id });
		const current = await fs.readFile(oldFile, 'utf8').catch(() => '');
		// The terminal may have gone while we read: nobody is waiting for this diff, so do not open it.
		if (this.disposed || owner.readyState !== owner.OPEN) {
			return rejected;
		}
		this.proposals.set(proposed.toString(), contents);
		const left = current ? vscode.Uri.file(oldFile) : vscode.Uri.file(oldFile).with({ scheme: SCHEME, query: `${id}-empty` });

		// The canvas marks the changed line ranges (in today's file) on the methods that hold them.
		const spans = structuredPatch('a', 'b', current.replace(/\r\n/g, '\n'), contents.replace(/\r\n/g, '\n'), '', '', { context: 0 }).hunks
			.map(h => ({ file: oldFile, start: Math.max(1, h.oldStart), end: Math.max(h.oldStart, h.oldStart + h.oldLines - 1) }));
		this.host.propose({ id, agent: 'Claude Code', title: tab, files: spans.length ? [] : [oldFile], spans });

		const accepted = await new Promise<boolean>(resolve => {
			this.pending.set(id, { id, proposed, owner, resolve });
			// A diff that cannot open is a rejection: the CLI must not wait for an answer nobody can give.
			vscode.commands.executeCommand('vscode.diff', left, proposed, `${tab} (Claude) ⟷ Accept or Reject`, { preview: false })
				.then(undefined, () => this.answer(id, false));
		});
		this.host.proposalDone(id);
		this.proposals.delete(proposed.toString());
		if (!accepted) {
			return rejected;
		}
		await this.host.willEdit(oldFile, tab);
		this.watchWrite(oldFile, contents);
		return [{ type: 'text', text: 'FILE_SAVED' }, { type: 'text', text: contents }];
	}

	/**
	 * The CLI writes the file after it has our answer. Wait until the disk holds what was accepted, then tell the
	 * host: the agent-change tracker records the file as the agent left it, and the canvas redraws.
	 */
	private watchWrite(file: string, contents: string, tries = 0) {
		const same = (a: string, b: string) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
		this.later(async () => {
			const onDisk = await fs.readFile(file, 'utf8').catch(() => undefined);
			if (onDisk !== undefined && same(onDisk, contents)) {
				await this.host.didEdit(file).catch(() => undefined);
				this.host.refresh();
			} else if (tries < 40) {
				this.watchWrite(file, contents, tries + 1);
			} else {
				this.host.refresh(); // it never matched (written differently, or not at all): leave the tracker alone
			}
		}, tries ? 250 : 400);
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
		return [...this.pending.values()].find(p => p.proposed.toString() === active?.modified?.toString());
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
			void vscode.window.showInformationMessage('No Claude Code terminal is connected. Run `claude` in a Axle terminal first.', 'Open Terminal').then(p => p && vscode.commands.executeCommand('workbench.action.terminal.new'));
			return;
		}
		this.broadcast('at_mentioned', { filePath: file, lineStart: startLine, lineEnd: endLine });
	}

	get isConnected() {
		return this.clients.size > 0;
	}

	/** Closes every server and removes its lock file. */
	private stopServers() {
		for (const [port, server] of this.servers) {
			server.close();
			void fs.rm(path.join(this.lockDir, `${port}.lock`), { force: true });
		}
		this.servers.clear();
	}

	dispose() {
		this.disposed = true;
		clearInterval(this.ping);
		clearInterval(this.adoptTimer);
		clearTimeout(this.selTimer);
		this.timers.forEach(clearTimeout);
		this.timers.clear();
		[...this.pending.keys()].forEach(id => this.answer(id, false));
		this.clients.forEach(c => c.close());
		this.stopServers();
		this.clearEnv();
		this.status.dispose();
		this.disposables.forEach(d => d.dispose());
	}
}

const TOOLS = [
	{ name: 'openFile', description: 'Open a file in the editor and optionally select a range of text or of lines (line, endLine: 1-based). The editor does not take focus from the terminal unless makeFrontmost is true', inputSchema: { type: 'object', properties: { filePath: { type: 'string' }, preview: { type: 'boolean' }, startText: { type: 'string' }, endText: { type: 'string' }, selectToEndOfLine: { type: 'boolean' }, makeFrontmost: { type: 'boolean' }, line: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 } }, required: ['filePath'], additionalProperties: false } },
	{ name: 'openDiff', description: 'Open a diff view comparing a file with new contents and wait for the user to accept or reject it', inputSchema: { type: 'object', properties: { old_file_path: { type: 'string' }, new_file_path: { type: 'string' }, new_file_contents: { type: 'string' }, tab_name: { type: 'string' } }, required: ['old_file_path', 'new_file_path', 'new_file_contents', 'tab_name'], additionalProperties: false } },
	{ name: 'getCurrentSelection', description: 'Get the current text selection in the active editor', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
	{ name: 'getLatestSelection', description: 'Get the most recent text selection, even if the editor lost focus', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
	{ name: 'getOpenEditors', description: 'Get the files open in editor tabs', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
	{ name: 'getWorkspaceFolders', description: 'Get the workspace folders', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
	{ name: 'getDiagnostics', description: 'Get language diagnostics (errors, warnings) from the editor', inputSchema: { type: 'object', properties: { uri: { type: 'string' } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
	{ name: 'checkDocumentDirty', description: 'Check whether a document has unsaved changes', inputSchema: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'], additionalProperties: false }, annotations: { readOnlyHint: true } },
	{ name: 'saveDocument', description: 'Save a document with unsaved changes', inputSchema: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'], additionalProperties: false } },
	{ name: 'closeAllDiffTabs', description: 'Close all diff tabs opened for review', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];
