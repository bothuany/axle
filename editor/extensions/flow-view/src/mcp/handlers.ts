/*---------------------------------------------------------------------------------------------
 *  Axle agent bridge: what the tools do inside the window. Everything here reads, opens or draws:
 *  no file is written and no command is run. Paths must be inside a workspace folder; the board is
 *  validated here (the MCP process is not the trust boundary). Nothing starts the analyzer in a way
 *  that could ask the user a question: a C# solution that is not chosen yet is reported, not prompted.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { innermost, type Analyzer } from '../analyzer';
import { entryName, type Endpoints, type Entry, type Source } from '../backends';
import { parseBoard } from '../board/spec';
import { cleanBoardId, type BoardStore } from '../board/store';
import { POLY_LANGUAGES, type PolyIndex } from '../poly/client';
import type { FlowProvider, FlowTarget } from '../providers';
import { flowToText } from './flowtext';
import { errorResult, type ToolResult } from './protocol';
import { resolveInWorkspace } from './registry';
import { searchEntries } from './search';
import { NODE_STATUSES } from './tools';

/** What the tools need from the rest of the extension. */
export interface ToolDeps {
	log: vscode.LogOutputChannel;
	endpoints: Endpoints;
	analyzer: Analyzer;
	poly: PolyIndex;
	boards: BoardStore;
	providerFor(target: FlowTarget): FlowProvider;
	showEntry(id: string, label: string, source?: Source): Promise<void>;
	showTarget(target: FlowTarget, label: string): Promise<void>;
	/** The flow the canvas shows now. */
	currentFlow(): { id: string; label: string } | undefined;
}

const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] });
const num = (v: unknown, fallback: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(1, Math.min(max, Math.floor(v))) : fallback;
const slash = (p: string) => p.replace(/\\/g, '/');

/** A promise that gives up: a stuck backend must not hold the agent's call for the whole client timeout. */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	return Promise.race([p, new Promise<never>((_, reject) => timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)}s`)), ms))]).finally(() => clearTimeout(timer));
}

const ROSLYN_WAIT = {
	loading: 'Axle is loading the C# solution (the first load takes a while). Try again in about 20 seconds.',
	choose: 'There are several C# solutions and none is chosen: ask the user to pick one ("Axle: Choose Solution…"), then try again.',
};

interface Resolved { target: FlowTarget; label: string; source: Source | 'lsp'; id?: string; file?: string }

export class AgentTools {
	constructor(private readonly d: ToolDeps) { }

	async call(tool: string, a: Record<string, unknown>): Promise<ToolResult> {
		try {
			switch (tool) {
				case 'open': return await this.open(a);
				case 'find_entry_points': return await this.find(a);
				case 'show_flow': return await this.flow(a, true);
				case 'flow_text': return await this.flow(a, false);
				case 'impact': return await this.impact(a);
				case 'get_context': return await this.context();
				case 'draw_board': return await this.draw(a);
				case 'update_board': return await this.update(a);
				default: return errorResult(`Unknown tool: ${tool}`);
			}
		} catch (e) {
			return errorResult(`${tool}: ${(e as Error)?.message ?? e}`);
		}
	}

	private get folders() {
		return (vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file').map(f => f.uri.fsPath);
	}

	private rel(file: string) {
		return slash(vscode.workspace.asRelativePath(file, false));
	}

	/** A file the agent named, inside the workspace (also after symbolic links), spelled the way VS Code spells it. */
	private async safeFile(input: unknown, mustExist = true): Promise<string> {
		if (typeof input !== 'string' || !input.trim()) {
			throw new Error('A file path is required.');
		}
		const lexical = resolveInWorkspace(input.trim(), this.folders);
		if (!lexical) {
			throw new Error(`"${input}" is outside this workspace (${this.folders.map(f => this.rel(f) || f).join(', ') || 'no folder open'}); only files inside it can be used.`);
		}
		try {
			const real = await fs.realpath(lexical);
			const roots = await Promise.all(this.folders.map(f => fs.realpath(f).catch(() => f)));
			if (!roots.some(r => resolveInWorkspace(real, [r]))) {
				throw new Error(`"${input}" resolves outside this workspace.`);
			}
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
				if (mustExist) {
					throw new Error(`File not found: ${input}`);
				}
			} else {
				throw e;
			}
		}
		return vscode.Uri.file(lexical).fsPath;
	}

	// ── open ────────────────────────────────────────────────────────────────

	private async open(a: Record<string, unknown>): Promise<ToolResult> {
		const file = await this.safeFile(a.file);
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const line = typeof a.line === 'number' ? Math.min(Math.max(1, Math.floor(a.line)), doc.lineCount) : undefined;
		const endLine = typeof a.endLine === 'number' && line ? Math.min(Math.max(line, Math.floor(a.endLine)), doc.lineCount) : line;
		const selection = line ? new vscode.Range(line - 1, 0, endLine! - 1, doc.lineAt(endLine! - 1).text.length) : undefined;
		// preserveFocus: the user is typing in the terminal; the editor shows the file without taking the keyboard.
		await vscode.window.showTextDocument(doc, { preview: a.preview !== false, preserveFocus: true, selection, viewColumn: vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One });
		return text(`Opened ${this.rel(file)}${line ? ` at line ${line}${endLine !== line ? `-${endLine}` : ''}` : ''} (${doc.lineCount} lines, ${doc.languageId}).`);
	}

	// ── entry points ────────────────────────────────────────────────────────

	/**
	 * The entry points, without ever asking the user anything: the cache first, then the backends that can start
	 * quietly. `note` says what is missing (a C# solution not chosen, an index still building).
	 */
	private async entries(): Promise<{ list: Entry[]; note?: string }> {
		const cached = this.d.endpoints.cached();
		if (cached.length) {
			return { list: cached };
		}
		const list: Entry[] = [];
		const notes: string[] = [];
		if (this.d.poly.isReady) {
			list.push(...(await within(this.d.poly.entryPoints(), 20_000, 'the code index').catch(() => [])).map(e => ({ ...e, source: 'poly' as const })));
		} else {
			notes.push('the code index is still building');
		}
		const roslyn = await this.roslynState();
		if (roslyn === 'ready') {
			try {
				list.push(...(await within(this.d.analyzer.entryPoints(), 30_000, 'the C# analyzer')).map(e => ({ ...e, source: 'roslyn' as const })));
			} catch (e) {
				notes.push(`the C# analyzer is not available (${(e as Error).message})`);
			}
		} else if (roslyn !== 'none') {
			notes.push(ROSLYN_WAIT[roslyn]);
		}
		return { list, note: notes.length ? `Note: ${notes.join('; ')}.` : undefined };
	}

	private async find(a: Record<string, unknown>): Promise<ToolResult> {
		const { list, note } = await this.entries();
		const query = typeof a.query === 'string' ? a.query : '';
		const hits = searchEntries(list, query, num(a.limit, 10, 50));
		if (!hits.length) {
			return text(`No entry point matches "${query}" among ${list.length}.${note ? ` ${note}` : ''}${list.length ? ' Try fewer words (a noun such as "user").' : ''}`);
		}
		const lines = hits.map(({ entry: e }) => `- ${e.http} ${entryName(e)}  ${this.rel(e.file)}:${e.line}  id=${e.id}`);
		return text([`${hits.length} of ${list.length} entry points${query ? ` for "${query}"` : ''}:`, ...lines, note ?? ''].filter(Boolean).join('\n'));
	}

	/**
	 * Where the C# analyzer stands, without ever asking the user anything or making the agent wait for a solution load:
	 * ready; loading (it was just started in the background: ask again in a moment); choose (several solutions, none picked);
	 * or none (no solution in this workspace).
	 */
	private async roslynState(): Promise<'ready' | 'loading' | 'choose' | 'none'> {
		const a = this.d.analyzer;
		if (a.isReady) {
			return 'ready';
		}
		if (!await a.hasSolution()) {
			return 'none';
		}
		if (await a.canStartQuietly()) {
			void a.port().catch(e => this.d.log.warn(`agent bridge: analyzer start failed: ${(e as Error).message}`));
			return 'loading';
		}
		return 'choose';
	}

	/** The flow target an `id`, or a `file` with `method`/`line`, stands for. */
	private async resolve(a: Record<string, unknown>): Promise<Resolved> {
		if (typeof a.id === 'string' && a.id) {
			const known = this.d.endpoints.cached().find(e => e.id === a.id) ?? (await this.entries()).list.find(e => e.id === a.id);
			const source: Source = known?.source ?? (a.id.startsWith('poly:') ? 'poly' : 'roslyn');
			if (source === 'roslyn') {
				const state = await this.roslynState();
				if (state !== 'ready') {
					throw new Error(state === 'none' ? 'This workspace has no C# solution.' : ROSLYN_WAIT[state]);
				}
			}
			return { target: { kind: source, id: a.id }, label: known ? entryName(known) : a.id.split(/[#:]/).pop() || a.id, source, id: a.id, file: known?.file };
		}
		if (typeof a.file !== 'string') {
			throw new Error('Pass an `id` from find_entry_points, or `file` with `method` or `line`.');
		}
		const file = await this.safeFile(a.file);
		const method = typeof a.method === 'string' ? a.method.trim().toLowerCase() : '';
		const line = typeof a.line === 'number' ? Math.floor(a.line) : undefined;
		if (!method && !line) {
			throw new Error('Pass `method` or `line` with `file`.');
		}
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const matches = (name: string) => { const n = name.toLowerCase(); return n === method || n.endsWith(`.${method}`) || n.endsWith(`#${method}`) || n.endsWith(`::${method}`); };
		const unknownMethod = (names: string[]) => new Error(`No method "${a.method}" in ${this.rel(file)}. Methods there: ${names.slice(0, 30).join(', ') || 'none found'}.`);

		if (POLY_LANGUAGES.has(doc.languageId)) {
			if (!this.d.poly.isReady) {
				throw new Error('The code index is still building; retry in a few seconds.');
			}
			if (line) {
				const hit = await this.d.poly.functionAt(file, line);
				if (!hit) {
					throw new Error(`No function contains line ${line} of ${this.rel(file)}.`);
				}
				return { target: { kind: 'poly', id: hit.id }, label: hit.label, source: 'poly', id: hit.id, file };
			}
			const all = await this.d.poly.methods(file);
			const hit = all.find(m => matches(m.name));
			if (!hit) {
				throw unknownMethod(all.map(m => m.name));
			}
			return { target: { kind: 'poly', id: hit.id }, label: hit.name, source: 'poly', id: hit.id, file };
		}
		const roslyn = doc.languageId === 'csharp' ? await this.roslynState() : 'none';
		if (roslyn === 'loading' || roslyn === 'choose') {
			throw new Error(ROSLYN_WAIT[roslyn]);
		}
		if (roslyn === 'ready') {
			const all = await this.d.analyzer.methods(file);
			const hit = line ? innermost(all, line) : all.find(m => matches(m.name));
			if (!hit) {
				throw line ? new Error(`No method contains line ${line} of ${this.rel(file)}.`) : unknownMethod(all.map(m => m.name));
			}
			return { target: { kind: 'roslyn', id: hit.id }, label: hit.name, source: 'roslyn', id: hit.id, file };
		}
		// Any other language: its language server's symbols.
		const position = line ? new vscode.Position(Math.min(line, doc.lineCount) - 1, Math.max(0, doc.lineAt(Math.min(line, doc.lineCount) - 1).firstNonWhitespaceCharacterIndex)) : await this.symbolPosition(doc, matches, unknownMethod);
		return { target: { kind: 'lsp', uri: doc.uri.toString(), line: position.line, character: position.character }, label: a.method ? String(a.method) : `${path.basename(file)}:${line}`, source: 'lsp', file };
	}

	private async symbolPosition(doc: vscode.TextDocument, matches: (n: string) => boolean, unknownMethod: (names: string[]) => Error): Promise<vscode.Position> {
		const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', doc.uri) ?? [];
		const all: vscode.DocumentSymbol[] = [];
		const walk = (list: vscode.DocumentSymbol[]) => list.forEach(s => { all.push(s); walk(s.children ?? []); });
		walk(symbols);
		const callable = all.filter(s => s.kind === vscode.SymbolKind.Method || s.kind === vscode.SymbolKind.Function || s.kind === vscode.SymbolKind.Constructor);
		const hit = callable.find(s => matches(s.name));
		if (!hit) {
			throw unknownMethod(callable.map(s => s.name));
		}
		return hit.selectionRange.start;
	}

	// ── flows ───────────────────────────────────────────────────────────────

	private async flow(a: Record<string, unknown>, open: boolean): Promise<ToolResult> {
		const r = await this.resolve(a);
		if (open) {
			if (r.source === 'lsp') {
				await this.d.showTarget(r.target, r.label);
			} else {
				await this.d.showEntry(r.id!, r.label, r.source);
			}
		}
		const root = await within(this.d.providerFor(r.target).graph(r.target), 120_000, 'the flow');
		const t = flowToText(root, { depth: num(a.depth, 6, 12), rel: f => this.rel(f) });
		return text([
			open ? `Opened the flow of ${r.label} in Axle.` : `Flow of ${r.label}:`,
			'Format: "-> L<n>" is the line in the caller where the call is made; [db] marks a table.',
			'',
			t.text,
			t.tables.length ? `\nTables touched: ${t.tables.join(', ')}` : '',
		].join('\n'));
	}

	private async impact(a: Record<string, unknown>): Promise<ToolResult> {
		const r = await this.resolve(a);
		const provider = this.d.providerFor(r.target);
		const [callers, affected] = await Promise.all([
			within(provider.callers(r.target), 60_000, 'the callers').catch(() => null),
			within(provider.impact(r.target), 60_000, 'the impact').catch((e: Error) => ({ label: 'entry point', items: [], error: e.message })),
		]);
		const out = [`Impact of changing ${r.label}:`];
		if (callers) {
			const t = flowToText(callers, { depth: num(a.depth, 3, 6), rel: f => this.rel(f) }, 'callers');
			out.push('', t.nodes > 1 ? 'Callers ("<- L<n>" is the line in the caller):' : 'No callers found in the index.', t.nodes > 1 ? t.text : '');
		}
		const items = (affected as { items: string[] }).items;
		out.push('', items.length ? `${items.length} ${(affected as { label: string }).label}${items.length > 1 ? 's' : ''} reach it:` : 'No entry point reaches it.', ...items.slice(0, 60).map(i => `- ${i}`));
		return text(out.join('\n'));
	}

	// ── context ─────────────────────────────────────────────────────────────

	private async gitChanges(): Promise<{ branch?: string; files: string[] } | undefined> {
		try {
			const ext = vscode.extensions.getExtension('vscode.git');
			const api = (ext?.isActive ? ext.exports : await ext?.activate())?.getAPI?.(1);
			const repo = api?.repositories?.find((r: { rootUri: vscode.Uri }) => this.folders.some(f => resolveInWorkspace(r.rootUri.fsPath, [f]) || resolveInWorkspace(f, [r.rootUri.fsPath])));
			if (!repo) {
				return undefined;
			}
			const s = repo.state;
			const files = new Set<string>();
			for (const c of [...s.workingTreeChanges, ...s.indexChanges, ...s.mergeChanges]) {
				files.add(this.rel(c.uri.fsPath));
			}
			return { branch: s.HEAD?.name, files: [...files].slice(0, 50) };
		} catch {
			return undefined;
		}
	}

	private diagnostics() {
		const sev = ['error', 'warning', 'info', 'hint'];
		const perFile: { file: string; errors: number; warnings: number; first: string[] }[] = [];
		let errors = 0;
		let warnings = 0;
		for (const [uri, list] of vscode.languages.getDiagnostics()) {
			if (uri.scheme !== 'file' || !vscode.workspace.getWorkspaceFolder(uri)) {
				continue;
			}
			const e = list.filter(d => d.severity === vscode.DiagnosticSeverity.Error);
			const w = list.filter(d => d.severity === vscode.DiagnosticSeverity.Warning);
			errors += e.length;
			warnings += w.length;
			if (e.length || w.length) {
				perFile.push({ file: this.rel(uri.fsPath), errors: e.length, warnings: w.length, first: e.slice(0, 2).map(d => `L${d.range.start.line + 1} ${(sev[d.severity])}: ${d.message.split('\n')[0].slice(0, 160)}`) });
			}
		}
		perFile.sort((a, b) => b.errors - a.errors || b.warnings - a.warnings);
		return { errors, warnings, files: perFile.slice(0, 10), moreFiles: Math.max(0, perFile.length - 10) };
	}

	private async context(): Promise<ToolResult> {
		const ed = vscode.window.activeTextEditor;
		const active = ed && ed.document.uri.scheme === 'file' ? {
			file: this.rel(ed.document.uri.fsPath),
			language: ed.document.languageId,
			dirty: ed.document.isDirty,
			cursor: { line: ed.selection.active.line + 1, column: ed.selection.active.character + 1 },
			selection: ed.selection.isEmpty ? undefined : { startLine: ed.selection.start.line + 1, endLine: ed.selection.end.line + 1, text: ed.document.getText(ed.selection).slice(0, 4000) },
			visibleLines: ed.visibleRanges[0] ? [ed.visibleRanges[0].start.line + 1, ed.visibleRanges[0].end.line + 1] : undefined,
		} : undefined;
		const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input instanceof vscode.TabInputText && t.input.uri.scheme === 'file').slice(0, 30)
			.map(t => ({ file: this.rel((t.input as vscode.TabInputText).uri.fsPath), active: t.isActive || undefined, dirty: t.isDirty || undefined }));
		const flow = this.d.currentFlow();
		const [git] = await Promise.all([within(this.gitChanges(), 4000, 'git').catch(() => undefined)]);
		return text(JSON.stringify({
			workspace: this.folders,
			activeFile: active,
			flowOnCanvas: flow ? { label: flow.label, id: flow.id } : undefined,
			openEditors: tabs,
			git,
			diagnostics: this.diagnostics(),
			boards: this.d.boards.list().slice(0, 10).map(b => ({ id: b.id, title: b.spec.title, kind: b.spec.kind })),
		}, null, 1));
	}

	// ── boards ──────────────────────────────────────────────────────────────

	private async draw(a: Record<string, unknown>): Promise<ToolResult> {
		let raw = a.board;
		if (typeof raw === 'string') {
			try {
				raw = JSON.parse(raw);
			} catch {
				throw new Error('`board` must be an object (or JSON text of one).');
			}
		}
		if (JSON.stringify(raw ?? null).length > 1_500_000) {
			throw new Error('The board is too large; draw fewer nodes or split it into several boards.');
		}
		const spec = parseBoard(raw);
		const warnings: string[] = [];
		const sent = raw as { nodes?: unknown[]; edges?: unknown[] };
		const droppedEdges = (Array.isArray(sent.edges) ? sent.edges.length : 0) - spec.edges.length;
		if (droppedEdges > 0) {
			warnings.push(`${droppedEdges} edge(s) were dropped because they name a node id that does not exist (or exceed the limit).`);
		}
		const droppedNodes = (Array.isArray(sent.nodes) ? sent.nodes.length : 0) - spec.nodes.length;
		if (droppedNodes > 0) {
			warnings.push(`${droppedNodes} node(s) were dropped (not objects, or without an id or label).`);
		}
		// Links to code: only files inside the workspace; a path outside is dropped, not followed.
		for (const n of spec.nodes) {
			if (n.file) {
				const resolved = resolveInWorkspace(n.file, this.folders);
				if (resolved) {
					n.file = vscode.Uri.file(resolved).fsPath;
				} else {
					warnings.push(`node "${n.id}": file "${n.file}" is outside the workspace and was not linked.`);
					n.file = undefined;
					n.line = undefined;
				}
			}
		}
		const wanted = cleanBoardId(a.id);
		const replaced = wanted ? !!this.d.boards.get(wanted) : false;
		const id = await this.d.boards.set(spec, { id: wanted, origin: 'agent' });
		return text([
			`Board "${id}" ${replaced ? 'replaced' : 'drawn'} and shown to the user in Axle: ${spec.kind}, ${spec.nodes.length} nodes, ${spec.edges.length} edges.`,
			spec.kind === 'plan' ? `Tick steps off with update_board (id "${id}", nodeId one of: ${spec.nodes.slice(0, 20).map(n => n.id).join(', ')}).` : `Use id "${id}" again to replace it.`,
			...warnings,
		].join('\n'));
	}

	private async update(a: Record<string, unknown>): Promise<ToolResult> {
		const id = cleanBoardId(a.id);
		if (!id || typeof a.nodeId !== 'string') {
			throw new Error('`id` and `nodeId` are required.');
		}
		const status = typeof a.status === 'string' ? a.status : undefined;
		if (status !== undefined && !(NODE_STATUSES as readonly string[]).includes(status)) {
			throw new Error(`status must be one of: ${NODE_STATUSES.join(', ')}.`);
		}
		if (status === undefined && typeof a.note !== 'string') {
			throw new Error('Pass `status` and/or `note`.');
		}
		const node = await this.d.boards.updateNode(id, a.nodeId, { status: status as (typeof NODE_STATUSES)[number] | undefined, note: typeof a.note === 'string' ? a.note : undefined });
		return text(`Board "${id}": node "${node.id}" is now ${node.status ?? 'unmarked'}${typeof a.note === 'string' ? ' (note updated)' : ''}.`);
	}
}
