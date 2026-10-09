/*---------------------------------------------------------------------------------------------
 *  Flow Home: the first thing a window shows. One question in the middle — what should we do —
 *  and around it only what helps answer it: where you were, the flows you opened, the endpoints,
 *  and whether the agent's harness is in good shape.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import type { Analyzer } from './analyzer';

const RECENT_FILES = 'flow.home.recentFiles';
const RECENT_FLOWS = 'flow.home.recentFlows';

interface Recent { path: string; at: number }
interface RecentFlow { id: string; label: string; at: number }
interface Health {
	score: number;
	counts: { error: number; warning: number; info: number };
	startupTokens: number;
	totals: Record<string, number>;
	issues: { severity: string; message: string; label: string; file: string; line?: number }[];
}

export class FlowHome implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly context: vscode.ExtensionContext, private readonly analyzer: Analyzer) {
		// Remember where you were: the files you open and the flows you draw.
		this.disposables.push(vscode.window.onDidChangeActiveTextEditor(e => {
			if (e?.document.uri.scheme === 'file') {
				const list = this.context.workspaceState.get<Recent[]>(RECENT_FILES, []).filter(r => r.path !== e.document.uri.fsPath);
				void this.context.workspaceState.update(RECENT_FILES, [{ path: e.document.uri.fsPath, at: Date.now() }, ...list].slice(0, 12));
			}
		}));
	}

	rememberFlow(id: string, label: string) {
		const list = this.context.workspaceState.get<RecentFlow[]>(RECENT_FLOWS, []).filter(r => r.id !== id);
		void this.context.workspaceState.update(RECENT_FLOWS, [{ id, label, at: Date.now() }, ...list].slice(0, 8));
	}

	async show() {
		if (this.panel) {
			this.panel.reveal();
			await this.post();
			return;
		}
		const panel = this.panel = vscode.window.createWebviewPanel('flow.home', 'Home', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: false });
		panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'flow.svg');
		panel.onDidDispose(() => this.panel = undefined);
		panel.webview.onDidReceiveMessage(m => this.onMessage(m));
		panel.webview.html = this.html();
		panel.onDidChangeViewState(e => e.webviewPanel.visible && void this.post());
	}

	private async onMessage(m: { type: string; text?: string; path?: string; id?: string; label?: string; command?: string; line?: number }) {
		switch (m.type) {
			case 'ready': return this.post();
			case 'ask': return vscode.commands.executeCommand('workbench.action.chat.open', { query: m.text, isPartialQuery: false });
			case 'draft': return vscode.commands.executeCommand('workbench.action.chat.open', { query: m.text, isPartialQuery: true });
			case 'open': return vscode.window.showTextDocument(vscode.Uri.file(m.path!), { selection: m.line !== undefined ? new vscode.Range(m.line, 0, m.line, 0) : undefined });
			case 'flow': return vscode.commands.executeCommand('flow.showMethod', m.id, m.label);
			case 'run': return vscode.commands.executeCommand(m.command!);
			default: return undefined;
		}
	}

	private async branch(): Promise<string | undefined> {
		try {
			const git = vscode.extensions.getExtension<{ getAPI(v: 1): { repositories: { state: { HEAD?: { name?: string } } }[] } }>('vscode.git');
			const api = (git?.isActive ? git.exports : await git?.activate())?.getAPI(1);
			return api?.repositories[0]?.state.HEAD?.name;
		} catch {
			return undefined;
		}
	}

	private async post() {
		const folder = vscode.workspace.workspaceFolders?.[0];
		const root = folder?.uri.fsPath ?? '';
		const health = await Promise.resolve(vscode.commands.executeCommand<Health | undefined>('flowHarness.health')).catch(() => undefined);
		const files = this.context.workspaceState.get<Recent[]>(RECENT_FILES, []).slice(0, 7)
			.map(r => ({ path: r.path, name: path.basename(r.path), dir: path.relative(root, path.dirname(r.path)), at: r.at }));
		const flows = this.context.workspaceState.get<RecentFlow[]>(RECENT_FLOWS, []).slice(0, 7);
		const endpoints = this.analyzer.cachedEntryPoints().slice(0, 7).map(e => ({ id: e.id, label: `${e.controller.replace(/Controller$/, '')}.${e.action}`, http: e.http.split(/\s/)[0] }));
		await this.panel?.webview.postMessage({
			type: 'data',
			repo: folder?.name ?? 'No folder open',
			branch: await this.branch(),
			hour: new Date().getHours(),
			files, flows, endpoints, health,
			total: this.analyzer.cachedEntryPoints().length,
		});
	}

	private html() {
		const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';`;
		return /* html */ `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
:root {
	--bg: var(--vscode-editor-background); --text: var(--vscode-foreground); --muted: var(--vscode-descriptionForeground);
	--line: var(--vscode-widget-border, #30323c); --raised: var(--vscode-chat-requestBubbleBackground, #262832);
	--signal: #7aa2f7; --plan: #e5b567; --ok: #6fcf97; --bad: #f2777a; --violet: #b392f0; --teal: #4fd1c5; --gold: #e2c08d;
	--mono: var(--vscode-editor-font-family, ui-monospace, Menlo, monospace);
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); font: 13px/1.5 var(--vscode-font-family, -apple-system, system-ui); }
main { max-width: 980px; margin: 0 auto; padding: clamp(40px, 11vh, 120px) 32px 48px; }

.where { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 12.5px; }
.where svg { flex: none; }
.where b { color: var(--text); font-weight: 600; }
.branch { font-family: var(--mono); font-size: 12px; padding: 1px 8px; border-radius: 999px; background: color-mix(in srgb, var(--ok) 12%, transparent); color: var(--ok); }

h1 { margin: 18px 0 18px; font-size: clamp(26px, 3.2vw, 34px); line-height: 1.15; font-weight: 600; letter-spacing: -0.02em; }

/* The one thing that is bigger than everything else: the question to the agent. */
.ask { position: relative; display: flex; flex-direction: column; border-radius: 16px; background: var(--raised); border: 1px solid var(--line); transition: border-color .15s, box-shadow .15s; }
.ask:focus-within { border-color: color-mix(in srgb, var(--signal) 65%, transparent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--signal) 13%, transparent); }
.ask textarea { resize: none; border: 0; outline: 0; background: transparent; color: var(--text); font: 15px/1.5 inherit; font-family: inherit; padding: 16px 18px 6px; min-height: 76px; }
.ask textarea::placeholder { color: var(--muted); }
.ask-bar { display: flex; align-items: center; gap: 6px; padding: 8px 10px 10px 14px; }
.chip { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--muted); font: 12px inherit; font-family: inherit; cursor: pointer; }
.chip:hover { color: var(--text); border-color: color-mix(in srgb, var(--text) 25%, transparent); }
.chip i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.chip.plan { color: var(--plan); border-color: color-mix(in srgb, var(--plan) 35%, transparent); }
.spacer { flex: 1; }
.send { width: 30px; height: 30px; border-radius: 50%; border: 0; background: var(--text); color: var(--bg); cursor: pointer; display: grid; place-items: center; }
.send:disabled { opacity: .3; cursor: default; }
.hint { margin: 10px 4px 0; color: var(--muted); font-size: 12px; }
kbd { font: 11px var(--mono); padding: 0 5px; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px; color: var(--text); }

/* Below the question: three lists side by side, separated by hairlines, no boxes. */
.cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 56px; }
.col { padding: 0 24px; border-left: 1px solid var(--line); min-width: 0; }
.col:first-child { padding-left: 4px; border-left: 0; }
.col h2 { margin: 0 0 10px; font-size: 12.5px; font-weight: 600; display: flex; align-items: baseline; gap: 8px; }
.col h2 span { color: var(--muted); font-weight: 400; }
.row { display: flex; align-items: baseline; gap: 8px; width: 100%; padding: 5px 8px; margin-left: -8px; border: 0; border-radius: 7px; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.row:hover { background: color-mix(in srgb, var(--text) 6%, transparent); }
.row .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.row .sub { margin-left: auto; color: var(--muted); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 45%; }
.verb { font: 600 10px var(--mono); width: 38px; flex: none; }
.v-GET { color: var(--ok); } .v-POST { color: var(--plan); } .v-PUT { color: var(--signal); } .v-PATCH { color: var(--violet); } .v-DELETE { color: var(--bad); }
.glyph { flex: none; width: 8px; height: 8px; transform: translateY(-1px); }
.empty { color: var(--muted); font-size: 12.5px; margin: 4px 0; }

.health { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; }
.score { font-size: 30px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.score.good { color: var(--ok); } .score.mid { color: var(--plan); } .score.bad { color: var(--bad); }
.health p { margin: 0; color: var(--muted); font-size: 12px; }
.sev { flex: none; width: 6px; height: 6px; border-radius: 50%; transform: translateY(-2px); }
.sev.error { background: var(--bad); } .sev.warning { background: var(--plan); }

.keys { display: flex; flex-wrap: wrap; gap: 8px 22px; margin-top: 52px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
.keys button { all: unset; cursor: pointer; display: inline-flex; gap: 8px; align-items: center; }
.keys button:hover { color: var(--text); }
.keys button:focus-visible, .row:focus-visible, .chip:focus-visible, .send:focus-visible { outline: 1.5px solid var(--signal); outline-offset: 2px; }

@media (max-width: 760px) {
	.cols { grid-template-columns: 1fr; gap: 28px; }
	.col, .col:first-child { padding: 0 4px; border-left: 0; }
}
@media (prefers-reduced-motion: reduce) { .ask { transition: none; } }
</style></head><body><main>
	<div class="where">
		<svg width="22" height="12" viewBox="0 0 240 120" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="10"><rect x="76" y="20" width="152" height="80" rx="22"/><path d="M46 60h48M136 60h32"/></g><path d="M14 36l36 24-36 24z" fill="#e2c08d"/><path d="M115 37l23 23-23 23-23-23z" fill="#c792ea"/><circle cx="188" cy="60" r="18" fill="#7aa2f7"/></svg>
		<b id="repo">…</b><span id="branch"></span>
	</div>
	<h1 id="greet">What should we work on?</h1>
	<form class="ask" id="ask">
		<textarea id="q" placeholder="Describe a change, ask about the code, or type / for a skill" rows="2" aria-label="Ask the agent"></textarea>
		<div class="ask-bar">
			<button type="button" class="chip plan" data-prefix="/plan " title="Switch the chat to Plan mode first"><i></i>Plan first</button>
			<button type="button" class="chip" data-draft="Review my uncommitted changes and list risks, most serious first." title="Put this prompt in the chat">Review my changes</button>
			<button type="button" class="chip" data-draft="Explain how this repo is laid out and where the main flows start." title="Put this prompt in the chat">Explain this repo</button>
			<span class="spacer"></span>
			<button class="send" id="send" disabled aria-label="Send to chat"><svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
		</div>
	</form>
	<p class="hint"><kbd>Enter</kbd> sends to chat, <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</p>

	<section class="cols">
		<div class="col"><h2>Where you were</h2><div id="files"></div></div>
		<div class="col"><h2 id="flowsTitle">Flows</h2><div id="flows"></div></div>
		<div class="col"><h2>Harness</h2><div id="health"></div></div>
	</section>

	<nav class="keys" aria-label="Shortcuts">
		<button data-run="flow.showAtCursor"><kbd>⌥⌘F</kbd> Show flow at cursor</button>
		<button data-run="flow.pickEndpoint"><kbd>⌥⌘E</kbd> Trace an endpoint</button>
		<button data-run="workbench.action.quickOpen"><kbd>⌘P</kbd> Go to file</button>
		<button data-run="workbench.view.extension.flowHarness"><kbd>Harness</kbd> Open the map</button>
	</nav>
</main>
<script>
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'now' : m < 60 ? m + ' min' : m < 1440 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' d'; };
const q = $('q');
let prefix = '';
q.addEventListener('input', () => { $('send').disabled = !q.value.trim(); });
q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
$('ask').addEventListener('submit', e => { e.preventDefault(); submit(); });
function submit() { const t = q.value.trim(); if (!t) return; vscode.postMessage({ type: 'ask', text: prefix + t }); q.value = ''; $('send').disabled = true; }
document.querySelectorAll('[data-draft]').forEach(b => b.addEventListener('click', () => vscode.postMessage({ type: 'draft', text: b.dataset.draft })));
document.querySelectorAll('[data-prefix]').forEach(b => b.addEventListener('click', () => { prefix = prefix ? '' : b.dataset.prefix; b.setAttribute('aria-pressed', String(!!prefix)); b.style.background = prefix ? 'color-mix(in srgb, var(--plan) 14%, transparent)' : ''; q.focus(); }));
document.querySelectorAll('[data-run]').forEach(b => b.addEventListener('click', () => vscode.postMessage({ type: 'run', command: b.dataset.run })));
window.addEventListener('message', e => {
	const d = e.data; if (d.type !== 'data') return;
	$('repo').textContent = d.repo;
	$('branch').innerHTML = d.branch ? '<span class="branch">' + esc(d.branch) + '</span>' : '';
	const part = d.hour < 5 ? 'Late night' : d.hour < 12 ? 'Morning' : d.hour < 18 ? 'Afternoon' : 'Evening';
	$('greet').textContent = part + ' in ' + d.repo + '. What should we work on?';
	$('files').innerHTML = d.files.length ? d.files.map(f => '<button class="row" data-path="' + esc(f.path) + '"><span class="name">' + esc(f.name) + '</span><span class="sub">' + esc(f.dir || ago(f.at)) + '</span></button>').join('') : '<p class="empty">Files you open show up here.</p>';
	if (d.flows.length) {
		$('flowsTitle').innerHTML = 'Flows you opened';
		$('flows').innerHTML = d.flows.map(f => '<button class="row" data-id="' + esc(f.id) + '" data-label="' + esc(f.label) + '"><svg class="glyph" viewBox="0 0 10 10"><path d="M5 0l5 5-5 5-5-5z" fill="#c792ea"/></svg><span class="name">' + esc(f.label) + '</span><span class="sub">' + ago(f.at) + '</span></button>').join('');
	} else {
		$('flowsTitle').innerHTML = 'Endpoints <span>' + (d.total || '') + '</span>';
		$('flows').innerHTML = d.endpoints.length ? d.endpoints.map(e => '<button class="row" data-id="' + esc(e.id) + '" data-label="' + esc(e.label) + '"><span class="verb v-' + esc(e.http) + '">' + esc(e.http) + '</span><span class="name">' + esc(e.label) + '</span></button>').join('') : '<p class="empty">Open a C# file and press <kbd>⌥⌘F</kbd> to draw its flow.</p>';
	}
	const h = d.health;
	if (h) {
		const cls = h.score >= 85 ? 'good' : h.score >= 60 ? 'mid' : 'bad';
		const t = h.totals;
		$('health').innerHTML = '<div class="health"><span class="score ' + cls + '">' + h.score + '</span><p>' + (h.counts.error ? h.counts.error + ' broken, ' : '') + h.counts.warning + ' to look at<br>' + (h.startupTokens / 1000).toFixed(1) + 'k tokens before your first prompt</p></div>'
			+ h.issues.slice(0, 4).map(i => '<button class="row" data-path="' + esc(i.file) + '" data-line="' + (i.line ?? '') + '"><span class="sev ' + esc(i.severity) + '"></span><span class="name">' + esc(i.message) + '</span></button>').join('')
			+ '<p class="empty">' + [t.instructions + ' instructions', t.skills + ' skills', t.hooks + ' hooks', t.mcp + ' MCP'].join(', ') + '</p>';
	} else {
		$('health').innerHTML = '<p class="empty">Open a folder to check its harness.</p>';
	}
	document.querySelectorAll('.row[data-path]').forEach(b => b.onclick = () => vscode.postMessage({ type: 'open', path: b.dataset.path, line: b.dataset.line ? Number(b.dataset.line) : undefined }));
	document.querySelectorAll('.row[data-id]').forEach(b => b.onclick = () => vscode.postMessage({ type: 'flow', id: b.dataset.id, label: b.dataset.label }));
});
vscode.postMessage({ type: 'ready' });
q.focus();
</script></body></html>`;
	}

	dispose() {
		this.panel?.dispose();
		this.disposables.forEach(d => d.dispose());
	}
}
