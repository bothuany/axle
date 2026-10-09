/*---------------------------------------------------------------------------------------------
 *  Flow Harness: hook studio. Run a hook with the exact JSON Claude Code would send, see its exit
 *  code, output and time; add a new hook from a short form instead of hand-editing JSON.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { HarnessItem } from './scan';
import { previewAndWrite } from './settings';

export interface HookRun {
	at: number;
	label: string;
	event: string;
	exit: number | null;
	ms: number;
	stdout: string;
	stderr: string;
	/** What the hook decided, read from its JSON output or exit code 2. */
	verdict: 'allowed' | 'blocked' | 'asked' | 'ok' | 'failed';
}

/** The payload Claude Code sends on stdin for this event, filled in from the active editor. */
function samplePayload(event: string, root: string, matcher?: string) {
	const file = vscode.window.activeTextEditor?.document.uri.fsPath ?? path.join(root, 'README.md');
	const base = { session_id: 'flow-hook-test', transcript_path: path.join(os.tmpdir(), 'flow-hook-test.jsonl'), cwd: root, permission_mode: 'default', hook_event_name: event };
	const tool = (matcher ?? 'Edit').split('|')[0].replace(/[^\w]/g, '') || 'Edit';
	switch (event) {
		case 'PreToolUse':
			return { ...base, tool_name: tool, tool_input: tool === 'Bash' ? { command: 'git status', description: 'Show working tree status' } : { file_path: file, old_string: 'a', new_string: 'b' } };
		case 'PostToolUse':
			return { ...base, tool_name: tool, tool_input: tool === 'Bash' ? { command: 'git status' } : { file_path: file, old_string: 'a', new_string: 'b' }, tool_response: { success: true, filePath: file } };
		case 'UserPromptSubmit':
			return { ...base, prompt: 'Explain this file' };
		case 'Stop':
		case 'SubagentStop':
			return { ...base, stop_hook_active: false };
		case 'Notification':
			return { ...base, message: 'Claude needs your permission to use Bash' };
		case 'SessionStart':
			return { ...base, source: 'startup' };
		default:
			return base;
	}
}

export class HookStudio implements vscode.Disposable {
	private readonly out = vscode.window.createOutputChannel('Flow Hooks');
	readonly runs: HookRun[] = [];
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidRun = this.changed.event;

	constructor(private readonly root: () => string | undefined) { }

	/** Runs the hook's command the way Claude Code does: through a shell, payload on stdin, project dir in env. */
	async test(item: HarnessItem) {
		const root = this.root();
		if (!item.hook || !root) {
			return;
		}
		const payload = samplePayload(item.hook.event, root, item.hook.matcher);
		const go = await vscode.window.showInformationMessage(
			`Run "${item.label}" now with a sample ${item.hook.event} payload?`,
			{ modal: true, detail: `It runs on your machine, exactly as Claude Code would:\n\n${item.hook.command}\n\nPayload:\n${JSON.stringify(payload, null, 2)}` },
			'Run Hook',
		);
		if (go !== 'Run Hook') {
			return;
		}
		const started = Date.now();
		const run = await new Promise<{ exit: number | null; stdout: string; stderr: string }>(resolve => {
			// Claude Code runs hooks through bash (Git Bash on Windows); fall back to the system shell there.
			const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
			const child = process.platform === 'win32'
				? spawn(item.hook!.command, { cwd: root, env, shell: true })
				: spawn('/bin/bash', ['-c', item.hook!.command], { cwd: root, env });
			let stdout = '';
			let stderr = '';
			const timer = setTimeout(() => child.kill('SIGTERM'), 60_000);
			child.stdout.on('data', d => stdout += d);
			child.stderr.on('data', d => stderr += d);
			child.on('close', code => {
				clearTimeout(timer);
				resolve({ exit: code, stdout, stderr });
			});
			child.on('error', e => resolve({ exit: null, stdout, stderr: String(e) }));
			child.stdin.end(JSON.stringify(payload));
		});
		const ms = Date.now() - started;
		let verdict: HookRun['verdict'] = run.exit === 0 ? 'ok' : run.exit === 2 ? 'blocked' : 'failed';
		try {
			const json = JSON.parse(run.stdout) as { decision?: string; hookSpecificOutput?: { permissionDecision?: string } };
			const d = json.hookSpecificOutput?.permissionDecision ?? json.decision;
			verdict = d === 'deny' || d === 'block' ? 'blocked' : d === 'ask' ? 'asked' : d === 'allow' || d === 'approve' ? 'allowed' : verdict;
		} catch {
			// plain text output
		}
		const result: HookRun = { at: started, label: item.label, event: item.hook.event, exit: run.exit, ms, stdout: run.stdout, stderr: run.stderr, verdict };
		this.runs.unshift(result);
		this.runs.splice(30);
		this.changed.fire();
		this.out.appendLine(`── ${new Date(started).toLocaleTimeString()}  ${item.label}  (${item.hook.event})  exit ${run.exit ?? 'killed'}  ${ms} ms  → ${verdict}`);
		if (run.stdout.trim()) {
			this.out.appendLine(`stdout:\n${run.stdout.trimEnd()}`);
		}
		if (run.stderr.trim()) {
			this.out.appendLine(`stderr:\n${run.stderr.trimEnd()}`);
		}
		const say = verdict === 'blocked' ? 'would block the tool call' : verdict === 'asked' ? 'would ask you first' : verdict === 'allowed' ? 'would allow it' : verdict === 'ok' ? 'passed' : 'failed';
		const pick = await (verdict === 'failed' ? vscode.window.showErrorMessage : vscode.window.showInformationMessage)(
			`${item.label} ${say} (exit ${run.exit ?? 'killed'}, ${ms} ms).`, 'Show Output');
		if (pick) {
			this.out.show(true);
		}
	}

	/** Event → matcher → command → where, then the settings change is shown as a diff before it is written. */
	async add() {
		const root = this.root();
		const events = [
			{ label: 'PreToolUse', detail: 'Before a tool runs. Can allow, deny or ask (exit 2 blocks).' },
			{ label: 'PostToolUse', detail: 'After a tool ran. Good for formatters, builds, linters.' },
			{ label: 'UserPromptSubmit', detail: 'When you send a prompt. Can add context or block it.' },
			{ label: 'Stop', detail: 'When the agent finishes a turn. Good for checks before you review.' },
			{ label: 'SessionStart', detail: 'When a session starts or resumes. Can load context.' },
			{ label: 'Notification', detail: 'When the agent needs you (permission, idle).' },
			{ label: 'SubagentStop', detail: 'When a subagent finishes.' },
			{ label: 'PreCompact', detail: 'Before the conversation is compacted.' },
		];
		const event = await vscode.window.showQuickPick(events, { title: 'Add hook (1/4): when should it run?' });
		if (!event) {
			return;
		}
		let matcher: string | undefined;
		if (event.label === 'PreToolUse' || event.label === 'PostToolUse') {
			const m = await vscode.window.showQuickPick([
				{ label: 'Edit|Write|MultiEdit', detail: 'Any file change' },
				{ label: 'Bash', detail: 'Shell commands' },
				{ label: 'Read', detail: 'File reads' },
				{ label: 'mcp__.*', detail: 'Any MCP tool' },
				{ label: '*', detail: 'Every tool' },
				{ label: 'Custom…', detail: 'Type a tool name or regex' },
			], { title: 'Add hook (2/4): for which tools?' });
			if (!m) {
				return;
			}
			matcher = m.label === 'Custom…' ? await vscode.window.showInputBox({ title: 'Tool name or regex', placeHolder: 'Edit|Write' }) : m.label;
			if (matcher === undefined) {
				return;
			}
		}
		const command = await vscode.window.showInputBox({
			title: 'Add hook (3/4): what should it run?',
			placeHolder: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/check.sh"',
			prompt: 'Runs through a shell with the event JSON on stdin. Exit 2 blocks and shows stderr to the agent.',
		});
		if (!command) {
			return;
		}
		const where = await vscode.window.showQuickPick([
			{ label: 'This repo, shared', detail: '.claude/settings.json: committed, applies to everyone', file: root && path.join(root, '.claude', 'settings.json') },
			{ label: 'This repo, just me', detail: '.claude/settings.local.json: not committed', file: root && path.join(root, '.claude', 'settings.local.json') },
			{ label: 'All my projects', detail: '~/.claude/settings.json', file: path.join(os.homedir(), '.claude', 'settings.json') },
		].filter(x => x.file), { title: 'Add hook (4/4): where should it live?' });
		if (!where?.file) {
			return;
		}
		await previewAndWrite(where.file, `Add ${event.label} hook`, (s: { hooks?: Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]> }) => {
			s.hooks ??= {};
			s.hooks[event.label] ??= [];
			s.hooks[event.label].push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command }] });
		});
	}

	dispose() {
		this.out.dispose();
		this.changed.dispose();
	}
}

export async function ensureDir(file: string) {
	await fs.mkdir(path.dirname(file), { recursive: true });
}
