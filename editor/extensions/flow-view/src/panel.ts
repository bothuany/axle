/*---------------------------------------------------------------------------------------------
 *  Flow: the canvas (custom-ide/ui, webview build) in one reusable editor tab. The webview never
 *  talks to a backend itself: it asks this host, which routes to the provider for the target.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentChanges } from './agentDiff';
import { agentContext } from './harness';
import type { FlowNode, FlowProvider, FlowTarget } from './providers';
import { flowRoot } from './root';

interface Request {
	type: 'request';
	id: number;
	op: 'graph' | 'callers' | 'save' | 'keep' | 'undo' | 'impact' | 'context' | 'timeline' | 'undoFrom' | 'editHooks';
	turn?: number;
	target?: FlowTarget;
	file?: string;
	startLine?: number;
	endLine?: number;
	original?: string;
	code?: string;
}

const normalize = (s: string) => s.replace(/\r\n/g, '\n');

/** Test code: a test project folder (Foo.Tests, Foo.Test.Unit, tests/, __tests__/) or a test file name. */
const TEST_DIR = /[\\/](?:[^\\/]*[.-]tests?(?:[.-][^\\/]*)?|tests?|__tests__|spec)[\\/]/i;
const TEST_FILE = /(?:[a-z0-9_]Tests?|[.-](?:test|spec))\.\w+$/;
const isTest = (file: string) => TEST_DIR.test(file) || TEST_FILE.test(file);

/**
 * A flow shows how the application runs; tests calling into it are noise there. Callers and callees in
 * test code are dropped (unless `flow.showTests` is on), together with everything only they reach.
 */
function withoutTests<T extends FlowNode | null>(node: T): T {
	if (!node || vscode.workspace.getConfiguration('flow').get<boolean>('showTests', false)) {
		return node;
	}
	const prune = (n: FlowNode): FlowNode => ({ ...n, children: n.children.filter(c => !(c.node.file && isTest(c.node.file))).map(c => ({ ...c, node: prune(c.node) })) });
	return prune(node) as T;
}

export class FlowPanel implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;
	private readonly dist: string;
	private refreshTimer: NodeJS.Timeout | undefined;

	constructor(context: vscode.ExtensionContext, private readonly providerFor: (t: FlowTarget) => FlowProvider, private readonly changes: AgentChanges) {
		this.dist = path.join(flowRoot(context.extensionPath), 'ui', 'dist-webview');
	}

	async show(target: FlowTarget, label: string) {
		if (this.panel) {
			this.panel.title = `Flow: ${label}`;
			this.panel.reveal(undefined, true);
			await this.panel.webview.postMessage({ type: 'show', target, label });
			return;
		}
		const panel = this.panel = vscode.window.createWebviewPanel('flow.canvas', `Flow: ${label}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
			enableScripts: true,
			retainContextWhenHidden: true,
		});
		panel.iconPath = new vscode.ThemeIcon('type-hierarchy-sub');
		panel.onDidDispose(() => this.panel = undefined);
		panel.webview.onDidReceiveMessage(m => this.onMessage(m));
		panel.webview.html = await this.html(panel.webview, target, label);
		setTimeout(() => this.waiting && void this.panel?.webview.postMessage({ type: 'proposal', proposal: this.waiting }), 1500);
	}

	/** Disk changed (user save, agent edit, git): providers re-read it; ask the canvas to re-fetch. */
	refreshSoon() {
		if (!this.panel) {
			return;
		}
		clearTimeout(this.refreshTimer);
		// The Roslyn analyzer debounces its own file watcher by 300 ms.
		this.refreshTimer = setTimeout(() => this.panel?.webview.postMessage({ type: 'refresh' }), 800);
	}

	/**
	 * An agent asks to edit: tell the canvas which lines each proposed diff replaces, so it can mark those
	 * methods while the user decides. `oldText` is located in the current file; a new file marks nothing.
	 */
	async propose(p: { agent: string; title: string; files: string[]; diffs: { path: string; oldText: string | null; newText: string }[] }) {
		if (!this.panel) {
			return;
		}
		const spans: { file: string; start: number; end: number }[] = [];
		for (const d of p.diffs) {
			if (!d.oldText) {
				continue;
			}
			const text = (await fs.readFile(d.path, 'utf8').catch(() => '')).replace(/\r\n/g, '\n');
			const at = text.indexOf(d.oldText.replace(/\r\n/g, '\n'));
			if (at < 0) {
				continue;
			}
			const start = text.slice(0, at).split('\n').length;
			spans.push({ file: d.path, start, end: start + d.oldText.split('\n').length - 1 });
		}
		// Without exact lines (no diff, or text not found), mark every card in the file.
		const files = p.files.filter(f => !spans.some(s => s.file === f));
		await this.panel.webview.postMessage({ type: 'proposal', proposal: { agent: p.agent, title: p.title, spans, files } });
	}

	/** A proposal from the Claude Code CLI: exact spans, and the canvas offers Accept / Reject for it. */
	proposeSpans(p: { id: string; agent: string; title: string; files: string[]; spans: { file: string; start: number; end: number }[] }) {
		this.waiting = { ...p, answerable: true };
		void this.panel?.webview.postMessage({ type: 'proposal', proposal: this.waiting });
	}

	/** A CLI proposal still waiting for an answer: a canvas opened later shows it too. */
	private waiting: object | null = null;

	/** Set by the extension: the canvas answered a CLI proposal, or asked to @-mention a card in the CLI. */
	onAnswer: ((id: string, accept: boolean) => void) | undefined;
	onMention: ((file: string, start: number, end: number) => void) | undefined;

	proposalDone() {
		this.waiting = null;
		void this.panel?.webview.postMessage({ type: 'proposal', proposal: null });
	}

	/** Editor → canvas: the canvas highlights the card holding this line. */
	cursorMoved(file: string, line: number) {
		void this.panel?.webview.postMessage({ type: 'cursor', file, line });
	}

	private async onMessage(m: Request | { type: 'open' | 'reveal'; file: string; line: number } | { type: 'ask'; label: string; context: string } | { type: 'answer' | 'mention' }) {
		if (m.type === 'open' || m.type === 'reveal') {
			// open: jump there and type; reveal: show the line but keep the canvas focused.
			const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(m.file));
			const start = new vscode.Position(Math.max(0, m.line - 1), 0);
			await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(start, start), preview: true, preserveFocus: m.type === 'reveal' });
			return;
		}
		if (m.type === 'answer') {
			this.onAnswer?.((m as unknown as { id: string }).id, (m as unknown as { accept: boolean }).accept);
			return;
		}
		if (m.type === 'mention') {
			const x = m as unknown as { file: string; start: number; end: number };
			this.onMention?.(x.file, x.start, x.end);
			return;
		}
		if (m.type === 'ask') {
			await vscode.commands.executeCommand('flow.askAgent', m.label, m.context);
			return;
		}
		if (m.type !== 'request') {
			return;
		}
		let data: unknown;
		let error: string | undefined;
		try {
			switch (m.op) {
				case 'graph': {
					const g = withoutTests(await this.providerFor(m.target!).graph(m.target!));
					await this.changes.annotate(g, m.turn);
					data = g;
					break;
				}
				case 'callers': {
					const c = withoutTests(await this.providerFor(m.target!).callers(m.target!));
					await this.changes.annotate(c, m.turn);
					data = c;
					break;
				}
				case 'impact': data = await this.providerFor(m.target!).impact(m.target!); break;
				case 'timeline': data = await this.changes.timeline(); break;
				case 'editHooks': data = (await agentContext(m.file!)).items.filter(i => i.group === 'hooks' && i.detail.startsWith('After')).map(i => i.title); break;
				case 'undoFrom': data = await this.changes.undoFrom(m.turn!); break;
				case 'save': data = await this.save(m); break;
				case 'keep': this.changes.keep(m.file!); data = { ok: true }; break;
				case 'undo': data = await this.changes.undo(m.file!, m.startLine!, m.endLine!); break;
			}
		} catch (e) {
			error = (e as Error)?.message ?? String(e);
		}
		await this.panel?.webview.postMessage({ type: 'response', id: m.id, data, error });
	}

	/**
	 * Applies a card edit to the real document (not the file): editor buffers, undo and the agent's
	 * Keep/Undo snapshots all stay consistent. Refuses if the method changed since the card was drawn.
	 */
	private async save(m: Request): Promise<{ ok: boolean; message?: string }> {
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(m.file!));
		const last = m.endLine! - 1;
		if (last >= doc.lineCount) {
			return { ok: false, message: 'The file got shorter since this card was drawn. Refreshing the flow; try again.' };
		}
		const range = new vscode.Range(m.startLine! - 1, 0, last, doc.lineAt(last).text.length);
		if (normalize(doc.getText(range)) !== normalize(m.original!)) {
			this.refreshSoon();
			return { ok: false, message: 'This method changed somewhere else. Refreshing the flow; try again.' };
		}
		const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
		const edit = new vscode.WorkspaceEdit();
		edit.replace(doc.uri, range, normalize(m.code!).replace(/\n/g, eol));
		if (!await vscode.workspace.applyEdit(edit)) {
			return { ok: false, message: 'Could not apply the edit.' };
		}
		await doc.save();
		return { ok: true };
	}

	/**
	 * Everything inline: in the Flow shell (WKWebView) webviews run without a service worker, so they
	 * cannot load side files. The canvas is built as one JS + one CSS file for exactly this.
	 */
	private async html(webview: vscode.Webview, target: FlowTarget, label: string) {
		const [js, css] = await Promise.all([
			fs.readFile(path.join(this.dist, 'webview.js'), 'utf8'),
			fs.readFile(path.join(this.dist, 'webview.css'), 'utf8'),
		]);
		const kind = vscode.window.activeColorTheme.kind;
		const dark = kind !== vscode.ColorThemeKind.Light && kind !== vscode.ColorThemeKind.HighContrastLight;
		const csp = [
			`default-src 'none'`,
			`script-src 'unsafe-inline'`,
			`style-src 'unsafe-inline'`,
			`font-src ${webview.cspSource} data:`,
			`img-src ${webview.cspSource} data:`,
			`worker-src blob:`,
		].join('; ');
		const safe = (text: string, tag: string) => text.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);
		return `<!doctype html><html><head><meta charset="utf-8">` +
			`<meta http-equiv="Content-Security-Policy" content="${csp}">` +
			`<style>${safe(css, 'style')}</style>` +
			`<script>window.__FLOW__=${JSON.stringify({ target, label, dark })}</script>` +
			`</head><body><div id="root"></div><script>${safe(js, 'script')}</script></body></html>`;
	}

	dispose() {
		this.panel?.dispose();
	}
}
