/*---------------------------------------------------------------------------------------------
 *  Flow: the "◆ Flow" links above functions, one provider per backend: Roslyn for C#, the
 *  polyglot index for Java/Python/JS/TS/Go/PHP/Ruby/Rust (the language server's own lens is in lsp.ts).
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { Analyzer } from './analyzer';
import { Command } from './commands';
import type { PolyIndex } from './poly/client';

interface Lensed { id: string; name: string; line: number; isEntry: boolean }

/** Common part: the refresh event, the `flow.codeLens` switch and the clean-up of everything registered. */
abstract class FlowLenses implements vscode.CodeLensProvider, vscode.Disposable {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this.changed.event;
	private readonly disposables: vscode.Disposable[] = [this.changed];
	private timer: NodeJS.Timeout | undefined;

	constructor() {
		this.disposables.push(vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('flow.codeLens') && this.refresh()));
		this.disposables.push({ dispose: () => clearTimeout(this.timer) });
	}

	protected listen(...events: vscode.Disposable[]) {
		this.disposables.push(...events);
	}

	protected refresh(delayMs = 0) {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.changed.fire(), delayMs);
	}

	/** The functions of a file that get a lens; empty while their backend is not ready. */
	protected abstract functions(doc: vscode.TextDocument): Promise<Lensed[]>;
	protected abstract args(m: Lensed): unknown[];

	async provideCodeLenses(doc: vscode.TextDocument): Promise<vscode.CodeLens[]> {
		if (!vscode.workspace.getConfiguration('flow').get<boolean>('codeLens', true)) {
			return [];
		}
		let functions: Lensed[];
		try {
			functions = await this.functions(doc);
		} catch {
			return [];
		}
		return functions.map(m => new vscode.CodeLens(new vscode.Range(m.line - 1, 0, m.line - 1, 0), {
			title: m.isEntry ? '◆ Flow (endpoint)' : '◆ Flow',
			command: Command.showEntry,
			arguments: this.args(m),
		}));
	}

	dispose() {
		this.disposables.forEach(d => d.dispose());
	}
}

/** C#: only once the analyzer can start without asking which solution (see `Analyzer.canStartQuietly`). */
export class RoslynLenses extends FlowLenses {
	constructor(private readonly analyzer: Analyzer) {
		super();
		this.listen(vscode.workspace.onDidSaveTextDocument(d => d.languageId === 'csharp' && this.refresh(800)));
	}

	protected async functions(doc: vscode.TextDocument) {
		if (!this.analyzer.isReady && !await this.analyzer.canStartQuietly()) {
			return [];
		}
		return this.analyzer.methods(doc.uri.fsPath);
	}

	protected args(m: Lensed) {
		return [m.id, m.name, 'roslyn'];
	}
}

/** Every language the polyglot index covers. */
export class PolyLenses extends FlowLenses {
	constructor(private readonly poly: PolyIndex) {
		super();
		this.listen(poly.onDidBecomeReady(() => this.refresh()));
	}

	protected async functions(doc: vscode.TextDocument) {
		return this.poly.isReady ? this.poly.methods(doc.uri.fsPath) : [];
	}

	protected args(m: Lensed) {
		return [m.id, m.name, 'poly'];
	}
}
