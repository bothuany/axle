/*---------------------------------------------------------------------------------------------
 *  Flow: the Roslyn analyzer (custom-ide/analyzer) as a child process of the extension host.
 *--------------------------------------------------------------------------------------------*/

import { spawn, type ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';
import { flowRoot } from './root';

export interface MethodInfo {
	id: string;
	name: string;
	line: number;
	startLine: number;
	endLine: number;
	isEntry: boolean;
}

export interface EntryPoint {
	id: string;
	controller: string;
	action: string;
	http: string;
	file: string;
	line: number;
}

const SOLUTION_KEY = 'flow.solution';
const ENTRIES_KEY = 'flow.entryPoints';

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.listen(0, '127.0.0.1', () => {
			const port = (srv.address() as net.AddressInfo).port;
			srv.close(() => resolve(port));
		});
		srv.on('error', reject);
	});
}

function canConnect(port: number): Promise<boolean> {
	return new Promise(resolve => {
		const s = net.connect(port, '127.0.0.1');
		s.once('connect', () => {
			s.destroy();
			resolve(true);
		});
		s.once('error', () => resolve(false));
	});
}

export class Analyzer implements vscode.Disposable {
	private child: ChildProcess | undefined;
	private ready: Promise<number> | undefined;
	private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
	/** True once the solution is loaded and the analyzer answers; nothing here starts it. */
	isReady = false;
	private readonly becameReady = new vscode.EventEmitter<void>();
	readonly onDidBecomeReady = this.becameReady.event;

	constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.LogOutputChannel) {
		this.status.command = 'flow.pickEndpoint';
	}

	/** Solution already chosen for this workspace: load it in the background so the first flow is instant. */
	warmUp() {
		if (this.context.workspaceState.get<string>(SOLUTION_KEY)) {
			this.port().then(() => this.entryPoints()).catch(e => this.log.warn(`warm-up failed: ${e}`));
		}
	}

	private setStatus(text: string, tooltip: string) {
		this.status.text = text;
		this.status.tooltip = tooltip;
		this.status.show();
	}

	/** Last known endpoint list for this workspace (shown instantly while a fresh one loads). */
	cachedEntryPoints(): EntryPoint[] {
		return this.context.workspaceState.get<EntryPoint[]>(ENTRIES_KEY) ?? [];
	}

	/** analyzer/ at the repository root, built by `npm run setup`. */
	private get dll() {
		return path.join(flowRoot(this.context.extensionPath), 'analyzer', 'bin', 'Debug', 'net10.0', 'FlowAnalyzer.dll');
	}

	port(): Promise<number> {
		this.ready ??= this.start().catch(e => {
			this.ready = undefined;
			throw e;
		});
		return this.ready;
	}

	private async solution(): Promise<string> {
		const saved = this.context.workspaceState.get<string>(SOLUTION_KEY);
		if (saved) {
			return saved;
		}
		const found = await vscode.workspace.findFiles('**/*.{sln,slnx}', '**/{node_modules,bin,obj,.claude,.git}/**', 200);
		if (!found.length) {
			throw new Error('No .sln in this workspace');
		}
		let pick = found[0];
		if (found.length > 1) {
			const items = found
				.map(u => ({ label: path.basename(u.fsPath), description: vscode.workspace.asRelativePath(path.dirname(u.fsPath)), uri: u }))
				.sort((a, b) => a.description.length - b.description.length);
			const chosen = await vscode.window.showQuickPick(items, { title: 'Flow: which solution should the flow come from?', ignoreFocusOut: true, matchOnDescription: true });
			if (!chosen) {
				throw new Error('No solution chosen');
			}
			pick = chosen.uri;
		}
		await this.context.workspaceState.update(SOLUTION_KEY, pick.fsPath);
		return pick.fsPath;
	}

	async pickSolution() {
		await this.context.workspaceState.update(SOLUTION_KEY, undefined);
		this.dispose();
		await this.port();
	}

	private async start(): Promise<number> {
		const sln = await this.solution();
		this.setStatus('$(loading~spin) Flow', `Flow: loading ${path.basename(sln)}`);
		const port = await freePort();
		this.log.info(`starting analyzer for ${sln} on ${port}`);
		const child = this.child = spawn('dotnet', [this.dll, 'serve', sln, String(port), String(process.pid)], { stdio: ['ignore', 'ignore', 'pipe'] });
		child.stderr!.on('data', d => this.log.info(String(d).trimEnd()));
		child.on('exit', code => {
			this.log.info(`analyzer exited (${code})`);
			if (this.child === child) {
				this.child = undefined;
				this.ready = undefined;
				this.isReady = false;
				this.setStatus('$(warning) Flow', 'Flow analyzer stopped — click to restart');
			}
		});
		return vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Flow: loading ${path.basename(sln)}` }, async () => {
			const deadline = Date.now() + 180_000;
			while (Date.now() < deadline) {
				if (await canConnect(port)) {
					this.setStatus('$(type-hierarchy-sub) Flow', `Flow: ${path.basename(sln)} ready — click for endpoints`);
					this.isReady = true;
					this.becameReady.fire();
					return port;
				}
				if (child.exitCode !== null) {
					throw new Error('Analyzer exited while loading the solution (see Output → Flow)');
				}
				await new Promise(r => setTimeout(r, 400));
			}
			throw new Error('Analyzer did not start within 3 minutes');
		});
	}

	async get<T>(apiPath: string): Promise<T> {
		const port = await this.port();
		const res = await fetch(`http://127.0.0.1:${port}${apiPath}`);
		if (!res.ok) {
			throw new Error(`${apiPath}: ${res.status}`);
		}
		return res.json() as Promise<T>;
	}

	methods(file: string) {
		return this.get<MethodInfo[]>(`/api/methods?file=${encodeURIComponent(file)}`);
	}

	async entryPoints() {
		const list = await this.get<EntryPoint[]>('/api/entrypoints');
		await this.context.workspaceState.update(ENTRIES_KEY, list);
		return list;
	}

	dispose() {
		this.status.hide();
		this.child?.kill();
		this.child = undefined;
		this.ready = undefined;
	}
}
