/*---------------------------------------------------------------------------------------------
 *  Axle: agents in terminals. Claude Code and Codex run as their real CLIs, each in its own
 *  terminal; Axle only watches. Claude reports through hooks that Axle hands to that one
 *  session with --settings (the user's own settings and hooks are untouched and still run), so
 *  every agent shows whether it is working, waiting for you or done, what it is doing, its to-do
 *  list and how full its context is. The hooks never answer a permission question: the CLI asks.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { existsSync, promises as fs, readFileSync, watch, writeFileSync, type FSWatcher } from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CODEX_HOOK_SCRIPT, CODEX_PROFILE, codexHookCommand, codexProfile, codexProfileFile } from './codexHooks';
import { agentProcessEnv, inheritedAgentEnv } from './env';
import { parsePatch, patchFiles, patchText } from './patch';
import { shimScript } from './shim';

/** claude and codex report through hooks (codex once its hooks are trusted); custom CLIs are plain terminals Axle only lists. */
export type AgentCli = 'claude' | 'codex' | 'custom';
/** working: busy · blocked: waiting for you · done: finished a turn · idle: started, no prompt yet · unknown: no reports (custom CLIs, untrusted Codex hooks) · ended: the CLI exited. */
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
	/** The flows the files edited in the last turn reach, worked out when the turn ended. */
	impact?: TurnImpact;
	/** Codex picks its own session id: learned from its first hook, it is what `codex resume` takes. */
	agentId?: string;
}

/** What flow-view answers to `flow.agent.turnImpact`. */
export interface TurnImpact {
	files: number;
	/** `via`: the changed methods the flow goes through, when the edits could be placed in methods. */
	flows: { id: string; label: string; name: string; source: 'roslyn' | 'poly'; via?: string[] }[];
	more: number;
	note?: string;
}

export interface CustomAgent {
	name: string;
	command: string;
}

interface Saved {
	token: string;
	sessions: Pick<AgentSession, 'id' | 'cli' | 'name' | 'pid' | 'prompt' | 'transcript' | 'command' | 'agentId'>[];
}

interface HookPayload {
	session_id?: string;
	cwd?: string;
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
const agentLabel = (s: AgentSession) => s.cli === 'codex' ? 'Codex (terminal)' : AGENT;
const EDIT_TOOLS = 'Edit|Write|MultiEdit|NotebookEdit';
/** Codex reports every file edit as this one tool, the patch in `tool_input.command` (see patch.ts). */
const PATCH_TOOL = 'apply_patch';
/** PreToolUse also sees the plan an agent proposes when it leaves plan mode (tool_input.plan, injected by Claude Code). */
const PRE_TOOLS = `${EDIT_TOOLS}|ExitPlanMode`;
/** The most files of one turn that are checked for the flows they affect. */
const MAX_TOUCHED = 40;
/** The turn-end impact may take this long: Roslyn answers one request at a time. */
const IMPACT_WAIT_MS = 9000;
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Notification', 'Stop', 'SessionEnd'];
/** Agents that never come back to a reloaded window (their terminal is gone) are dropped after this. */
const ORPHAN_TTL_MS = 90_000;
/** The most a hook may wait for Axle to snapshot a file: the edit must not stall on it. */
const SNAPSHOT_WAIT_MS = 2500;

const KIND: Record<string, string> = { Bash: 'execute', Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Read: 'read', Grep: 'search', Glob: 'search', WebFetch: 'fetch', WebSearch: 'fetch', [PATCH_TOOL]: 'edit' };

/** One line for what a tool call is about: the command, the file, the pattern. */
function describe(tool: string, input: Record<string, unknown> = {}) {
	if (tool === PATCH_TOOL) {
		const files = parsePatch(patchText(input)).map(o => path.basename(o.file));
		return files.length ? `Editing ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` +${files.length - 3}` : ''}` : 'Editing';
	}
	const file = typeof input.file_path === 'string' ? path.basename(input.file_path) : typeof input.notebook_path === 'string' ? path.basename(input.notebook_path) : undefined;
	const detail = typeof input.command === 'string' ? input.command
		: file ?? (typeof input.pattern === 'string' ? input.pattern : typeof input.url === 'string' ? input.url : typeof input.description === 'string' ? input.description : '');
	const verb: Record<string, string> = { Bash: 'Running', Edit: 'Editing', MultiEdit: 'Editing', Write: 'Writing', NotebookEdit: 'Editing', Read: 'Reading', Grep: 'Searching', Glob: 'Finding', WebFetch: 'Fetching', WebSearch: 'Searching the web', Task: 'Delegating', Agent: 'Delegating' };
	const head = verb[tool] ?? tool.replace(/^mcp__([\w-]+)__/, '$1 ');
	return detail ? `${head} ${String(detail).split('\n')[0].slice(0, 120)}` : head;
}

/** The files a tool call writes. `cwd` resolves the relative paths of a Codex patch. */
function filesOf(tool: string, input: Record<string, unknown> = {}, cwd?: string) {
	if (tool === PATCH_TOOL) {
		return patchFiles(input, cwd);
	}
	const f = input.file_path ?? input.notebook_path;
	return typeof f === 'string' ? [f] : [];
}

const isEdit = (tool: string) => tool === PATCH_TOOL || EDIT_TOOLS.split('|').includes(tool);

/** Resolves with undefined once `ms` have passed, whatever `p` is doing. */
function bounded<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
	let timer: NodeJS.Timeout | undefined;
	return Promise.race([p, new Promise<undefined>(r => timer = setTimeout(() => r(undefined), ms))]).finally(() => clearTimeout(timer));
}

/** sessions.json is plain text on disk: take only what has the right shape, so a damaged file cannot throw at startup. */
function parseSaved(raw: unknown): Saved | undefined {
	const o = raw as { token?: unknown; sessions?: unknown } | null;
	if (!o || typeof o !== 'object') {
		return undefined;
	}
	const str = (v: unknown) => typeof v === 'string' ? v : undefined;
	const sessions: Saved['sessions'] = [];
	for (const e of Array.isArray(o.sessions) ? o.sessions as Record<string, unknown>[] : []) {
		if (e && typeof e === 'object' && typeof e.id === 'string' && (e.cli === 'claude' || e.cli === 'codex' || e.cli === 'custom')) {
			sessions.push({ id: e.id, cli: e.cli, name: str(e.name) ?? e.id, pid: typeof e.pid === 'number' ? e.pid : undefined, prompt: str(e.prompt), transcript: str(e.transcript), command: str(e.command), agentId: str(e.agentId) });
		}
	}
	return { token: str(o.token) ?? '', sessions };
}

/** The newest /rename in these transcript lines. */
function lastTitle(lines: string[]): string | undefined {
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i].includes('"custom-title"')) {
			try {
				const title = (JSON.parse(lines[i]) as { customTitle?: string }).customTitle?.trim();
				if (title) {
					return title;
				}
			} catch {
				// partial line
			}
		}
	}
	return undefined;
}

/** Reads the event from stdin and posts it to the Axle window that owns this folder now. Never blocks the agent. */
function HOOK_SCRIPT(portFile: string, tokenFile: string) {
	return `// Written by Axle: forwards Claude Code hook events to the Axle window (observe only).
const fs = require('fs'), http = require('http');
let body = '';
process.stdin.on('data', d => body += d).on('end', () => {
	let port, token;
	try { port = fs.readFileSync(${JSON.stringify(portFile)}, 'utf8').trim(); token = fs.readFileSync(${JSON.stringify(tokenFile)}, 'utf8').trim(); } catch { process.exit(0); }
	if (!port) process.exit(0);
	const req = http.request({ host: '127.0.0.1', port, path: '/hook', method: 'POST', timeout: 3000, headers: { 'Content-Type': 'application/json', 'X-Flow-Token': token, 'X-Flow-Agent': process.env.FLOW_AGENT_SESSION || '' } }, res => { res.resume(); res.on('end', () => process.exit(0)); });
	req.on('error', () => process.exit(0)).on('timeout', () => { req.destroy(); process.exit(0); });
	req.end(body);
});
setTimeout(() => process.exit(0), 4000);
`;
}

/** Where Claude Code keeps a session's transcript: the cwd with every non-alphanumeric turned into '-'. */
export function projectDir(cwd: string | undefined) {
	const config = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
	return path.join(config, 'projects', (cwd ?? '').replace(/[^a-zA-Z0-9]/g, '-'));
}

function transcriptPath(id: string, cwd: string | undefined) {
	return path.join(projectDir(cwd), `${id}.jsonl`);
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
	/** Debounce of the transcript watcher, per session. */
	private readonly titleTimers = new Map<string, NodeJS.Timeout>();
	/** Permission questions still open, so the answer can be recorded when the tool runs (or does not). */
	private readonly asked = new Map<string, { tool: string; input: Record<string, unknown>; cwd?: string; at: number }>();
	private readonly disposables: vscode.Disposable[] = [];
	/** Agents from before a reload, waiting for their terminal to come back. */
	private readonly orphans = new Map<number, Saved['sessions'][number]>();
	private orphanTimer: NodeJS.Timeout | undefined;
	/** Claude session ids that continue a Axle agent after /clear or /resume gave the conversation a new one. */
	private readonly aliases = new Map<string, string>();
	/** Set once start() has run: spawn waits on it so an agent never starts before the hook settings exist. */
	private ready: Promise<void> | undefined;
	private settingsOk = false;
	/** Whether Codex can take Axle's profile (`-p axle`): settled on the first Codex start of this window. */
	private codexHooks: Promise<boolean> | undefined;
	/** Files an agent edited since its last prompt, for the turn-end impact. */
	private readonly touched = new Map<string, Set<string>>();
	/** Sessions whose plan was drawn from PreToolUse this turn, so PostToolUse does not draw it twice. */
	private readonly planDrawn = new Set<string>();

	constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.LogOutputChannel) {
		this.disposables.push(
			vscode.window.onDidCloseTerminal(t => this.closed(t)),
			vscode.window.onDidChangeActiveTerminal(t => this.seen(t)),
			vscode.window.onDidChangeTerminalState(t => t.state.isInteractedWith && this.seen(t)),
			// An untrusted workspace starts nothing; trusting it later starts the hook server and brings the agents back.
			vscode.workspace.onDidGrantWorkspaceTrust(() => void this.start()),
		);
	}

	/** Safe to call again: the work happens once. Does nothing in an untrusted workspace until it is trusted. */
	start(): Promise<void> {
		if (!vscode.workspace.isTrusted) {
			this.log.info('Agents: workspace not trusted; agents stay off');
			return Promise.resolve();
		}
		this.ready ??= this.init().catch(e => this.log.error(`Agents: start failed: ${(e as Error).message}`));
		return this.ready;
	}

	private async init() {
		// Keyed by folder, not by window: a reloaded window can get a fresh storageUri while the old
		// extension host lingers, and the agents' hook settings must find the newest window either way.
		// A window without a folder has nothing to key on, and two of them would take each other's hook port
		// and agent list: it gets a directory of its own (its agents are not picked up again after a reload).
		const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const key = folder ?? `empty:${vscode.env.sessionId}:${process.pid}`;
		this.dir = path.join(this.context.globalStorageUri.fsPath, 'agents', (folder ? '' : 'empty-') + createHash('sha1').update(key).digest('hex').slice(0, 12));
		const saved = await fs.readFile(path.join(this.dir, 'sessions.json'), 'utf8').then(t => parseSaved(JSON.parse(t))).catch(() => undefined);
		this.token = saved?.token || randomBytes(16).toString('hex');
		try {
			await this.listen();
		} catch (e) {
			this.log.warn(`Agents: no port for hooks; agents run without status (${(e as Error).message})`);
		}
		try {
			await this.writeSettings();
			this.settingsOk = true;
		} catch (e) {
			this.log.warn(`Agents: could not write the hook settings; agents run without status (${(e as Error).message})`);
		}
		await this.installShim().catch(e => this.log.warn(`Agents: no claude shim (${(e as Error).message})`));
		await this.revive(saved);
		this.save();
	}

	/** Puts the `claude` shim first on PATH of Axle's terminals (or takes it away), so a hand-typed `claude` gets the `axle` tools too. */
	private async installShim() {
		const collection = this.context.environmentVariableCollection;
		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const config = process.platform === 'win32' || !vscode.workspace.getConfiguration('flow.agents').get<boolean>('shim', true) ? undefined : await this.mcpConfig(cwd);
		if (!config) {
			collection.delete('PATH');
			return;
		}
		const bin = path.join(this.dir, 'bin');
		await fs.mkdir(bin, { recursive: true });
		const file = path.join(bin, 'claude');
		await fs.writeFile(file, shimScript(config), { mode: 0o755 });
		await fs.chmod(file, 0o755);
		collection.prepend('PATH', bin + path.delimiter);
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
	 * The hooks a Axle agent gets on top of the user's own: read-only observers that print nothing,
	 * so they never decide anything. Each one posts the event to whichever Axle window holds this
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
		// On the desktop `process.execPath` is the Axle executable itself: without ELECTRON_RUN_AS_NODE it would open
		// an editor window for the script on every hook event. Claude Code runs hooks through bash, which takes the prefix.
		const asNode = process.versions.electron ? 'ELECTRON_RUN_AS_NODE=1 ' : '';
		const command = `${asNode}"${process.execPath}" "${script}"`;
		const hook = { type: 'command', command, timeout: 5 };
		const hooks: Record<string, unknown[]> = {};
		for (const e of HOOK_EVENTS) {
			const matcher = e === 'PreToolUse' ? PRE_TOOLS : e === 'PostToolUse' || e === 'PostToolUseFailure' || e === 'PermissionRequest' ? '*' : undefined;
			hooks[e] = [{ ...(matcher ? { matcher } : {}), hooks: [hook] }];
		}
		await fs.writeFile(this.settingsFile, JSON.stringify({ hooks }, null, 2), { mode: 0o600 });
	}

	/**
	 * Codex's hooks, in Axle's own Codex profile (see codexHooks.ts). One script for every window, outside the
	 * per-workspace folder, so the profile's text (and the trust Codex keeps for it) is the same everywhere.
	 * Written only when it changed: rewriting the same bytes is harmless, but a changed file asks for trust again.
	 */
	private async writeCodexProfile() {
		const shared = path.join(this.context.globalStorageUri.fsPath, 'agents');
		await fs.mkdir(shared, { recursive: true });
		const script = path.join(shared, 'codex-hook.js');
		if (await fs.readFile(script, 'utf8').catch(() => '') !== CODEX_HOOK_SCRIPT) {
			await fs.writeFile(script, CODEX_HOOK_SCRIPT);
		}
		const file = codexProfileFile();
		const text = codexProfile(codexHookCommand(process.platform, process.execPath, script, !!process.versions.electron));
		if (await fs.readFile(file, 'utf8').catch(() => '') !== text) {
			await fs.mkdir(path.dirname(file), { recursive: true });
			await fs.writeFile(file, text);
			this.log.info(`Agents: wrote the Codex profile ${file}; Codex asks once to trust its hooks (/hooks)`);
		}
	}

	/**
	 * Codex gets `-p axle` only once the profile is written and this `codex` takes it: an older Codex reads `-p` as a
	 * [profiles] name and would not start at all. `codex -p axle mcp list` loads the profile without starting a
	 * session (a profile it cannot read fails it). Asked on the first Codex start, never at activation, so nothing
	 * is written to ~/.codex for someone who never runs Codex from Axle. Any failure means plain `codex`.
	 */
	private codexTakesHooks(): Promise<boolean> {
		if (!this.server || !vscode.workspace.getConfiguration('flow.agents').get<boolean>('codexHooks', true)) {
			return Promise.resolve(false);
		}
		return this.codexHooks ??= this.writeCodexProfile().then(() => new Promise<boolean>(resolve => {
			// A shell finds `codex` the way the terminal will: npm installs it on Windows as codex.cmd, which execFile cannot
			// start alone. The command line is fixed text, nothing from a user or a file reaches it.
			// nosemgrep: axle-shell-true
			execFile('codex', ['-p', CODEX_PROFILE, 'mcp', 'list'], { shell: true, timeout: 8000, windowsHide: true, env: agentProcessEnv() }, (err, _out, stderr) => {
				if (err) {
					this.log.warn(`Agents: Codex runs without status: \`codex -p ${CODEX_PROFILE}\` failed (${String(stderr || err.message).trim().split('\n')[0]})`);
				}
				resolve(!err);
			});
		}), e => {
			this.log.warn(`Agents: Codex runs without status: no Codex profile (${(e as Error).message})`);
			return false;
		});
	}

	/** Terminals outlive a window reload; find ours again by their process (they may reattach after we start). */
	private async revive(saved: Saved | undefined) {
		// First, so nothing below can leave a reattaching terminal unnoticed.
		this.disposables.push(vscode.window.onDidOpenTerminal(t => void this.adopt(t)));
		for (const s of saved?.sessions ?? []) {
			let alive = false;
			try {
				process.kill(s.pid!, 0); // still running?
				alive = true;
			} catch (e) {
				alive = (e as NodeJS.ErrnoException).code === 'EPERM'; // exists, just not ours to signal
			}
			if (alive) {
				this.orphans.set(s.pid!, s);
			} else {
				this.listEnded(s);
			}
		}
		await Promise.all(vscode.window.terminals.map(t => this.adopt(t)));
		// A terminal that has not come back by now is not coming back (or its pid now belongs to something else).
		if (this.orphans.size) {
			this.orphanTimer = setTimeout(() => this.expireOrphans(), ORPHAN_TTL_MS);
		}
	}

	/**
	 * Its terminal is gone (Axle quit, or it was closed). A Claude conversation can be
	 * picked up again with --resume, so it stays listed; other CLIs are dropped.
	 */
	private listEnded(s: Saved['sessions'][number]) {
		if (s.cli === 'claude' && !this.sessions.has(s.id)) {
			const session: AgentSession = { ...s, pid: undefined, state: 'ended', since: Date.now(), todos: [], unread: false, activity: 'Closed · click to resume' };
			this.sessions.set(s.id, session);
			void this.readTitle(session, true);
		}
	}

	private expireOrphans() {
		this.orphanTimer = undefined;
		if (!this.orphans.size) {
			return;
		}
		for (const s of this.orphans.values()) {
			this.log.info(`Agents: ${s.name} did not reattach`);
			this.listEnded(s);
		}
		this.orphans.clear();
		this.save();
		this.changed.fire();
	}

	private async adopt(t: vscode.Terminal) {
		const pid = await Promise.resolve(t.processId).catch(() => undefined);
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
		if (!this.dir) {
			return; // not started: there is no folder to write to (a relative path would land in the cwd)
		}
		const saved: Saved = {
			token: this.token,
			sessions: [...[...this.sessions.values()].map(({ id, cli, name, pid, prompt, transcript, command, agentId }) => ({ id, cli, name, pid, prompt, transcript, command, agentId })), ...this.orphans.values()],
		};
		// One write at a time, through a temp file: overlapping writes could interleave and lose every saved session.
		const file = path.join(this.dir, 'sessions.json');
		this.writing = this.writing.then(async () => {
			const tmp = `${file}.${process.pid}.tmp`;
			await fs.writeFile(tmp, JSON.stringify(saved), { mode: 0o600 });
			await fs.rename(tmp, file);
		}).catch(() => undefined);
	}

	private writing: Promise<void> = Promise.resolve();

	/**
	 * The MCP config that gives an Axle agent the `axle` tools (open files, show flows, draw boards): a file declaring the stdio
	 * server of the flow-view extension for this folder. Undefined, and the agent starts without it, when the setting is off,
	 * flow-view or its server script is missing, or the file cannot be written: the tools are a bonus, never a reason not to start.
	 */
	private async mcpConfig(cwd: string | undefined): Promise<string | undefined> {
		if (!this.dir || !vscode.workspace.getConfiguration('flow.agents').get<boolean>('mcp', true)) {
			return undefined;
		}
		try {
			const view = vscode.extensions.getExtension('flow.flow-view');
			const script = view && path.join(view.extensionPath, 'out', 'axle-mcp.js');
			if (!script || !existsSync(script)) {
				return undefined;
			}
			// Like the hooks: on the desktop process.execPath is the editor, which runs a script only as Node.
			const electron = !!process.versions.electron;
			const config = { mcpServers: { axle: { command: process.execPath, args: [script], env: { ...(electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}), ...(cwd ? { AXLE_WORKSPACE: cwd } : {}) } } } };
			const file = path.join(this.dir, 'axle-mcp.json');
			await fs.mkdir(this.dir, { recursive: true });
			await fs.writeFile(file, JSON.stringify(config, null, 2), { mode: 0o600 });
			return file;
		} catch (e) {
			this.log.warn(`Agents: no MCP config for this agent (${(e as Error).message})`);
			return undefined;
		}
	}

	/** Starts a CLI in a new terminal. Claude gets a session id we chose, so every hook maps to its terminal. */
	async spawn(cli: AgentCli, resume?: AgentSession, custom?: CustomAgent): Promise<AgentSession | undefined> {
		if (!vscode.workspace.isTrusted) {
			void vscode.window.showWarningMessage('Agents run commands in your workspace: trust this folder to start one.', 'Manage Workspace Trust')
				.then(c => c && vscode.commands.executeCommand('workbench.trust.manage'));
			return undefined;
		}
		await this.start(); // the hook settings and the session list must exist before the first agent
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
			env: { ...inheritedAgentEnv(), FLOW_AGENT_SESSION: id, FLOW_HOOK_DIR: this.dir },
			isTransient: false,
		});
		// Double quotes work in bash, zsh, PowerShell and cmd alike.
		const quote = (x: string) => `"${x}"`;
		// --mcp-config takes any number of files, so it goes last; it adds to the user's own MCP servers (no --strict-mcp-config).
		const mcp = cli === 'claude' ? await this.mcpConfig(cwd) : undefined;
		const codexHooks = cli === 'codex' && await this.codexTakesHooks();
		const profile = codexHooks ? ` -p ${CODEX_PROFILE}` : '';
		const command = cli === 'claude'
			? `claude ${resume ? '--resume' : '--session-id'} ${id}${this.server && this.settingsOk ? ` --settings ${quote(this.settingsFile)}` : ''}${mcp ? ` --mcp-config ${quote(mcp)}` : ''}`
			// Codex chose its session id; until a hook told us, `codex resume` without one opens its own picker.
			: cli === 'codex' ? (resume ? `codex resume${profile}${resume.agentId ? ` ${resume.agentId}` : ''}` : `codex${profile}`)
			: resume?.command ?? custom?.command ?? '';
		terminal.show();
		terminal.sendText(command);
		const session: AgentSession = {
			id, cli, name, state: cli === 'claude' ? 'starting' : 'unknown', since: Date.now(), todos: [], unread: false,
			prompt: resume?.prompt, command: cli === 'custom' ? command : undefined, agentId: resume?.agentId,
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
		// Codex skips hooks the user has not trusted yet, without a word: say what brings the status in.
		if (codexHooks) {
			setTimeout(() => {
				if (session.state === 'unknown' && !session.activity) {
					session.activity = 'No status yet: run /hooks in Codex and trust Axle\'s hooks';
					this.changed.fire();
				}
			}, 20_000);
		}
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

	/**
	 * Gives an agent a name of the user's choosing. Claude's own /rename is a `custom-title` line in the transcript, so one is
	 * appended: the new name then survives readTitle (which takes the newest title) and shows in Claude's own /resume list.
	 */
	async rename(id: string, name: string) {
		const s = this.sessions.get(id);
		const title = name.replace(/\s+/g, ' ').trim().slice(0, 80);
		if (!s || !title || title === s.name) {
			return;
		}
		s.name = title;
		this.save();
		this.changed.fire();
		if (s.cli === 'claude' && s.transcript && existsSync(s.transcript)) {
			const line = JSON.stringify({ type: 'custom-title', customTitle: title, sessionId: path.basename(s.transcript, '.jsonl') });
			try {
				// Start on a fresh line only when the last one is unfinished: a blank line in the middle would be one more thing to parse.
				const h = await fs.open(s.transcript, 'a+');
				try {
					const { size } = await h.stat();
					const last = Buffer.alloc(1);
					if (size) {
						await h.read(last, 0, 1, size - 1);
					}
					await h.appendFile(`${size && last[0] !== 0x0a ? '\n' : ''}${line}\n`);
				} finally {
					await h.close();
				}
			} catch (e) {
				this.log.warn(`Agents: could not write the new name to the transcript (${(e as Error).message})`);
			}
		}
	}

	/** Removes a finished agent from the list (its terminal, if any, closes too). */
	forget(id: string) {
		this.terminals.get(id)?.dispose();
		this.terminals.delete(id);
		this.sessions.delete(id);
		this.touched.delete(id);
		this.planDrawn.delete(id);
		for (const [alias, owner] of this.aliases) {
			if (owner === id) {
				this.aliases.delete(alias);
			}
		}
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
		req.setEncoding('utf8'); // chunks can split a multibyte character; the decoder joins them
		req.on('data', d => {
			body += d;
			if (body.length > 4_000_000) {
				req.destroy();
			}
		});
		const agent = String(req.headers['x-flow-agent'] ?? '');
		req.on('end', async () => {
			try {
				await this.hook(JSON.parse(body) as HookPayload, agent);
			} catch (e) {
				this.log.warn(`Agents: hook failed: ${(e as Error).message}`);
			}
			reply(200);
		});
	}

	/**
	 * The agent a hook event belongs to. /clear and /resume can give the conversation a new session id,
	 * but the terminal still carries the id Axle chose (FLOW_AGENT_SESSION): remember the new one for it.
	 */
	private sessionFor(id: string | undefined, agent: string) {
		const known = id ? this.sessions.get(id) ?? this.sessions.get(this.aliases.get(id) ?? '') : undefined;
		if (known || !id) {
			return known;
		}
		const owner = agent ? this.sessions.get(agent) : undefined;
		if (owner?.cli === 'codex') {
			// Codex chose this id: it is the one `codex resume` takes from now on.
			this.aliases.set(id, owner.id);
			owner.agentId = id;
			return owner;
		}
		if (owner?.cli === 'claude') {
			this.aliases.set(id, owner.id);
			this.log.info(`Agents: ${owner.name} continues as session ${id}`);
			return owner;
		}
		return undefined;
	}

	private async hook(p: HookPayload, agent = '') {
		const s = this.sessionFor(p.session_id, agent);
		if (!s) {
			return; // a session Axle did not start (or forgot): stay out of it
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
				if (s.state === 'starting' || s.state === 'unknown') {
					set(s.prompt ? 'done' : 'idle');
				}
				break;
			case 'UserPromptSubmit':
				this.settleAsked(s, 'denied');
				s.prompt = p.prompt?.trim().slice(0, 400);
				s.todos = [];
				s.impact = undefined;
				this.touched.delete(s.id);
				this.planDrawn.delete(s.id);
				set('working', 'Thinking');
				await Promise.resolve(vscode.commands.executeCommand('flow.agentTurn', s.prompt ?? 'Prompt', agentLabel(s))).catch(() => undefined);
				break;
			case 'PreToolUse': {
				if (tool === 'ExitPlanMode') {
					// The plan is proposed, not yet approved: draw it now, and never hold the prompt back for it.
					this.planProposed(s, p, 'before');
					break;
				}
				// An edit: remember the files as they are, for the timeline and Undo.
				if (!isEdit(tool)) {
					break;
				}
				const files = filesOf(tool, p.tool_input, p.cwd);
				await bounded(Promise.resolve(vscode.commands.executeCommand('flow.agentWillEdit', files)).catch(() => undefined), SNAPSHOT_WAIT_MS);
				this.planEdit(s, files, 'before');
				break;
			}
			case 'PermissionRequest':
				this.asked.set(s.id, { tool, input: p.tool_input ?? {}, cwd: p.cwd, at: Date.now() });
				set('blocked', `Wants to: ${describe(tool, p.tool_input)}`);
				break;
			case 'PostToolUse':
			case 'PostToolUseFailure': {
				// A tool that ran and failed was still allowed: either way the question is over and the agent works on.
				this.settleAsked(s, 'allowed');
				set('working', describe(tool, p.tool_input));
				if (p.hook_event_name === 'PostToolUse') {
					if (isEdit(tool)) {
						const files = filesOf(tool, p.tool_input, p.cwd);
						void Promise.resolve(vscode.commands.executeCommand('flow.agentDidEdit', files)).catch(() => undefined);
						this.touch(s, files);
						this.planEdit(s, files, 'after');
					} else if (tool === 'ExitPlanMode') {
						this.planProposed(s, p, 'after');
					}
					this.todos(s, tool, p.tool_input ?? {}, p.tool_response ?? {});
				}
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
				void this.turnImpact(s);
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

	/**
	 * An agent left plan mode: its plan (Markdown) becomes a board in Axle. Claude Code puts the plan into the hook input
	 * (`tool_input.plan` before approval, `tool_response.plan` after); older versions may give only a file path. Fire and
	 * forget: the hook runs before the approval prompt appears, so nothing here may delay it. One board per session, so a
	 * revised plan replaces the old one.
	 */
	private planProposed(s: AgentSession, p: HookPayload, phase: 'before' | 'after') {
		if (!vscode.workspace.getConfiguration('flow.agents').get<boolean>('planBoard', true) || (phase === 'after' && this.planDrawn.has(s.id))) {
			return;
		}
		const source = phase === 'before' ? p.tool_input : p.tool_response;
		const file = [source?.planFilePath, source?.filePath].find((f): f is string => typeof f === 'string' && /\.md$/i.test(f));
		void (async () => {
			let plan = typeof source?.plan === 'string' ? source.plan : undefined;
			if (!plan && file) {
				plan = await bounded(fs.readFile(file, 'utf8'), 2000).catch(() => undefined);
			}
			if (plan?.trim()) {
				this.planDrawn.add(s.id);
				await vscode.commands.executeCommand('flow.agent.plan', s.id, plan, file);
			}
		})().catch(e => this.log.warn(`Agents: plan board failed: ${(e as Error).message}`));
	}

	/** An edit of a file a plan step points at moves that step (doing before the edit, done after it). */
	private planEdit(s: AgentSession, files: string[], phase: 'before' | 'after') {
		if (files.length) {
			void Promise.resolve(vscode.commands.executeCommand('flow.agent.edited', s.id, files, phase)).catch(() => undefined);
		}
	}

	private touch(s: AgentSession, files: string[]) {
		const set = this.touched.get(s.id) ?? new Set<string>();
		files.forEach(f => set.size < MAX_TOUCHED && set.add(f));
		this.touched.set(s.id, set);
	}

	/** The turn is over: which flows did the edited files reach? Shown on the agent's row; clicking one opens it. */
	private async turnImpact(s: AgentSession) {
		const files = [...(this.touched.get(s.id) ?? [])];
		if (!files.length || !vscode.workspace.getConfiguration('flow.agents').get<boolean>('turnImpact', true)) {
			return;
		}
		const impact = await bounded(Promise.resolve(vscode.commands.executeCommand<TurnImpact>('flow.agent.turnImpact', files)).catch(() => undefined), IMPACT_WAIT_MS);
		// A new prompt may have started while this was computed: its answer no longer describes the turn on screen.
		if (impact?.flows?.length && s.state !== 'working' && this.touched.get(s.id)) {
			s.impact = impact;
			this.changed.fire();
		}
	}

	/** Opens the flow at `index` of an agent's turn impact (the dock sends an index, never an id of its own making). */
	openImpactFlow(id: string, index: number) {
		const flow = this.sessions.get(id)?.impact?.flows[index];
		if (flow) {
			void Promise.resolve(vscode.commands.executeCommand('flow.showEntry', flow.id, flow.name, flow.source)).catch(() => undefined);
		}
	}

	/** The question was answered: the tool ran (allowed) or the turn moved on without it (denied). */
	private settleAsked(s: AgentSession, decision: 'allowed' | 'denied') {
		const q = this.asked.get(s.id);
		if (!q) {
			return;
		}
		this.asked.delete(s.id);
		if (s.cli !== 'claude') {
			return; // the permission inbox writes Claude Code rules; Codex keeps its own approvals
		}
		void Promise.resolve(vscode.commands.executeCommand('flowHarness.recordPermission', {
			at: q.at,
			agent: AGENT,
			kind: KIND[q.tool] ?? (q.tool.startsWith('mcp__') ? 'other' : undefined),
			title: q.tool.startsWith('mcp__') ? q.tool : describe(q.tool, q.input),
			files: filesOf(q.tool, q.input, q.cwd),
			rawInput: q.input,
			decision,
		})).catch(() => undefined);
	}

	/** TodoWrite replaces the list; the Task tools add and update one item at a time. */
	private todos(s: AgentSession, tool: string, input: Record<string, unknown>, response: Record<string, unknown>) {
		if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
			// The list comes from the model: only the three known statuses are kept (the dock puts the status in a class name).
			const STATUSES: Todo['status'][] = ['pending', 'in_progress', 'completed'];
			s.todos = (input.todos as { content?: string; activeForm?: string; status?: string }[])
				.map(t => ({ text: String((t.status === 'in_progress' ? t.activeForm : t.content) ?? t.content ?? ''), status: STATUSES.find(x => x === t.status) ?? 'pending' }));
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
		void fs.mkdir(dir, { recursive: true }).then(() => {
			if (this.watchers.has(s.id) || !this.sessions.has(s.id)) {
				return;
			}
			try {
				const w = watch(dir, (_e, name) => {
					if (name && name !== file) {
						return;
					}
					clearTimeout(this.titleTimers.get(s.id));
					this.titleTimers.set(s.id, setTimeout(() => {
						this.titleTimers.delete(s.id);
						void this.readTitle(s);
						void this.checkRefusal(s);
					}, 250));
				});
				// A watched folder that goes away (EPERM on Windows) must not become an uncaught error.
				w.on('error', () => this.unwatch(s.id));
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
		// A transcript can be hundreds of MB: only its ends are read, never the whole file. A title is written again
		// near the end when a session continues; at startup (`whole`) the beginning is looked at too.
		const tail = await this.tail(s.transcript, whole ? 1 << 20 : 16384).catch(() => [] as string[]);
		const title = lastTitle(tail) ?? (whole ? lastTitle(await this.head(s.transcript, 256 * 1024).catch(() => [] as string[])) : undefined);
		if (title && title !== s.name) {
			s.name = title;
			this.save();
			this.changed.fire();
		}
	}

	private unwatch(id: string) {
		this.watchers.get(id)?.close();
		this.watchers.delete(id);
		clearTimeout(this.titleTimers.get(id));
		this.titleTimers.delete(id);
	}

	private async head(file: string, bytes: number) {
		const h = await fs.open(file, 'r');
		try {
			const buf = Buffer.alloc(bytes);
			const { bytesRead } = await h.read(buf, 0, bytes, 0);
			const lines = buf.toString('utf8', 0, bytesRead).split('\n');
			return (bytesRead === bytes ? lines.slice(0, -1) : lines).filter(Boolean); // the last line of a full read may be cut
		} finally {
			await h.close();
		}
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
		// Hooks read the port at call time: leave it blank rather than pointing at a dead port, but not when a newer
		// window of this folder has already put its own there.
		if (this.server && this.dir) {
			try {
				const portFile = path.join(this.dir, 'hook-port');
				if (readFileSync(portFile, 'utf8').trim() === String(this.port)) {
					writeFileSync(portFile, '');
				}
			} catch {
				// already gone
			}
		}
		clearTimeout(this.orphanTimer);
		this.watchers.forEach(w => w.close());
		this.titleTimers.forEach(clearTimeout);
		this.changed.dispose();
		this.disposables.forEach(d => d.dispose());
	}
}
