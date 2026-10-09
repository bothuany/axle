/*---------------------------------------------------------------------------------------------
 *  Flow: agents in terminals. Claude Code and Codex run as their real CLIs, each in its own
 *  terminal; Flow only watches. Claude reports through hooks that Flow hands to that one
 *  session with --settings (the user's own settings and hooks are untouched and still run), so
 *  every agent shows whether it is working, waiting for you or done, what it is doing, its to-do
 *  list and how full its context is. The hooks never answer a permission question: the CLI asks.
 *--------------------------------------------------------------------------------------------*/

import { createHash, randomBytes, randomUUID } from 'crypto';
import { promises as fs, watch, type FSWatcher } from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

/** claude reports through hooks; codex and custom CLIs are plain terminals Flow only lists. */
export type AgentCli = 'claude' | 'codex' | 'custom';
/** working: busy · blocked: waiting for you · done: finished a turn · idle: started, no prompt yet · unknown: no reports (Codex) · ended: the CLI exited. */
export type AgentState = 'starting' | 'working' | 'blocked' | 'done' | 'idle' | 'unknown' | 'ended';

export interface Todo {
	text: string;
	status: 'pending' | 'in_progress' | 'completed';
	/** Task id, for the Task tools that update one item at a time. */
	key?: string;
}

export interface AgentSession {
	id: string;
	cli: AgentCli;
	name: string;
	state: AgentState;
	since: number;
	prompt?: string;
	/** What it is doing right now, or what it waits for. */
	activity?: string;
	todos: Todo[];
	usage?: { used: number; size: number };
	/** Finished or blocked while you were looking elsewhere. */
	unread: boolean;
	pid?: number;
	transcript?: string;
	/** What a custom agent runs, e.g. `gemini` or `aider --model sonnet`. */
	command?: string;
}

export interface CustomAgent {
	name: string;
	command: string;
}

interface Saved {
	token: string;
	sessions: Pick<AgentSession, 'id' | 'cli' | 'name' | 'pid' | 'prompt' | 'transcript' | 'command'>[];
}

interface HookPayload {
	session_id?: string;
	hook_event_name?: string;
	transcript_path?: string;
	prompt?: string;
	tool_name?: string;
	tool_input?: Record<string, unknown>;
	tool_response?: Record<string, unknown>;
	notification_type?: string;
	message?: string;
}

const AGENT = 'Claude Code (terminal)';
const EDIT_TOOLS = 'Edit|Write|MultiEdit|NotebookEdit';
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'];

const KIND: Record<string, string> = { Bash: 'execute', Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Read: 'read', Grep: 'search', Glob: 'search', WebFetch: 'fetch', WebSearch: 'fetch' };

/** One line for what a tool call is about: the command, the file, the pattern. */
function describe(tool: string, input: Record<string, unknown> = {}) {
	const file = typeof input.file_path === 'string' ? path.basename(input.file_path) : typeof input.notebook_path === 'string' ? path.basename(input.notebook_path) : undefined;
	const detail = typeof input.command === 'string' ? input.command
		: file ?? (typeof input.pattern === 'string' ? input.pattern : typeof input.url === 'string' ? input.url : typeof input.description === 'string' ? input.description : '');
	const verb: Record<string, string> = { Bash: 'Running', Edit: 'Editing', MultiEdit: 'Editing', Write: 'Writing', NotebookEdit: 'Editing', Read: 'Reading', Grep: 'Searching', Glob: 'Finding', WebFetch: 'Fetching', WebSearch: 'Searching the web', Task: 'Delegating', Agent: 'Delegating' };
	const head = verb[tool] ?? tool.replace(/^mcp__([\w-]+)__/, '$1 ');
	return detail ? `${head} ${String(detail).split('\n')[0].slice(0, 120)}` : head;
}

function filesOf(input: Record<string, unknown> = {}) {
	const f = input.file_path ?? input.notebook_path;
	return typeof f === 'string' ? [f] : [];
}

/**
 * When Flow itself was started from inside a Claude Code session, its environment carries that
 * session's variables (child-session flags, host proxy, disabled transcripts). A fresh agent must
 * not inherit them: null removes a variable from the terminal.
 */
function inheritedAgentEnv() {
	const env: Record<string, null> = {};
	const hosted = !!process.env.CLAUDE_CODE_HOST_SESSION_ID || !!process.env.CLAUDECODE;
	for (const k of Object.keys(process.env)) {
		if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_PREVIEW_)/.test(k) || (hosted && k === 'ANTHROPIC_BASE_URL')) {
			env[k] = null;
		}
	}
	return env;
}

/** Reads the event from stdin and posts it to the Flow window that owns this folder now. Never blocks the agent. */
function HOOK_SCRIPT(portFile: string, tokenFile: string) {
	return `// Written by Flow: forwards Claude Code hook events to the Flow window (observe only).
const fs = require('fs'), http = require('http');
let body = '';
process.stdin.on('data', d => body += d).on('end', () => {
	let port, token;
	try { port = fs.readFileSync(${JSON.stringify(portFile)}, 'utf8').trim(); token = fs.readFileSync(${JSON.stringify(tokenFile)}, 'utf8').trim(); } catch { process.exit(0); }
	if (!port) process.exit(0);
	const req = http.request({ host: '127.0.0.1', port, path: '/hook', method: 'POST', timeout: 3000, headers: { 'Content-Type': 'application/json', 'X-Flow-Token': token } }, res => { res.resume(); res.on('end', () => process.exit(0)); });
	req.on('error', () => process.exit(0)).on('timeout', () => { req.destroy(); process.exit(0); });
	req.end(body);
});
setTimeout(() => process.exit(0), 4000);
`;
}

/** Where Claude Code keeps a session's transcript: the cwd with every non-alphanumeric turned into '-'. */
function transcriptPath(id: string, cwd: string | undefined) {
	const config = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
	return path.join(config, 'projects', (cwd ?? '').replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`);
}

export class Agents implements vscode.Disposable {
	readonly sessions = new Map<string, AgentSession>();
	private readonly terminals = new Map<string, vscode.Terminal>();
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;
	private server: http.Server | undefined;
	private port = 0;
	private token = '';
	private dir = '';
	private readonly watchers = new Map<string, FSWatcher>();
	/** Permission questions still open, so the answer can be recorded when the tool runs (or does not). */
	private readonly asked = new Map<string, { tool: string; input: Record<string, unknown>; at: number }>();
	private readonly disposables: vscode.Disposable[] = [];
	/** Agents from before a reload, waiting for their terminal to come back. */
	private readonly orphans = new Map<number, Saved['sessions'][number]>();

	constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.LogOutputChannel) {
		this.disposables.push(
			vscode.window.onDidCloseTerminal(t => this.closed(t)),
			vscode.window.onDidChangeActiveTerminal(t => this.seen(t)),
			vscode.window.onDidChangeTerminalState(t => t.state.isInteractedWith && this.seen(t)),
		);
	}

	async start() {
		// Keyed by folder, not by window: a reloaded window can get a fresh storageUri while the old
		// extension host lingers, and the agents' hook settings must find the newest window either way.
		const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'empty';
		this.dir = path.join(this.context.globalStorageUri.fsPath, 'agents', createHash('sha1').update(folder).digest('hex').slice(0, 12));
		const saved = await fs.readFile(path.join(this.dir, 'sessions.json'), 'utf8').then(t => JSON.parse(t) as Saved).catch(() => undefined);
		this.token = saved?.token ?? randomBytes(16).toString('hex');
		try {
			await this.listen();
		} catch (e) {
			this.log.warn(`Agents: no port for hooks; agents run without status (${(e as Error).message})`);
		}
		await this.writeSettings();
		await this.revive(saved);
		this.save();
	}

	private listen() {
		return new Promise<void>((resolve, reject) => {
			const server = http.createServer((req, res) => this.request(req, res));
			server.once('error', reject);
			server.listen(0, '127.0.0.1', () => {
				this.server = server;
				this.port = (server.address() as { port: number }).port;
				resolve();
			});
		});
	}

	private get settingsFile() {
		return path.join(this.dir, 'agent-hooks.json');
	}

	/**
	 * The hooks a Flow agent gets on top of the user's own: read-only observers that print nothing,
	 * so they never decide anything. Each one posts the event to whichever Flow window holds this
	 * workspace now: the port is read from a file at call time, because after a window reload the
	 * old extension host can linger on the old port while the agent keeps running.
	 */
	private async writeSettings() {
		await fs.mkdir(this.dir, { recursive: true });
		const portFile = path.join(this.dir, 'hook-port');
		const tokenFile = path.join(this.dir, 'hook-token');
		await fs.writeFile(tokenFile, this.token, { mode: 0o600 });
		await fs.writeFile(portFile, this.server ? String(this.port) : '', { mode: 0o600 });
		// A tiny Node script, run with the editor's own Node: the same on macOS, Linux and Windows.
		const script = path.join(this.dir, 'flow-hook.js');
		await fs.writeFile(script, HOOK_SCRIPT(portFile, tokenFile));
		const command = `"${process.execPath}" "${script}"`;
		const hook = { type: 'command', command, timeout: 5 };
		const hooks: Record<string, unknown[]> = {};
		for (const e of HOOK_EVENTS) {
			const matcher = e === 'PreToolUse' ? EDIT_TOOLS : e === 'PostToolUse' || e === 'PermissionRequest' ? '*' : undefined;
			hooks[e] = [{ ...(matcher ? { matcher } : {}), hooks: [hook] }];
		}
		await fs.writeFile(this.settingsFile, JSON.stringify({ hooks }, null, 2), { mode: 0o600 });
	}

	/** Terminals outlive a window reload; find ours again by their process (they may reattach after we start). */
	private async revive(saved: Saved | undefined) {
		for (const s of saved?.sessions ?? []) {
			try {
				process.kill(s.pid!, 0); // still running?
				this.orphans.set(s.pid!, s);
			} catch {
				// Its terminal is gone (Flow quit, or it was closed). A Claude conversation can be
				// picked up again with --resume, so it stays listed; other CLIs are dropped.
				if (s.cli === 'claude' && !this.sessions.has(s.id)) {
					const session: AgentSession = { ...s, pid: undefined, state: 'ended', since: Date.now(), todos: [], unread: false, activity: 'Closed · click to resume' };
					this.sessions.set(s.id, session);
					void this.readTitle(session, true);
				}
			}
		}
		this.disposables.push(vscode.window.onDidOpenTerminal(t => void this.adopt(t)));
		await Promise.all(vscode.window.terminals.map(t => this.adopt(t)));
	}

	private async adopt(t: vscode.Terminal) {
		const pid = await t.processId;
		const s = pid ? this.orphans.get(pid) : undefined;
		if (!s || this.sessions.has(s.id)) {
			return;
		}
		this.orphans.delete(pid!);
		const session: AgentSession = { ...s, state: s.cli === 'claude' ? 'idle' : 'unknown', since: Date.now(), todos: [], unread: false };
		this.sessions.set(s.id, session);
		this.terminals.set(s.id, t);
		this.log.info(`Agents: reattached ${s.name}`);
		void this.readUsage(session);
		void this.readTitle(session, true);
		this.watchTranscript(session);
		this.changed.fire();
	}

	private save() {
		const saved: Saved = {
			token: this.token,
			sessions: [...[...this.sessions.values()].map(({ id, cli, name, pid, prompt, transcript, command }) => ({ id, cli, name, pid, prompt, transcript, command })), ...this.orphans.values()],
		};
		void fs.writeFile(path.join(this.dir, 'sessions.json'), JSON.stringify(saved), { mode: 0o600 }).catch(() => undefined);
	}

	/** Starts a CLI in a new terminal. Claude gets a session id we chose, so every hook maps to its terminal. */
	async spawn(cli: AgentCli, resume?: AgentSession, custom?: CustomAgent) {
		const id = resume?.id ?? randomUUID();
		const base = cli === 'claude' ? 'Claude' : cli === 'codex' ? 'Codex' : custom?.name ?? 'Agent';
		const same = [...this.sessions.values()].filter(s => s.state !== 'ended' && (s.cli === 'custom' ? s.command === custom?.command : s.cli === cli)).length;
		const name = resume?.name ?? base + (same ? ` ${same + 1}` : '');
		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const terminal = vscode.window.createTerminal({
			name,
			cwd,
			iconPath: new vscode.ThemeIcon(cli === 'claude' ? 'sparkle' : cli === 'codex' ? 'hubot' : 'terminal'),
			color: new vscode.ThemeColor(cli === 'claude' ? 'terminal.ansiYellow' : cli === 'codex' ? 'terminal.ansiCyan' : 'terminal.ansiMagenta'),
			env: { ...inheritedAgentEnv(), FLOW_AGENT_SESSION: id },
			isTransient: false,
		});
		// Double quotes work in bash, zsh, PowerShell and cmd alike.
		const quote = (x: string) => `"${x}"`;
		const command = cli === 'claude'
			? `claude ${resume ? '--resume' : '--session-id'} ${id}${this.server ? ` --settings ${quote(this.settingsFile)}` : ''}`
			: cli === 'codex' ? 'codex' : resume?.command ?? custom?.command ?? '';
		terminal.show();
		terminal.sendText(command);
		const session: AgentSession = {
			id, cli, name, state: cli === 'claude' ? 'starting' : 'unknown', since: Date.now(), todos: [], unread: false,
			prompt: resume?.prompt, command: cli === 'custom' ? command : undefined,
			transcript: cli === 'claude' ? resume?.transcript ?? transcriptPath(id, cwd) : undefined,
		};
		this.sessions.set(id, session);
		this.terminals.set(id, terminal);
		this.watchTranscript(session);
		// If SessionStart does not reach us (no Node on the hook path, slow boot), call it ready once it had time to start.
		setTimeout(() => {
			if (session.state === 'starting') {
				session.state = 'idle';
				this.changed.fire();
			}
		}, 8000);
		session.pid = await terminal.processId;
		this.save();
		this.changed.fire();
		return session;
	}

	show(id: string) {
		const t = this.terminals.get(id);
		const s = this.sessions.get(id);
		if (t) {
			t.show();
		} else if (s) {
			void this.spawn(s.cli, s);
			return;
		}
		if (s) {
			s.unread = false;
			this.changed.fire();
		}
	}

	/** Removes a finished agent from the list (its terminal, if any, closes too). */
	forget(id: string) {
		this.terminals.get(id)?.dispose();
		this.terminals.delete(id);
		this.sessions.delete(id);
		this.unwatch(id);
		this.save();
		this.changed.fire();
	}

	get needsYou() {
		return [...this.sessions.values()].filter(s => s.state === 'blocked' || (s.state === 'done' && s.unread)).length;
	}

	private seen(t: vscode.Terminal | undefined) {
		for (const [id, term] of this.terminals) {
			const s = this.sessions.get(id);
			if (term === t && s?.unread && s.state !== 'blocked') {
				s.unread = false;
				this.changed.fire();
			}
		}
	}

	private closed(t: vscode.Terminal) {
		for (const [id, term] of this.terminals) {
			if (term === t) {
				this.terminals.delete(id);
				const s = this.sessions.get(id);
				if (s) {
					s.state = 'ended';
					s.activity = s.cli === 'claude' ? 'Closed · click to resume' : undefined;
					s.since = Date.now();
				}
				this.unwatch(id);
				// No save here: a window being reloaded closes its terminals too (they live on in the
				// next window), and saving now would wipe them from the list. A terminal that really
				// closed is dropped on the next start, because its process is gone.
				this.changed.fire();
			}
		}
	}

	private request(req: http.IncomingMessage, res: http.ServerResponse) {
		const reply = (status: number) => {
			res.statusCode = status;
			res.setHeader('content-type', 'application/json');
			res.end('{}'); // never a decision: the CLI keeps asking the user itself
		};
		if (req.method !== 'POST' || req.url !== '/hook' || req.headers['x-flow-token'] !== this.token) {
			req.resume();
			return reply(403);
		}
		let body = '';
		req.on('data', d => {
			body += d;
			if (body.length > 4_000_000) {
				req.destroy();
			}
		});
		req.on('end', async () => {
			try {
				await this.hook(JSON.parse(body) as HookPayload);
			} catch (e) {
				this.log.warn(`Agents: hook failed: ${(e as Error).message}`);
			}
			reply(200);
		});
	}

	private async hook(p: HookPayload) {
		const s = p.session_id ? this.sessions.get(p.session_id) : undefined;
		if (!s) {
			return; // a session Flow did not start (or forgot): stay out of it
		}
		if (p.transcript_path && p.transcript_path !== s.transcript) {
			s.transcript = p.transcript_path;
			this.unwatch(s.id);
			this.watchTranscript(s);
		}
		const was = s.state;
		const set = (state: AgentState, activity?: string) => {
			if (state !== s.state) {
				s.since = Date.now();
			}
			s.state = state;
			s.activity = activity;
		};
		const tool = p.tool_name ?? '';
		switch (p.hook_event_name) {
			case 'SessionStart':
				if (s.state === 'starting') {
					set(s.prompt ? 'done' : 'idle');
				}
				break;
			case 'UserPromptSubmit':
				this.settleAsked(s, 'denied');
				s.prompt = p.prompt?.trim().slice(0, 400);
				s.todos = [];
				set('working', 'Thinking');
				await Promise.resolve(vscode.commands.executeCommand('flow.agentTurn', s.prompt ?? 'Prompt', AGENT)).catch(() => undefined);
				break;
			case 'PreToolUse':
				// Only edits come here: remember the files as they are, for the timeline and Undo.
				await Promise.resolve(vscode.commands.executeCommand('flow.agentWillEdit', filesOf(p.tool_input))).catch(() => undefined);
				break;
			case 'PermissionRequest':
				this.asked.set(s.id, { tool, input: p.tool_input ?? {}, at: Date.now() });
				set('blocked', `Wants to: ${describe(tool, p.tool_input)}`);
				break;
			case 'PostToolUse': {
				this.settleAsked(s, 'allowed');
				set('working', describe(tool, p.tool_input));
				if (EDIT_TOOLS.split('|').includes(tool)) {
					void Promise.resolve(vscode.commands.executeCommand('flow.agentDidEdit', filesOf(p.tool_input))).catch(() => undefined);
				}
				this.todos(s, tool, p.tool_input ?? {}, p.tool_response ?? {});
				void this.readUsage(s);
				break;
			}
			case 'Notification':
				if (p.notification_type === 'permission_prompt' || /permission/i.test(p.message ?? '')) {
					if (s.state !== 'blocked') {
						set('blocked', p.message);
					}
				} else if (p.notification_type === 'idle_prompt' && s.state !== 'done') {
					set('done', undefined);
				}
				break;
			case 'Stop':
				this.settleAsked(s, 'denied');
				set('done', undefined);
				void this.readUsage(s);
				break;
			case 'SessionEnd':
				set('ended', undefined);
				break;
		}
		const active = vscode.window.activeTerminal === this.terminals.get(s.id) && vscode.window.state.focused;
		if ((s.state === 'blocked' || s.state === 'done') && was !== s.state && !active) {
			s.unread = true;
		}
		if (s.state === 'working') {
			s.unread = false;
		}
		this.save();
		this.changed.fire();
	}

	/** The question was answered: the tool ran (allowed) or the turn moved on without it (denied). */
	private settleAsked(s: AgentSession, decision: 'allowed' | 'denied') {
		const q = this.asked.get(s.id);
		if (!q) {
			return;
		}
		this.asked.delete(s.id);
		void Promise.resolve(vscode.commands.executeCommand('flowHarness.recordPermission', {
			at: q.at,
			agent: AGENT,
			kind: KIND[q.tool] ?? (q.tool.startsWith('mcp__') ? 'other' : undefined),
			title: q.tool.startsWith('mcp__') ? q.tool : describe(q.tool, q.input),
			files: filesOf(q.input),
			rawInput: q.input,
			decision,
		})).catch(() => undefined);
	}

	/** TodoWrite replaces the list; the Task tools add and update one item at a time. */
	private todos(s: AgentSession, tool: string, input: Record<string, unknown>, response: Record<string, unknown>) {
		if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
			s.todos = (input.todos as { content?: string; activeForm?: string; status?: Todo['status'] }[])
				.map(t => ({ text: (t.status === 'in_progress' ? t.activeForm : t.content) ?? t.content ?? '', status: t.status ?? 'pending' }));
		} else if (tool === 'TaskCreate') {
			const task = (response.task ?? response) as { id?: string | number };
			s.todos.push({ text: String(input.subject ?? input.description ?? 'Task'), status: 'pending', key: String(task.id ?? s.todos.length + 1) });
		} else if (tool === 'TaskUpdate') {
			const key = String(input.taskId ?? input.id ?? '');
			const t = s.todos.find(x => x.key === key);
			if (t && typeof input.status === 'string') {
				t.status = input.status === 'completed' ? 'completed' : input.status === 'in_progress' ? 'in_progress' : 'pending';
			}
		}
	}

	/**
	 * The transcript tells what no hook does: a /rename (a `custom-title` line), and a "no" to a
	 * permission question. Watch its folder, since the file only appears with the first message.
	 */
	private watchTranscript(s: AgentSession) {
		if (s.cli !== 'claude' || !s.transcript || this.watchers.has(s.id)) {
			return;
		}
		const dir = path.dirname(s.transcript);
		const file = path.basename(s.transcript);
		let timer: NodeJS.Timeout | undefined;
		void fs.mkdir(dir, { recursive: true }).then(() => {
			if (this.watchers.has(s.id) || !this.sessions.has(s.id)) {
				return;
			}
			try {
				const w = watch(dir, (_e, name) => {
					if (name && name !== file) {
						return;
					}
					clearTimeout(timer);
					timer = setTimeout(() => {
						void this.readTitle(s);
						void this.checkRefusal(s);
					}, 250);
				});
				this.watchers.set(s.id, w);
			} catch {
				// no folder: no rename tracking
			}
		}).catch(() => undefined);
	}

	/** Picks up /rename: the newest custom title in the transcript becomes the agent's name. */
	private async readTitle(s: AgentSession, whole = false) {
		if (!s.transcript) {
			return;
		}
		const lines = whole
			? (await fs.readFile(s.transcript, 'utf8').catch(() => '')).split('\n')
			: await this.tail(s.transcript, 16384).catch(() => [] as string[]);
		for (let i = lines.length - 1; i >= 0; i--) {
			if (!lines[i].includes('"custom-title"')) {
				continue;
			}
			try {
				const title = (JSON.parse(lines[i]) as { customTitle?: string }).customTitle?.trim();
				if (title && title !== s.name) {
					s.name = title;
					this.save();
					this.changed.fire();
				}
			} catch {
				// partial line
			}
			return;
		}
	}

	private unwatch(id: string) {
		this.watchers.get(id)?.close();
		this.watchers.delete(id);
	}

	private async tail(file: string, bytes = 65536) {
		const h = await fs.open(file, 'r');
		try {
			const { size } = await h.stat();
			const start = Math.max(0, size - bytes);
			const buf = Buffer.alloc(size - start);
			await h.read(buf, 0, buf.length, start);
			return buf.toString('utf8').split('\n').slice(start ? 1 : 0).filter(Boolean);
		} finally {
			await h.close();
		}
	}

	private async checkRefusal(s: AgentSession) {
		if (s.state !== 'blocked' || !s.transcript) {
			return;
		}
		const lines = await this.tail(s.transcript, 16384).catch(() => [] as string[]);
		const last = lines.slice(-3).join('\n');
		if (/doesn't want to proceed|Request interrupted by user|tool use was rejected/i.test(last)) {
			this.settleAsked(s, 'denied');
			s.state = 'done';
			s.activity = 'You said no';
			s.since = Date.now();
			this.save();
			this.changed.fire();
		}
	}

	/** Context in use: the last assistant message's input side (fresh + cached tokens). */
	private async readUsage(s: AgentSession) {
		if (!s.transcript) {
			return;
		}
		const lines = await this.tail(s.transcript).catch(() => [] as string[]);
		for (let i = lines.length - 1; i >= 0; i--) {
			let entry: { type?: string; message?: { model?: string; usage?: Record<string, number> } };
			try {
				entry = JSON.parse(lines[i]);
			} catch {
				continue;
			}
			const u = entry.type === 'assistant' ? entry.message?.usage : undefined;
			if (u) {
				const used = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
				const size = used > 200_000 || /\[1m\]/.test(entry.message?.model ?? '') ? 1_000_000 : 200_000;
				s.usage = { used, size };
				void Promise.resolve(vscode.commands.executeCommand('flowHarness.reportUsage', { agent: s.name, used, size })).catch(() => undefined);
				this.changed.fire();
				return;
			}
		}
	}

	dispose() {
		this.server?.close();
		this.watchers.forEach(w => w.close());
		this.changed.dispose();
		this.disposables.forEach(d => d.dispose());
	}
}
