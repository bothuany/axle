/*---------------------------------------------------------------------------------------------
 *  Axle polyglot index: the extension host side. Starts the worker for the open folders, sends
 *  it file changes, and serves its answers as a FlowProvider and a list of entry points.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Worker } from 'worker_threads';
import type { FlowNode, FlowProvider, FlowTarget } from '../providers';
import type { Place, Suggestion } from './assist';
import { VsLsp } from './lspHost';
import { LspRefiner, stripPending } from './lspResolve';
import type { PolyTypeFacts } from '../types/wire';
import { isExcludedPath, type EntryPoint } from './model';

export const POLY_LANGUAGES = new Set(['java', 'python', 'javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'go', 'php', 'ruby', 'rust']);

/** Prebuilt grammars: copied next to the bundle by esbuild.mjs. Only this extension's own copy is ever loaded (the worker `require`s tree-sitter.js from it). */
function wasmDir(extensionPath: string) {
	return path.join(extensionPath, 'out', 'wasm');
}

const MAX_RESTARTS = 5;

export class PolyIndex implements vscode.Disposable {
	private worker: Worker | undefined;
	private seq = 0;
	private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	private readonly ready = new vscode.EventEmitter<void>();
	readonly onDidBecomeReady = this.ready.event;
	private entries: EntryPoint[] = [];
	private changedFiles = new Set<string>();
	private changeTimer: NodeJS.Timeout | undefined;
	private restartTimer: NodeJS.Timeout | undefined;
	/** Crashes since the worker last became ready: the restart backoff and its cap. */
	private crashes = 0;
	private disposed = false;
	/** Why requests fail while there is no worker. */
	private unavailable = 'No folder is open.';
	private readonly disposables: vscode.Disposable[] = [];
	isReady = false;

	/** The index of this window: the canvas asks it for editing help without being handed it. */
	static current: PolyIndex | undefined;

	constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.LogOutputChannel) {
		PolyIndex.current = this;
		const watcher = vscode.workspace.createFileSystemWatcher('**/{*.java,*.py,*.js,*.jsx,*.mjs,*.cjs,*.ts,*.tsx,*.go,*.php,*.rb,*.rs,*.xhtml,*.jsp,*.jspx,*.jsf,services.xml,*.prisma}');
		const changed = (u: vscode.Uri) => {
			const folder = vscode.workspace.getWorkspaceFolder(u);
			if (!folder || isExcludedPath(u.fsPath, folder.uri.fsPath)) {
				return;
			}
			this.changedFiles.add(u.fsPath);
			clearTimeout(this.changeTimer);
			this.changeTimer = setTimeout(() => void this.flush(), 400);
		};
		this.disposables.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed),
			vscode.workspace.onDidChangeWorkspaceFolders(() => this.restart()));
		this.entries = context.workspaceState.get<EntryPoint[]>('flow.polyEntries', []);
		this.start();
	}

	private start() {
		const roots = (vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file').map(f => f.uri.fsPath);
		if (!roots.length) {
			this.unavailable = 'No folder is open.';
			return;
		}
		const key = createHash('sha1').update(roots.join('|')).digest('hex').slice(0, 12);
		const cacheFile = path.join(this.context.globalStorageUri.fsPath, 'poly', `${key}.json`);
		this.isReady = false;
		const wasm = wasmDir(this.context.extensionPath);
		if (!fs.existsSync(path.join(wasm, 'tree-sitter.js'))) {
			this.log.error(`Index: the tree-sitter runtime is missing from ${wasm}. Reinstall the extension.`);
			this.unavailable = 'The code index cannot start: its parser files are missing.';
			return;
		}
		const worker = this.worker = new Worker(path.join(this.context.extensionPath, 'out', 'polyWorker.js'), {
			workerData: { roots, wasmDir: wasm, cacheFile },
			resourceLimits: { maxOldGenerationSizeMb: 2048 },
		});
		worker.on('message', (m: { id?: number; type?: string; result?: unknown; error?: string; message?: string; stats?: object; ms?: number; parsed?: number }) => {
			if (this.worker !== worker) {
				return; // an answer from a worker that was replaced
			}
			if (m.type === 'log') {
				this.log.warn(`Index: ${m.message}`);
			} else if (m.type === 'ready') {
				this.log.info(`Index ready in ${m.ms} ms (${m.parsed} parsed): ${JSON.stringify(m.stats)}`);
				this.isReady = true;
				this.crashes = 0;
				void this.refreshEntries();
			} else if (m.id !== undefined) {
				const p = this.pending.get(m.id);
				this.pending.delete(m.id);
				if (m.error) {
					p?.reject(new Error(m.error));
				} else {
					p?.resolve(m.result);
				}
			}
		});
		// A worker that died (out of memory, a crash) must not leave requests waiting for an answer that never comes.
		const lost = (why: string) => {
			if (this.worker === worker) {
				this.worker = undefined;
				this.isReady = false;
				this.pending.forEach(p => p.reject(new Error(why)));
				this.pending.clear();
				this.scheduleRestart(why);
			}
		};
		worker.on('error', e => {
			this.log.error(`Index worker failed: ${e.stack ?? e}`);
			lost('The code index stopped unexpectedly.');
		});
		worker.on('exit', code => lost(`The code index exited (${code}).`));
	}

	/** After a crash: start again with a growing delay, and stop trying when it keeps failing. */
	private scheduleRestart(why: string) {
		if (this.disposed) {
			return;
		}
		if (++this.crashes > MAX_RESTARTS) {
			this.log.error('Index: the worker keeps stopping, not restarting it again.');
			this.unavailable = `${why} It kept failing: reload the window to try again.`;
			return;
		}
		const delay = Math.min(30_000, 1000 * 2 ** (this.crashes - 1));
		this.log.warn(`Index: restarting the worker in ${delay} ms (crash ${this.crashes} of ${MAX_RESTARTS}).`);
		this.unavailable = `${why} It is restarting.`;
		clearTimeout(this.restartTimer);
		this.restartTimer = setTimeout(() => this.start(), delay);
	}

	private restart() {
		clearTimeout(this.restartTimer);
		this.crashes = 0;
		// Detached first: the old worker's exit is a replacement, not a crash.
		const old = this.worker;
		this.worker = undefined;
		void old?.terminate();
		this.pending.forEach(p => p.reject(new Error('index restarted')));
		this.pending.clear();
		this.start();
	}

	private request<T>(op: string, ...args: unknown[]): Promise<T> {
		if (!this.worker) {
			return Promise.reject(new Error(this.unavailable));
		}
		const id = ++this.seq;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
			this.worker!.postMessage({ id, op, args });
		});
	}

	private async flush() {
		const files = [...this.changedFiles];
		this.changedFiles.clear();
		if (!files.length) {
			return;
		}
		await this.request('changed', ...files).catch(() => undefined);
		void this.refreshEntries();
	}

	private async refreshEntries() {
		try {
			this.entries = await this.request<EntryPoint[]>('entries');
			void this.context.workspaceState.update('flow.polyEntries', this.entries);
			this.ready.fire();
		} catch (e) {
			this.log.warn(`Index entries failed: ${(e as Error).message}`);
		}
	}

	cachedEntryPoints() {
		return this.entries;
	}

	async entryPoints() {
		await this.flush();
		return this.request<EntryPoint[]>('entries');
	}

	functionAt(file: string, line: number) {
		return this.request<{ id: string; label: string } | undefined>('functionAt', file, line);
	}

	/** Completion in a card: what the index offers at the cursor (see `Project.completeAt`). */
	complete(q: { file: string; startLine: number; before: string }) {
		return this.request<{ items: Suggestion[]; why?: string }>('complete', q);
	}

	/** Parameter hints in a card: the function the open call reaches. */
	signature(q: { file: string; startLine: number; before: string }) {
		return this.request<{ label: string; params: string[]; active: number } | undefined>('signature', q);
	}

	/** Go to definition from a card: where the index says the identifier under the cursor is defined (see `Project.definitionAt`). */
	definition(q: { file: string; startLine: number; lineText: string; column: number; cardText: string; cardLine: number }) {
		return this.request<{ places: Place[]; message?: string }>('definition', q);
	}

	methods(file: string) {
		return this.request<{ id: string; name: string; line: number; isEntry: boolean }[]>('methods', file);
	}

	/** Everything the type model is built from (see `Project.typeFacts`): the facts of every file without function bodies, the calls between classes, the entry points with their types. */
	async typeFacts() {
		await this.flush();
		return this.request<PolyTypeFacts>('typeFacts');
	}

	async graph(id: string, depth?: number) {
		await this.flush();
		return this.request<FlowNode>('graph', id, depth);
	}

	callers(id: string) {
		return this.request<FlowNode | null>('callers', id);
	}

	impact(id: string) {
		return this.request<{ label: string; items: string[] }>('impact', id);
	}

	dispose() {
		if (PolyIndex.current === this) {
			PolyIndex.current = undefined;
		}
		this.disposed = true;
		clearTimeout(this.restartTimer);
		clearTimeout(this.changeTimer);
		void this.worker?.terminate();
		this.ready.dispose();
		this.disposables.forEach(d => d.dispose());
	}
}

/**
 * Java, Python, JS/TS (and the other indexed languages) through the polyglot index, refined by the language
 * server where the index could not resolve a call. `flow.lspResolution` turns the second step off.
 */
export class PolyProvider implements FlowProvider, vscode.Disposable {
	private readonly refiner: LspRefiner;
	private readonly save: vscode.Disposable;

	constructor(private readonly index: PolyIndex) {
		this.refiner = new LspRefiner(index, new VsLsp());
		this.save = vscode.workspace.onDidSaveTextDocument(() => this.refiner.reset());
	}

	private id(t: FlowTarget) {
		if (t.kind !== 'poly') {
			throw new Error('not a polyglot target');
		}
		return t.id;
	}

	async graph(t: FlowTarget) {
		const root = await this.index.graph(this.id(t));
		return vscode.workspace.getConfiguration('flow').get<boolean>('lspResolution', true) ? this.refiner.refine(root) : stripPending(root);
	}

	callers(t: FlowTarget) {
		return this.index.callers(this.id(t));
	}

	impact(t: FlowTarget) {
		return this.index.impact(this.id(t));
	}

	dispose() {
		this.save.dispose();
	}
}
