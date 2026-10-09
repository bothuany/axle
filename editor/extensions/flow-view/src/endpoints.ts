/*---------------------------------------------------------------------------------------------
 *  Flow: the endpoints of the solution, controller by controller. Each row leads with its HTTP
 *  verb in the verb's own colour, so a list of a hundred routes reads at a glance; a filter at
 *  the top narrows by name, verb or controller. Opening one draws its flow.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { Analyzer, EntryPoint } from './analyzer';

export class EndpointsView implements vscode.WebviewViewProvider {
	private view: vscode.WebviewView | undefined;
	private list: EntryPoint[];
	private current: string | undefined;

	constructor(private readonly analyzer: Analyzer) {
		this.list = analyzer.cachedEntryPoints();
		analyzer.onDidBecomeReady(() => void this.refresh());
	}

	/** The flow on the canvas; its row stays marked. */
	setCurrent(id: string) {
		this.current = id;
		void this.post();
	}

	async refresh() {
		this.list = await this.analyzer.entryPoints();
		await this.post();
	}

	resolveWebviewView(view: vscode.WebviewView) {
		this.view = view;
		view.webview.options = { enableScripts: true };
		view.webview.html = this.html();
		view.webview.onDidReceiveMessage(m => {
			if (m.type === 'ready') {
				void this.post();
			} else if (m.type === 'open') {
				this.current = m.id;
				void vscode.commands.executeCommand('flow.showMethod', m.id, m.label);
			} else if (m.type === 'pick') {
				void vscode.commands.executeCommand('flow.pickSolution');
			}
		});
		view.onDidChangeVisibility(() => view.visible && void this.post());
	}

	private async post() {
		const groups = new Map<string, { id: string; action: string; verb: string; route: string; file: string; line: number }[]>();
		for (const e of this.list) {
			const name = e.controller.replace(/Controller$/, '');
			const [verb, ...route] = e.http.split(/\s+/);
			groups.set(name, [...(groups.get(name) ?? []), { id: e.id, action: e.action, verb: verb.toUpperCase(), route: route.join(' '), file: vscode.workspace.asRelativePath(e.file), line: e.line }]);
		}
		await this.view?.webview.postMessage({
			type: 'data',
			current: this.current,
			groups: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, items]) => ({ name, items })),
		});
	}

	private html() {
		const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';`;
		return /* html */ `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
:root {
	--text: var(--vscode-foreground); --muted: var(--vscode-descriptionForeground); --line: var(--vscode-widget-border, #30323c);
	--hover: var(--vscode-list-hoverBackground); --sel: var(--vscode-list-inactiveSelectionBackground);
	--mono: var(--vscode-editor-font-family, ui-monospace, Menlo, monospace);
	--get: #6fcf97; --post: #e5b567; --put: #7aa2f7; --patch: #b392f0; --delete: #f2777a; --other: #9aa4bf;
}
* { box-sizing: border-box; }
body { margin: 0; padding: 0 8px 16px 6px; color: var(--text); font: 13px/1.4 var(--vscode-font-family, -apple-system, system-ui); background: transparent; }
.filter { position: sticky; top: 0; z-index: 1; padding: 6px 0 8px 2px; background: var(--vscode-sideBar-background); }
.filter input { width: 100%; height: 26px; padding: 0 10px; border-radius: 7px; border: 1px solid var(--vscode-input-border, var(--line)); background: var(--vscode-input-background); color: var(--text); font: inherit; outline: none; }
.filter input:focus { border-color: color-mix(in srgb, #7aa2f7 60%, transparent); }
.filter input::placeholder { color: var(--muted); }
.count { margin: 6px 2px 0; color: var(--muted); font-size: 11.5px; }

.group > summary { list-style: none; display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 6px 0 2px; border-radius: 6px; cursor: pointer; user-select: none; }
.group > summary::-webkit-details-marker { display: none; }
.group > summary:hover { background: var(--hover); }
.chev { width: 14px; height: 14px; flex: none; color: var(--muted); transition: transform .12s; }
.group[open] > summary .chev { transform: rotate(90deg); }
.group > summary .name { font-weight: 600; }
.group > summary .n { margin-left: auto; color: var(--muted); font-size: 11.5px; font-variant-numeric: tabular-nums; }

.row { display: flex; align-items: center; gap: 0; width: 100%; height: 24px; padding: 0 6px 0 22px; border: 0; border-radius: 6px; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.row:hover { background: var(--hover); }
.row.current { background: var(--sel); }
.row:focus-visible, .group > summary:focus-visible { outline: 1.5px solid #7aa2f7; outline-offset: -1.5px; }
/* The verb leads, in a fixed column, so actions line up whatever their verb. */
.verb { flex: none; width: 50px; font: 600 10.5px var(--mono); letter-spacing: .02em; }
.verb.GET { color: var(--get); } .verb.POST { color: var(--post); } .verb.PUT { color: var(--put); } .verb.PATCH { color: var(--patch); } .verb.DELETE { color: var(--delete); } .verb.other { color: var(--other); }
.action { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.empty { margin: 12px 4px; color: var(--muted); line-height: 1.5; }
.empty button { all: unset; color: var(--vscode-textLink-foreground); cursor: pointer; }
mark { background: color-mix(in srgb, #e5b567 30%, transparent); color: inherit; border-radius: 2px; }
@media (prefers-reduced-motion: reduce) { .chev { transition: none; } }
</style></head><body>
<div class="filter"><input id="q" placeholder="Filter by name, verb or controller" aria-label="Filter endpoints"><p class="count" id="count"></p></div>
<div id="list"></div>
<script>
const vscode = acquireVsCodeApi();
const state = vscode.getState() || { open: {} };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
let data = { groups: [] };
const hl = (text, q) => { if (!q) return esc(text); const i = text.toLowerCase().indexOf(q); return i < 0 ? esc(text) : esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length)); };
function render() {
	const q = document.getElementById('q').value.trim().toLowerCase();
	const verbOnly = VERBS.find(v => v.toLowerCase() === q);
	let shown = 0, total = 0;
	const html = data.groups.map(g => {
		total += g.items.length;
		const items = g.items.filter(e => !q || (verbOnly ? e.verb === verbOnly : (e.action + ' ' + g.name + ' ' + e.route).toLowerCase().includes(q)));
		if (!items.length) return '';
		shown += items.length;
		const open = q || state.open[g.name] || items.some(e => e.id === data.current);
		return '<details class="group"' + (open ? ' open' : '') + ' data-name="' + esc(g.name) + '"><summary><svg class="chev" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="name">' + hl(g.name, verbOnly ? '' : q) + '</span><span class="n">' + items.length + '</span></summary>'
			+ items.map(e => '<button class="row' + (e.id === data.current ? ' current' : '') + '" data-id="' + esc(e.id) + '" data-label="' + esc(g.name + '.' + e.action) + '" title="' + esc(e.verb + ' ' + (e.route || '') + '\\n' + e.file + ':' + e.line) + '"><span class="verb ' + (VERBS.includes(e.verb) ? e.verb : 'other') + '">' + esc(e.verb) + '</span><span class="action">' + hl(e.action, verbOnly ? '' : q) + '</span></button>').join('')
			+ '</details>';
	}).join('');
	document.getElementById('list').innerHTML = html || (total ? '<p class="empty">No endpoint matches.</p>' : '<p class="empty">No endpoints yet. <button id="pick">Choose a solution</button> to list them.</p>');
	document.getElementById('count').textContent = total ? (q ? shown + ' of ' + total : total + ' endpoints') : '';
	document.querySelectorAll('details.group').forEach(d => d.addEventListener('toggle', () => { if (!q) { state.open[d.dataset.name] = d.open; vscode.setState(state); } }));
	document.querySelectorAll('.row').forEach(b => b.onclick = () => { data.current = b.dataset.id; vscode.postMessage({ type: 'open', id: b.dataset.id, label: b.dataset.label }); render(); });
	const pick = document.getElementById('pick'); if (pick) pick.onclick = () => vscode.postMessage({ type: 'pick' });
}
document.getElementById('q').addEventListener('input', render);
window.addEventListener('message', e => { if (e.data.type === 'data') { data = e.data; render(); } });
vscode.postMessage({ type: 'ready' });
</script></body></html>`;
	}
}
