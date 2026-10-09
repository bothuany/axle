/*---------------------------------------------------------------------------------------------
 *  Flow: any language with a language server, through VS Code's call hierarchy API
 *  (TypeScript/JavaScript built in; Java, Python, Go, … once their language extension is installed).
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { FlowNode, FlowProvider, FlowTarget } from './providers';

const MAX_CHILDREN = 15;

function inWorkspace(uri: vscode.Uri) {
	return !!vscode.workspace.getWorkspaceFolder(uri) && !/[\\/]node_modules[\\/]/.test(uri.fsPath);
}

/** The language server may need a moment after a file opens; an empty answer is often just "not yet". */
async function prepare(uri: vscode.Uri, pos: vscode.Position): Promise<vscode.CallHierarchyItem | undefined> {
	for (let attempt = 0; attempt < 6; attempt++) {
		const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>('vscode.prepareCallHierarchy', uri, pos);
		if (items?.length) {
			return items[0];
		}
		await new Promise(r => setTimeout(r, 500));
	}
	return undefined;
}

export class LspProvider implements FlowProvider {
	private counter = 0;

	private async root(t: FlowTarget) {
		if (t.kind !== 'lsp') {
			throw new Error('not an LSP target');
		}
		const uri = vscode.Uri.parse(t.uri);
		const item = await prepare(uri, new vscode.Position(t.line, t.character));
		if (!item) {
			throw new Error('No language server answered for this position. Is the language extension installed?');
		}
		return item;
	}

	/** Card for one function: its full lines of source, located like the Roslyn nodes. */
	private async card(item: vscode.CallHierarchyItem, kind: FlowNode['kind']): Promise<FlowNode> {
		const local = inWorkspace(item.uri);
		let code: string | null = null;
		let start = item.range.start.line + 1;
		let end = item.range.end.line + 1;
		if (local) {
			const doc = await vscode.workspace.openTextDocument(item.uri);
			const full = new vscode.Range(item.range.start.line, 0, item.range.end.line, doc.lineAt(item.range.end.line).text.length);
			code = doc.getText(full);
		} else {
			start = end = 0;
		}
		return {
			key: `l${this.counter++}`,
			symbolId: `${item.uri.toString()}#${item.range.start.line}`,
			label: item.detail ? `${item.detail.split(/[\\/]/).pop()}.${item.name}`.replace(/^\./, '') : item.name,
			sub: local ? vscode.workspace.asRelativePath(item.uri) : item.uri.fsPath.split(/[\\/]/).slice(-2).join('/'),
			kind: local ? kind : 'external',
			file: local ? item.uri.fsPath : null,
			startLine: start,
			endLine: end,
			code,
			children: [],
		};
	}

	private id(item: vscode.CallHierarchyItem) {
		return `${item.uri.toString()}#${item.range.start.line}:${item.range.start.character}`;
	}

	async graph(t: FlowTarget): Promise<FlowNode> {
		this.counter = 0;
		const root = await this.root(t);
		const walk = async (item: vscode.CallHierarchyItem, depth: number, path: Set<string>): Promise<FlowNode> => {
			const node = await this.card(item, path.size === 0 ? 'controller' : 'method');
			if (depth <= 0 || node.kind === 'external' || path.has(this.id(item))) {
				return node;
			}
			path.add(this.id(item));
			const calls = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>('vscode.provideOutgoingCalls', item) ?? [];
			const seen = new Set<string>();
			for (const call of calls.sort((a, b) => a.fromRanges[0].start.line - b.fromRanges[0].start.line).slice(0, MAX_CHILDREN)) {
				if (seen.has(this.id(call.to))) {
					continue;
				}
				seen.add(this.id(call.to));
				// Library calls become leaves; only follow into our own code.
				const child = inWorkspace(call.to.uri) ? await walk(call.to, depth - 1, path) : await this.card(call.to, 'external');
				node.children.push({ callLine: call.fromRanges[0].start.line + 1, edgeKind: 'call', node: child });
			}
			path.delete(this.id(item));
			return node;
		};
		return walk(root, 4, new Set());
	}

	/** No framework knows the entry points here: report the outermost callers (nobody calls them). */
	async impact(t: FlowTarget) {
		const root = await this.root(t);
		const roots = new Set<string>();
		const seen = new Set<string>();
		let frontier = [root];
		for (let depth = 0; depth < 6 && frontier.length && seen.size < 300; depth++) {
			const next: vscode.CallHierarchyItem[] = [];
			for (const item of frontier) {
				if (seen.has(this.id(item))) {
					continue;
				}
				seen.add(this.id(item));
				const incoming = (await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>('vscode.provideIncomingCalls', item) ?? []).filter(c => inWorkspace(c.from.uri));
				if (!incoming.length && item !== root) {
					roots.add(`${vscode.workspace.asRelativePath(item.uri)} · ${item.name}`);
				}
				next.push(...incoming.map(c => c.from));
			}
			frontier = next;
		}
		return { label: 'root caller', items: [...roots].sort() };
	}

	async callers(t: FlowTarget): Promise<FlowNode | null> {
		this.counter = 1000;
		const root = await this.root(t);
		const walk = async (item: vscode.CallHierarchyItem, depth: number, path: Set<string>): Promise<FlowNode> => {
			const node = await this.card(item, 'method');
			if (depth <= 0 || path.has(this.id(item))) {
				return node;
			}
			path.add(this.id(item));
			const calls = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>('vscode.provideIncomingCalls', item) ?? [];
			for (const call of calls.filter(c => inWorkspace(c.from.uri)).slice(0, 12)) {
				const caller = await walk(call.from, depth - 1, path);
				node.children.push({ callLine: call.fromRanges[0].start.line + 1, edgeKind: 'call', node: caller });
			}
			path.delete(this.id(item));
			return node;
		};
		return walk(root, 3, new Set());
	}
}


/** "◆ Flow" above every function/method the language server reports, for non-Roslyn languages. */
export class LspLenses implements vscode.CodeLensProvider {
	async provideCodeLenses(doc: vscode.TextDocument): Promise<vscode.CodeLens[]> {
		if (doc.languageId === 'csharp' || !vscode.workspace.getConfiguration('flow').get<boolean>('codeLens', true)) {
			return [];
		}
		const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', doc.uri) ?? [];
		const lenses: vscode.CodeLens[] = [];
		const visit = (list: vscode.DocumentSymbol[], parent?: string) => {
			for (const s of list) {
				if (s.kind === vscode.SymbolKind.Function || s.kind === vscode.SymbolKind.Method || s.kind === vscode.SymbolKind.Constructor) {
					const target: FlowTarget = { kind: 'lsp', uri: doc.uri.toString(), line: s.selectionRange.start.line, character: s.selectionRange.start.character };
					lenses.push(new vscode.CodeLens(new vscode.Range(s.range.start, s.range.start), { title: '◆ Flow', command: 'flow.showTarget', arguments: [target, parent ? `${parent}.${s.name}` : s.name] }));
				}
				if (s.children?.length) {
					visit(s.children, s.name);
				}
			}
		};
		visit(symbols);
		return lenses;
	}
}
