/*---------------------------------------------------------------------------------------------
 *  Flow polyglot index: the extension host side. Starts the worker for the open folders, sends
 *  it file changes, and serves its answers as a FlowProvider and a list of entry points.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Worker } from 'worker_threads';
import type { FlowNode, FlowProvider, FlowTarget } from '../providers';
import type { EntryPoint } from './model';

export const POLY_LANGUAGES = new Set(['java', 'python', 'javascript', 'typescript', 'javascriptreact', 'typescriptreact']);

/** Prebuilt grammars: copied next to the bundle by esbuild.mjs; the editor's own copy in development. */
function wasmDir(extensionPath: string) {
	const local = path.join(extensionPath, 'out', 'wasm');
	if (fs.existsSync(path.join(local, 'tree-sitter.js'))) {
		return local;
	}
	return path.join(extensionPath, '..', '..', 'node_modules', '@vscode', 'tree-sitter-wasm', 'wasm');
}

export class PolyIndex implements vscode.Disposable {
	private worker: Worker | undefined;
	private seq = 0;
	private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	private readonly ready = new vscode.EventEmitter<void>();
	readonly onDidBecomeReady = this.ready.event;
	private entries: EntryPoint[] = [];
	private changedFiles = new Set<string>();
	private changeTimer: NodeJS.Timeout | undefined;
	private readonly disposables: vscode.Disposable[] = [];
	isReady = false;

	constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.LogOutputChannel) {
		const watcher = vscode.workspace.createFileSystemWatcher('**/{*.java,*.py,*.js,*.jsx,*.mjs,*.cjs,*.ts,*.tsx,services.xml,*.prisma}');
		const changed = (u: vscode.Uri) => {
			if (/[\\/](node_modules|\.git|target|build|dist|out|\.venv|venv|__pycache__)[\\/]/.test(u.fsPath)) {
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
			return;
		}
		const key = createHash('sha1').update(roots.join('|')).digest('hex').slice(0, 12);
		const cacheFile = path.join(this.context.globalStorageUri.fsPath, 'poly', `${key}.json`);
		this.isReady = false;
		this.worker = new Worker(path.join(this.context.extensionPath, 'out', 'polyWorker.js'), {
			workerData: { roots, wasmDir: wasmDir(this.context.extensionPath), cacheFile },
			resourceLimits: { maxOldGenerationSizeMb: 2048 },
		});
		this.worker.on('message', (m: { id?: number; type?: string; result?: unknown; error?: string; message?: string; stats?: object; ms?: number; parsed?: number }) => {
			if (m.type === 'log') {
				this.log.warn(`Index: ${m.message}`);
			} else if (m.type === 'ready') {
				this.log.info(`Index ready in ${m.ms} ms (${m.parsed} parsed): ${JSON.stringify(m.stats)}`);
				this.isReady = true;
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
		this.worker.on('error', e => this.log.error(`Index worker failed: ${e.stack ?? e}`));
	}

	private restart() {
		void this.worker?.terminate();
		this.pending.forEach(p => p.reject(new Error('index restarted')));
		this.pending.clear();
		this.start();
	}

	private request<T>(op: string, ...args: unknown[]): Promise<T> {
		if (!this.worker) {
			return Promise.reject(new Error('No folder is open.'));
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

	methods(file: string) {
		return this.request<{ id: string; name: string; line: number; isEntry: boolean }[]>('methods', file);
	}

	async graph(id: string) {
		await this.flush();
		return this.request<FlowNode>('graph', id);
	}

	callers(id: string) {
		return this.request<FlowNode | null>('callers', id);
	}

	impact(id: string) {
		return this.request<{ label: string; items: string[] }>('impact', id);
	}

	dispose() {
		void this.worker?.terminate();
		this.ready.dispose();
		this.disposables.forEach(d => d.dispose());
	}
}

/** Java, Python, JS/TS through the polyglot index. */
export class PolyProvider implements FlowProvider {
	constructor(private readonly index: PolyIndex) { }

	private id(t: FlowTarget) {
		if (t.kind !== 'poly') {
			throw new Error('not a polyglot target');
		}
		return t.id;
	}

	graph(t: FlowTarget) {
		return this.index.graph(this.id(t));
	}

	callers(t: FlowTarget) {
		return this.index.callers(this.id(t));
	}

	impact(t: FlowTarget) {
		return this.index.impact(this.id(t));
	}
}
