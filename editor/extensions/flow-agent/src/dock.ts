/*---------------------------------------------------------------------------------------------
 *  Axle: the Agents dock. One row per agent terminal: a status light (working, waiting for you,
 *  done), the prompt it is on, what it is doing this second, its to-do progress and its context.
 *  Whatever needs you rises to the top, so you never hunt for the stuck one.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { Agents, AgentSession } from './agents';
import { conflictText } from './conflicts';
import { WORKTREE_ACTIONS, type WorktreeAction, type WorktreeRows } from './worktreeActions';

/** The real marks: Claude's spark (from the Claude Code extension) and the Codex cloud (lobe-icons). */
const ICON = {
	claude: '<svg class="ico claude" viewBox="0 0 24 24" aria-hidden="true"><path fill="#D97757" d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"/></svg>',
	codex: '<svg class="ico codex" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="flow-codex" x1="12" x2="12" y1="0" y2="24" gradientUnits="userSpaceOnUse"><stop stop-color="#B1A7FF"/><stop offset=".5" stop-color="#7A9DFF"/><stop offset="1" stop-color="#3941FF"/></linearGradient></defs><path fill="url(#flow-codex)" fill-rule="evenodd" clip-rule="evenodd" d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z"/></svg>',
};

const ORDER: Record<AgentSession['state'], number> = { blocked: 0, done: 1, working: 2, starting: 3, idle: 4, unknown: 5, ended: 6 };

export class AgentsDock implements vscode.WebviewViewProvider, vscode.Disposable {
	private view: vscode.WebviewView | undefined;
	private timer: NodeJS.Timeout | undefined;
	private readonly changes: vscode.Disposable[];

	constructor(private readonly agents: Agents, private readonly worktrees?: WorktreeRows) {
		this.changes = [agents.onDidChange(() => this.post()), ...(worktrees ? [worktrees.onDidChange(() => this.post())] : [])];
	}

	dispose() {
		clearTimeout(this.timer);
		this.changes.forEach(d => d.dispose());
	}

	resolveWebviewView(view: vscode.WebviewView) {
		this.view = view;
		view.webview.options = { enableScripts: true };
		view.webview.html = this.html();
		view.webview.onDidReceiveMessage(m => {
			if (m.type === 'ready') {
				this.post();
			} else if (m.type === 'new') {
				// The page is not trusted with what to run: only the two built-in agents start from here
				// (your own commands go through "Start an Agent…", which reads them from your settings).
				// The button offers a new session or one of the earlier ones to resume.
				if (m.cli === 'claude' || m.cli === 'codex') {
					void vscode.commands.executeCommand('flow.agents.start', m.cli);
				}
			} else if (m.type === 'show' && typeof m.id === 'string') {
				this.agents.show(m.id);
			} else if (m.type === 'flow' && typeof m.id === 'string' && Number.isInteger(m.index)) {
				// An index into the list the host sent: the page never names a flow itself.
				this.agents.openImpactFlow(m.id, m.index);
			} else if (m.type === 'forget' && typeof m.id === 'string') {
				this.agents.forget(m.id);
			} else if (m.type === 'compact' && typeof m.id === 'string') {
				this.agents.compact(m.id);
			} else if (m.type === 'rename' && typeof m.id === 'string') {
				void this.rename(m.id);
			} else if (m.type === 'wt' && typeof m.id === 'string' && WORKTREE_ACTIONS.includes(m.action)) {
				// The page names the row and one of four actions; the folder and branches come from the host's own record.
				void this.worktrees?.act(m.id, m.action as WorktreeAction);
			} else if (m.type === 'pick') {
				void vscode.commands.executeCommand('flow.agents.new');
			} else if (m.type === 'chat') {
				void vscode.commands.executeCommand('workbench.action.openSettings', 'flow.agents.showChat');
			}
		});
		view.onDidChangeVisibility(() => view.visible && this.post());
		view.onDidDispose(() => {
			if (this.view === view) {
				this.view = undefined;
				clearTimeout(this.timer);
			}
		});
	}

	/** The page only names the agent; the new name is asked for here, so the page never decides what a row says. */
	private async rename(id: string) {
		const s = this.agents.sessions.get(id);
		if (!s) {
			return;
		}
		const name = await vscode.window.showInputBox({
			title: 'Rename Agent',
			value: s.name,
			prompt: s.cli === 'claude' ? 'Shown in this list and in Claude\'s /resume' : 'Shown in this list',
			validateInput: v => v.trim() ? undefined : 'A name is required',
		});
		if (name !== undefined) {
			await this.agents.rename(id, name);
		}
	}

	/** Coalesces bursts of hook events into one repaint. */
	private post() {
		const n = this.agents.needsYou;
		if (this.view) {
			this.view.badge = n ? { value: n, tooltip: n === 1 ? '1 agent needs you' : `${n} agents need you` } : undefined;
		}
		clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			const conflicts = this.agents.conflicts();
			const list = [...this.agents.sessions.values()]
				.sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.since - a.since)
				.map(s => ({ ...s, done: s.todos.filter(t => t.status === 'completed').length, current: s.todos.find(t => t.status === 'in_progress')?.text, impact: s.impact && { files: s.impact.files, more: s.impact.more, flows: s.impact.flows.map(f => ({ label: f.label, via: f.via })) },
					// Worktree and conflicts are explicit fields: the session's own record (paths, the base branch) stays here.
					worktree: s.worktree ? this.worktrees?.view(s) : undefined,
					clash: s.state === 'ended' ? undefined : conflicts.get(s.id)?.map(c => ({ text: conflictText(c), same: c.sameCheckout, files: c.files.slice(0, 12) })) }));
			void this.view?.webview.postMessage({ type: 'data', list, now: Date.now() });
		}, 60);
	}

	private html() {
		const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';`;
		return /* html */ `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
:root {
	--text: var(--vscode-foreground); --muted: var(--vscode-descriptionForeground); --line: var(--vscode-widget-border, #30323c);
	--hover: var(--vscode-list-hoverBackground); --card: color-mix(in srgb, var(--vscode-sideBar-background) 70%, #2a2c36);
	--mono: var(--vscode-editor-font-family, ui-monospace, Menlo, monospace);
	--working: #6f86ff; --blocked: #ffb454; --done: #5fe0a1; --idle: #9aa4bf; --ended: #5b5f6e;
	--claude: #d97757; --codex: #7fd1d1; --custom: #b88cff;
}
* { box-sizing: border-box; }
body { margin: 0; padding: 8px 10px 16px 8px; color: var(--text); font: 13px/1.4 var(--vscode-font-family, -apple-system, system-ui); background: transparent; }
.new { display: flex; gap: 6px; margin-bottom: 10px; }
.new button { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; height: 28px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--text); font: inherit; cursor: pointer; }
.new button:hover { background: var(--hover); }
.new button:focus-visible, .agent:focus-visible { outline: 1.5px solid var(--working); outline-offset: -1.5px; }
.new button.more { flex: 0 0 auto; padding: 0 10px; color: var(--muted); }
.ico { flex: none; width: 15px; height: 15px; display: block; }
.ico.claude { color: var(--claude); } .ico.codex { color: var(--codex); } .ico.custom { color: var(--custom); }
.tile { display: grid; place-items: center; border-radius: 4px; background: color-mix(in srgb, var(--custom) 22%, transparent); color: var(--custom); font: 700 9.5px/1 var(--mono); text-transform: uppercase; }

.agent { position: relative; display: block; width: 100%; margin: 0 0 6px; padding: 9px 10px 9px 12px; border: 1px solid transparent; border-radius: 10px; background: var(--card); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.agent:hover { border-color: var(--line); }
.agent.blocked { border-color: color-mix(in srgb, var(--blocked) 45%, transparent); background: color-mix(in srgb, var(--blocked) 8%, var(--card)); }
.agent.ended { opacity: .62; }
.top { display: flex; align-items: center; gap: 8px; min-width: 0; }
/* The agent's own mark, with its state as a small light on the corner. */
.av { position: relative; flex: none; width: 18px; height: 18px; }
.av .ico { width: 18px; height: 18px; }
.light { position: absolute; right: -3px; bottom: -3px; width: 8px; height: 8px; border-radius: 50%; background: var(--idle); box-shadow: 0 0 0 2px var(--card); }
.working .light { background: var(--working); }
.working .light::after { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 1.5px solid var(--working); opacity: 0; animation: ping 1.6s ease-out infinite; }
.blocked .light { background: var(--blocked); }
.blocked .light, .agent.blocked .light { box-shadow: 0 0 0 2px color-mix(in srgb, var(--blocked) 8%, var(--card)); }
.done .light { background: var(--done); }
.ended .light { background: var(--ended); }
.unknown .light { display: none; }
@keyframes ping { 0% { transform: scale(.6); opacity: .9; } 100% { transform: scale(1.4); opacity: 0; } }
.name { font-weight: 600; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.state { margin-left: auto; color: var(--muted); font-size: 11.5px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.blocked .state { color: var(--blocked); font-weight: 600; }
.unread .name::after { content: ''; display: inline-block; width: 6px; height: 6px; margin-left: 6px; border-radius: 50%; background: var(--done); vertical-align: middle; }
.prompt { margin: 5px 0 0 26px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--text); opacity: .86; }
.activity { margin: 4px 0 0 26px; color: var(--muted); font: 11.5px/1.35 var(--mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.blocked .activity { color: var(--blocked); }
.todos { display: flex; align-items: center; gap: 8px; margin: 7px 0 0 26px; }
.segs { display: flex; gap: 2px; flex: none; }
.seg { width: 10px; height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--idle) 30%, transparent); }
.seg.completed { background: var(--done); } .seg.in_progress { background: var(--working); }
.todos .now { min-width: 0; color: var(--muted); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.impact { margin: 6px 0 0 26px; color: var(--muted); font-size: 11.5px; line-height: 1.6; }
.impact b { color: var(--text); font-weight: 600; }
.impact .flow { display: inline-block; margin: 0 4px 2px 0; padding: 0 6px; border-radius: 5px; border: 1px solid var(--line); font: 11px/1.5 var(--mono); color: var(--text); cursor: pointer; }
.impact .flow:hover { background: var(--hover); }
.wt { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin: 6px 0 0 26px; color: var(--muted); font: 11px/1.5 var(--mono); }
.wt .br { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.wt .ab { font-variant-numeric: tabular-nums; }
.wt .act { padding: 0 6px; border: 1px solid var(--line); border-radius: 5px; color: var(--muted); font: 11px/1.5 var(--vscode-font-family, system-ui); cursor: pointer; }
.wt .act:hover { background: var(--hover); color: var(--text); }
.clash { margin: 6px 0 0 26px; padding: 4px 7px; border-radius: 6px; background: color-mix(in srgb, var(--blocked) 10%, transparent); color: var(--blocked); font-size: 11.5px; line-height: 1.45; }
.clash.same { background: color-mix(in srgb, #ff6b7d 12%, transparent); color: #ff8c99; }
.clash small { display: block; color: var(--muted); }
.todos .count { flex: none; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.ctx { position: absolute; left: 38px; right: 10px; bottom: 0; height: 2px; border-radius: 2px; background: transparent; overflow: hidden; }
.ctx i { display: block; height: 100%; background: color-mix(in srgb, var(--working) 55%, transparent); }
.ctx.warn i { background: var(--blocked); } .ctx.full i { background: #ff6b7d; }
/* How full the context window is: the model, used / window and the share, or only the tokens when the CLI gave no window. */
.ctxline { display: flex; align-items: center; gap: 6px; margin: 6px 0 0 26px; color: var(--muted); font: 11px/1.4 var(--mono); font-variant-numeric: tabular-nums; }
.ctxline .model { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ctxline .amt { flex: none; }
.ctxline.warn .pct { color: var(--blocked); } .ctxline.full .pct { color: #ff6b7d; font-weight: 600; }
.cmp { flex: none; margin-left: auto; padding: 0 6px; border: 1px solid var(--line); border-radius: 5px; color: var(--muted); font: 11px/1.5 var(--vscode-font-family, system-ui); cursor: pointer; }
.cmp:hover { background: var(--hover); color: var(--text); }
.x { position: absolute; top: 6px; right: 6px; display: none; width: 18px; height: 18px; border: 0; border-radius: 5px; background: transparent; color: var(--muted); cursor: pointer; font-size: 14px; line-height: 18px; }
.agent.ended:hover .x { display: block; }
.agent:hover .state { visibility: hidden; }
.x:hover, .ren:hover { background: var(--hover); color: var(--text); }
.ren { position: absolute; top: 6px; right: 6px; display: none; width: 18px; height: 18px; border-radius: 5px; color: var(--muted); cursor: pointer; font-size: 12px; line-height: 18px; text-align: center; }
.agent:hover .ren, .agent:focus-visible .ren { display: block; }
.agent.ended:hover .ren { right: 26px; }
.empty { margin: 4px 2px; color: var(--muted); line-height: 1.55; }
.empty b { color: var(--text); font-weight: 600; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 12px; color: var(--muted); font-size: 11.5px; }
.legend span { display: inline-flex; align-items: center; gap: 5px; }
.legend i { width: 7px; height: 7px; border-radius: 50%; }
.foot { margin-top: 14px; color: var(--muted); font-size: 11.5px; }
.foot button { all: unset; color: var(--vscode-textLink-foreground); cursor: pointer; }
@media (prefers-reduced-motion: reduce) { .working .light::after { animation: none; } }
</style></head><body>
<div class="new">
	<button data-cli="claude" title="Start Claude Code in a new terminal, or resume an earlier session">${ICON.claude}Claude</button>
	<button data-cli="codex" title="Start Codex in a new terminal, or resume an earlier session">${ICON.codex}Codex</button>
	<button class="more" data-cli="pick"title="Start another agent: Gemini, Aider, your own command…" aria-label="Start another agent">Other…</button>
</div>
<div id="list"></div>
<script>
const vscode = acquireVsCodeApi();
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let data = { list: [], now: Date.now() };
const ICONS = ${JSON.stringify(ICON)};
const icon = s => s.cli === 'custom' ? '<span class="ico custom tile">' + esc((s.command || s.name || '?').split(' ')[0].split('/').pop().charAt(0)) + '</span>' : ICONS[s.cli];
const ago = (t, now) => { const s = Math.max(0, Math.round((now - t) / 1000)); return s < 60 ? s + 's' : s < 3600 ? Math.floor(s / 60) + 'm' : Math.floor(s / 3600) + 'h'; };
const tok = n => n >= 1e6 ? +(n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M' : n >= 1000 ? (n / 1000).toFixed(n >= 1e5 ? 0 : 1) + 'k' : String(n);
const LABEL = { working: 'Working', blocked: 'Needs you', done: 'Done', idle: 'Ready', starting: 'Starting', unknown: 'Running', ended: 'Closed' };
function render() {
	const el = document.getElementById('list');
	if (!data.list.length) {
		el.innerHTML = '<p class="empty"><b>No agents running.</b><br>Start one above. It runs in a terminal like always; here you see at a glance which one is working, which one waits for you and which one is done.</p>'
			+ '<div class="legend"><span><i style="background:var(--working)"></i>Working</span><span><i style="background:var(--blocked)"></i>Needs you</span><span><i style="background:var(--done)"></i>Done</span></div>'
			+ '<p class="foot">Prefer the chat panel? <button id="chat">Turn it back on</button></p>';
		const c = document.getElementById('chat'); if (c) c.onclick = () => vscode.postMessage({ type: 'chat' });
		return;
	}
	el.innerHTML = data.list.map(s => {
		// Without a window size from the CLI there is no share to show: no bar, only the tokens in the tooltip.
		const sized = !!(s.usage && s.usage.size);
		const pct = sized ? Math.min(100, Math.round(s.usage.used / s.usage.size * 100)) : 0;
		const state = s.state === 'working' || s.state === 'blocked' ? LABEL[s.state] + ' · ' + ago(s.since, Date.now()) : s.state === 'done' ? 'Done ' + ago(s.since, Date.now()) + ' ago' : LABEL[s.state];
		const todos = s.todos.length ? '<div class="todos"><span class="segs">' + s.todos.slice(0, 12).map(t => '<span class="seg ' + esc(t.status) + '"></span>').join('') + '</span><span class="count">' + s.done + '/' + s.todos.length + '</span>' + (s.current ? '<span class="now">' + esc(s.current) + '</span>' : '') + '</div>' : '';
		const impact = s.impact && s.impact.flows.length ? '<div class="impact"><b>This turn touched ' + (s.impact.flows.length + s.impact.more) + (s.impact.flows.length + s.impact.more === 1 ? ' flow' : ' flows') + ':</b> ' + s.impact.flows.map((f, i) => '<span class="flow" role="button" tabindex="0" data-flow="' + i + '" title="' + esc((f.via && f.via.length ? 'Through ' + f.via.join(', ') + '. ' : '') + 'Open this flow') + '">' + esc(f.label) + '</span>').join('') + (s.impact.more ? '<span>+' + s.impact.more + ' more</span>' : '') + '</div>' : '';
		const w = s.worktree;
		const counts = w && w.ahead !== undefined ? '<span class="ab" title="' + esc('Commits ahead of / behind ' + w.base) + '">↑' + w.ahead + ' ↓' + w.behind + '</span>' : '';
		const dirty = w && w.uncommitted ? '<span title="Files changed and not committed in the worktree">' + w.uncommitted + ' uncommitted</span>' : '';
		const act = (a, label, tip) => '<span class="act" role="button" tabindex="0" data-wt="' + a + '" title="' + esc(tip) + '">' + label + '</span>';
		const wt = w ? '<div class="wt"><span class="br" title="' + esc('Worktree on ' + w.branch + ', from ' + w.base) + '">⎇ ' + esc(w.branch) + '</span>' + counts + dirty
			+ act('open', 'Open', 'Open the worktree folder') + act('diff', 'Changes', 'Show the changes of this branch since ' + w.base + ' in flow') + act('merge', 'Merge', 'Merge into ' + w.base + ' (asks first)') + act('remove', 'Remove', 'Remove the worktree folder (asks first; the branch stays)') + '</div>' : '';
		const clash = (s.clash || []).map(c => '<div class="clash' + (c.same ? ' same' : '') + '" title="' + esc(c.files.join(', ')) + '">⚠ ' + esc(c.text)
			+ (c.same ? '<small>Same checkout: each writes over the edits of the other. Start agents that work in parallel in a worktree (Other… → in a worktree).</small>' : '') + '</div>').join('');
		const level = pct >= 90 ? ' full' : pct >= 70 ? ' warn' : '';
		const canCompact = s.usage && s.state !== 'ended' && s.cli !== 'custom';
		const ctx = s.usage ? '<div class="ctxline' + level + '" title="' + esc(sized ? s.usage.used.toLocaleString() + ' of ' + s.usage.size.toLocaleString() + ' tokens in the context window' : s.usage.used.toLocaleString() + ' tokens in context; the agent has not said how large its window is') + '">'
			+ (s.usage.model ? '<span class="model">' + esc(s.usage.model) + '</span><span>·</span>' : '')
			+ '<span class="amt">' + (sized ? tok(s.usage.used) + ' / ' + tok(s.usage.size) + ' <span class="pct">' + pct + '%</span>' : tok(s.usage.used) + ' tokens') + '</span>'
			+ (canCompact ? '<span class="cmp" data-compact="' + esc(s.id) + '" role="button" title="Send /compact: keeps a summary, frees most of the window">Compact</span>' : '')
			+ '</div>' : '';
		return '<button class="agent ' + s.state + (s.unread ? ' unread' : '') + '" data-id="' + esc(s.id) + '" title="' + esc(s.name + (sized ? ' · context ' + pct + '% full' : '')) + '">'
			+ '<div class="top"><span class="av">' + icon(s) + '<span class="light"></span></span><span class="name">' + esc(s.name) + '</span><span class="state">' + esc(state) + '</span></div>'
			+ (s.prompt ? '<div class="prompt">' + esc(s.prompt) + '</div>' : '')
			+ (s.activity ? '<div class="activity">' + esc(s.activity) + '</div>' : '')
			+ todos
			+ clash
			+ impact
			+ wt
			+ ctx
			+ (sized ? '<div class="ctx' + level + '"><i style="width:' + pct + '%"></i></div>' : '')
			+ '<span class="ren" data-rename="' + esc(s.id) + '" title="Rename" role="button">✎</span>'
			+ (s.state === 'ended' ? '<span class="x"data-forget="' + esc(s.id) + '" title="Remove from list" role="button">×</span>' : '')
			+ '</button>';
	}).join('');
	el.querySelectorAll('.agent').forEach(b => b.onclick = e => {
		const f = e.target.closest('[data-forget]');
		const fl = e.target.closest('[data-flow]');
		const rn = e.target.closest('[data-rename]');
		const cp = e.target.closest('[data-compact]');
		const wa = e.target.closest('[data-wt]');
		vscode.postMessage(wa ? { type: 'wt', id: b.dataset.id, action: wa.dataset.wt } : cp ? { type: 'compact', id: cp.dataset.compact } : rn ? { type: 'rename', id: rn.dataset.rename } : f ? { type: 'forget', id: f.dataset.forget } : fl ? { type: 'flow', id: b.dataset.id, index: Number(fl.dataset.flow) } : { type: 'show', id: b.dataset.id });
	});
}
document.querySelectorAll('.new button').forEach(b => b.onclick = () => vscode.postMessage(b.dataset.cli === 'pick' ? { type: 'pick' } : { type: 'new', cli: b.dataset.cli }));
window.addEventListener('message', e => { if (e.data.type === 'data') { data = e.data; render(); } });
setInterval(() => data.list.some(s => s.state === 'working' || s.state === 'blocked' || s.state === 'done') && render(), 5000);
vscode.postMessage({ type: 'ready' });
</script></body></html>`;
	}
}
