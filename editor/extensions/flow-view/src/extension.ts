/*---------------------------------------------------------------------------------------------
 *  Flow: "◆ Flow" above C# methods, a command at the cursor, and the canvas tab.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Analyzer, type EntryPoint, type MethodInfo } from './analyzer';
import { AgentChanges } from './agentDiff';
import { FlowPanel } from './panel';
import { LspLenses, LspProvider } from './lsp';
import { RoslynProvider, type FlowTarget } from './providers';
import { FlowTrail } from './trail';
import { EndpointsView } from './endpoints';
import { FlowHome } from './home';
import { ClaudeIdeBridge } from './ide';

export function activate(context: vscode.ExtensionContext) {
	const log = vscode.window.createOutputChannel('Flow', { log: true });
	const analyzer = new Analyzer(context, log);
	const roslyn = new RoslynProvider(analyzer);
	const lsp = new LspProvider();
	// Per-workspace: the timeline and Keep/Undo state outlive a restart.
	const changes = new AgentChanges(context.storageUri && vscode.Uri.joinPath(context.storageUri, 'agent-changes.json').fsPath);
	void changes.load();
	const panel = new FlowPanel(context, t => t.kind === 'roslyn' ? roslyn : lsp, changes);
	context.subscriptions.push(changes, changes.onDidChange(() => panel.refreshSoon()));
	// Roslyn targets need the analyzer up first, so a load failure shows as an error, not an empty tab.
	const home = new FlowHome(context, analyzer);
	context.subscriptions.push(home, vscode.commands.registerCommand('flow.home', () => home.show()));
	// A window with nothing open starts on Home instead of an empty editor.
	setTimeout(() => {
		if (!vscode.window.tabGroups.all.some(g => g.tabs.length)) {
			void home.show();
		}
	}, 1200);
	const showRoslyn = async (id: string, label: string) => {
		home.rememberFlow(id, label);
		endpoints.setCurrent(id);
		await analyzer.port();
		await panel.show({ kind: 'roslyn', id } satisfies FlowTarget, label);
	};
	context.subscriptions.push(log, analyzer, panel);
	analyzer.warmUp();
	context.subscriptions.push(new FlowTrail(analyzer));
	const endpoints = new EndpointsView(analyzer);

	// Claude Code in a terminal connects to Flow with /ide: its diffs open here and on the canvas.
	const bridge = new ClaudeIdeBridge(context, {
		propose: p => panel.proposeSpans(p),
		proposalDone: () => panel.proposalDone(),
		willEdit: async (file, prompt) => {
			changes.ensureTurn(prompt, 'Claude Code (terminal)');
			await changes.willEdit([file]);
		},
		refresh: () => panel.refreshSoon(),
	});
	panel.onAnswer = (id, accept) => bridge.answer(id, accept);
	panel.onMention = (file, start, end) => bridge.mention(file, start, end);
	context.subscriptions.push(bridge,
		vscode.commands.registerCommand('flow.ide.accept', () => bridge.answer(undefined, true)),
		vscode.commands.registerCommand('flow.ide.reject', () => bridge.answer(undefined, false)),
		vscode.commands.registerCommand('flow.ide.mention', () => {
			const ed = vscode.window.activeTextEditor;
			if (ed) {
				bridge.mention(ed.document.uri.fsPath, ed.selection.start.line, ed.selection.end.line);
			}
		}),
		vscode.commands.registerCommand('flow.ide.howTo', async () => {
			const pick = await vscode.window.showQuickPick([
				{ label: '$(terminal) Run claude in a Flow terminal', detail: 'Connects automatically: diffs open in Flow, your selection is shared', run: 'term' },
				{ label: '$(plug) Already running claude elsewhere?', detail: 'Type /ide in it and pick "Flow"', run: '' },
			], { title: bridge.isConnected ? 'Claude Code is connected' : 'Connect Claude Code to Flow' });
			if (pick?.run === 'term') {
				const t = vscode.window.createTerminal({ name: 'Claude' });
				t.show();
				t.sendText('claude');
			}
		}),
	);
	void bridge.start();
	context.subscriptions.push(vscode.window.registerWebviewViewProvider('flow.endpoints', endpoints, { webviewOptions: { retainContextWhenHidden: true } }));
	// Editor → canvas sync (debounced: the canvas only needs to follow, not every keystroke).
	let cursorTimer: NodeJS.Timeout | undefined;
	context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(e => {
		if (e.textEditor.document.uri.scheme !== 'file') {
			return;
		}
		clearTimeout(cursorTimer);
		cursorTimer = setTimeout(() => panel.cursorMoved(e.textEditor.document.uri.fsPath, e.selections[0].active.line + 1), 150);
	}));
	// LSP flows read documents directly, so a save is enough to refresh them.
	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(() => panel.refreshSoon()));

	const fail = (e: unknown) => vscode.window.showErrorMessage(`Flow: ${(e as Error)?.message ?? e}`);

	context.subscriptions.push(
		vscode.commands.registerCommand('flow.showMethod', (id: string, label: string) => showRoslyn(id, label).catch(fail)),

		// Called by flow-agent around agent writes (see extensions/flow-agent/src/sessionType.ts).
		vscode.commands.registerCommand('flow.agentWillEdit', (files: string[]) => changes.willEdit(files)),
		vscode.commands.registerCommand('flow.agentDidEdit', async (files?: string[]) => {
			await changes.didEdit(files ?? []);
			panel.refreshSoon();
		}),
		vscode.commands.registerCommand('flow.agentProposes', (p: Parameters<FlowPanel['propose']>[0]) => panel.propose(p)),
		vscode.commands.registerCommand('flow.agentProposalDone', () => panel.proposalDone()),
		vscode.commands.registerCommand('flow.agentTurn', (prompt: string, agent: string) => changes.startTurn(prompt, agent)),

		// "Ask the agent about this flow": the flow as a markdown file attached to the chat, so the agent reads
		// exact file:line spans instead of searching for them.
		vscode.commands.registerCommand('flow.askAgent', async (label: string, flowText: string) => {
			const dir = vscode.Uri.joinPath(context.globalStorageUri, 'flows');
			await vscode.workspace.fs.createDirectory(dir);
			const file = vscode.Uri.joinPath(dir, `${label.replace(/[^\w.-]+/g, '_')}.flow.md`);
			await vscode.workspace.fs.writeFile(file, Buffer.from(flowText, 'utf8'));
			await vscode.commands.executeCommand('workbench.action.chat.open', {
				query: `About the attached flow (${label}): `,
				isPartialQuery: true,
				attachFiles: [file],
			});
		}),

		vscode.commands.registerCommand('flow.showTarget', (target: FlowTarget, label: string) => panel.show(target, label).catch(fail)),

		vscode.commands.registerCommand('flow.showAtCursor', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}
			if (editor.document.languageId !== 'csharp') {
				// Any other language: ask its language server about the function under the cursor.
				const pos = editor.selection.active;
				const word = editor.document.getText(editor.document.getWordRangeAtPosition(pos)) || 'Flow';
				await panel.show({ kind: 'lsp', uri: editor.document.uri.toString(), line: pos.line, character: pos.character }, word).catch(fail);
				return;
			}
			try {
				const line = editor.selection.active.line + 1;
				const methods = await analyzer.methods(editor.document.uri.fsPath);
				const hit = methods
					.filter(m => m.startLine <= line && line <= m.endLine)
					.sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0];
				if (!hit) {
					vscode.window.showInformationMessage('Flow: put the cursor inside a method.');
					return;
				}
				await showRoslyn(hit.id, hit.name);
			} catch (e) {
				fail(e);
			}
		}),

		vscode.commands.registerCommand('flow.pickEndpoint', async () => {
			// Show the cached list at once; swap in the fresh one when the analyzer answers.
			const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { e: EntryPoint }>();
			qp.title = 'Flow: open an endpoint';
			qp.matchOnDescription = true;
			const toItems = (eps: EntryPoint[]) => eps.map(e => ({ label: `${e.http} ${e.controller.replace(/Controller$/, '')}.${e.action}`, description: vscode.workspace.asRelativePath(e.file), e }));
			qp.items = toItems(analyzer.cachedEntryPoints());
			qp.busy = true;
			qp.onDidAccept(() => {
				const pick = qp.selectedItems[0];
				qp.hide();
				if (pick) {
					showRoslyn(pick.e.id, `${pick.e.controller}.${pick.e.action}`).catch(fail);
				}
			});
			qp.onDidHide(() => qp.dispose());
			qp.show();
			try {
				const fresh = await analyzer.entryPoints();
				const filter = qp.value;
				qp.items = toItems(fresh);
				qp.value = filter;
			} catch (e) {
				fail(e);
			} finally {
				qp.busy = false;
			}
		}),

		vscode.commands.registerCommand('flow.pickSolution', () => analyzer.pickSolution().catch(fail)),

		vscode.languages.registerCodeLensProvider({ language: 'csharp', scheme: 'file' }, new FlowLenses(analyzer)),
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, new LspLenses()),
	);

	// Any change on disk (editor save, agent edit, git checkout) re-draws the open flow.
	const watcher = vscode.workspace.createFileSystemWatcher('**/*.{cs,ts,tsx,js,jsx,java,kt,py,go,rs}');
	context.subscriptions.push(watcher, watcher.onDidChange(() => panel.refreshSoon()), watcher.onDidCreate(() => panel.refreshSoon()));
}

class FlowLenses implements vscode.CodeLensProvider {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this.changed.event;

	constructor(private readonly analyzer: Analyzer) {
		vscode.workspace.onDidSaveTextDocument(d => d.languageId === 'csharp' && setTimeout(() => this.changed.fire(), 800));
		vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('flow.codeLens') && this.changed.fire());
	}

	async provideCodeLenses(doc: vscode.TextDocument): Promise<vscode.CodeLens[]> {
		if (!vscode.workspace.getConfiguration('flow').get<boolean>('codeLens', true)) {
			return [];
		}
		let methods: MethodInfo[];
		try {
			methods = await this.analyzer.methods(doc.uri.fsPath);
		} catch {
			return [];
		}
		return methods.map(m => {
			const range = new vscode.Range(m.line - 1, 0, m.line - 1, 0);
			return new vscode.CodeLens(range, { title: m.isEntry ? '◆ Flow (endpoint)' : '◆ Flow', command: 'flow.showMethod', arguments: [m.id, m.name] });
		});
	}
}

export function deactivate() { }
