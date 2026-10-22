/*---------------------------------------------------------------------------------------------
 *  Insilode Harness: hook studio. Run a hook with the exact JSON Claude Code would send, see its exit
 *  code, output and time; add a new hook from a short form instead of hand-editing JSON.
 *--------------------------------------------------------------------------------------------*/

import { execFile, spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { HarnessItem } from './scan';
import { arrayAt, objectAt, previewAndWrite } from './settings';
import { claudeDir } from './dirs';
import { hookVerdict } from './hookverdict';


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

const MAX_OUTPUT = 256 * 1024;

let bashPath: Promise<string | null> | undefined;
const output = (file: string, args: string[]) => new Promise<string>(resolve => execFile(file, args, { encoding: 'utf8', timeout: 5000, windowsHide: true }, (_e, out) => resolve(out ?? '')));
/**
 * The bash that runs hooks, found once: `bash` on macOS and Linux; on Windows the one Claude Code uses
 * (CLAUDE_CODE_GIT_BASH_PATH, else the Git for Windows install that `git` belongs to). Never the `bash.exe` in System32:
 * that is WSL, which would run the hook inside Linux against Windows paths. Null where there is none.
 */
function findBash(): Promise<string | null> {
	if (process.platform !== 'win32') {
		return Promise.resolve('bash');
	}
	return bashPath ??= (async () => {
		const [where, execPath] = await Promise.all([output('where', ['git']), output('git', ['--exec-path'])]);
		const below = (file: string, levels: number) => { let dir = file; for (let i = 0; i < levels; i++) { dir = path.dirname(dir); } return dir; };
		// A Git for Windows root holds bin\bash.exe and usr\bin\bash.exe. It is two or three levels above the git.exe that `where` finds
		// (cmd\git.exe, mingw64\bin\git.exe) and three above `git --exec-path` (mingw64\libexec\git-core), which also works
		// where `where` only finds a shim (Scoop and the like).
		const roots = [
			...where.split(/\r?\n/).map(l => l.trim()).filter(Boolean).flatMap(git => [2, 3].map(levels => below(git, levels))),
			...(execPath.trim() ? [below(path.normalize(execPath.trim()), 3)] : []),
			...[process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter((p): p is string => !!p).map(p => path.join(p, 'Git')),
		];
		const candidates = [
			process.env.CLAUDE_CODE_GIT_BASH_PATH,
			...roots.flatMap(r => [path.join(r, 'bin', 'bash.exe'), path.join(r, 'usr', 'bin', 'bash.exe')]),
		];
		const isWsl = (p: string) => /[\\/]windows[\\/]system32[\\/]/i.test(p);
		const found = candidates.find((p): p is string => !!p && !isWsl(p) && existsSync(p)) ?? null;
		if (!found) {
			bashPath = undefined; // look again next time: Git may have been installed meanwhile
		}
		return found;
	})();
}

/** True when a command leans on bash syntax that cmd.exe does not understand. */
const looksLikeBash = (command: string) => /\[\[|\bthen\b|\bfi\b|\$\(|\$\{|\$[A-Za-z_]|\.sh\b|\/dev\/null|^\s*(?:bash|sh|export)\s/m.test(command);

/** Ends the hook and everything it started: on Windows killing the shell alone leaves its children (and their open pipes) behind. */
function killTree(child: ChildProcess) {
	if (process.platform === 'win32' && child.pid) {
		execFile('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true }, e => e && child.kill());
	} else {
		child.kill('SIGTERM');
	}
}

export class HookStudio implements vscode.Disposable {
	private readonly out = vscode.window.createOutputChannel('Insilode Hooks');

	constructor(private readonly root: () => string | undefined) { }

	/** Runs the hook's command the way Claude Code does: through a shell, payload on stdin, project dir in env. */
	async test(item: HarnessItem) {
		const root = this.root();
		if (!item.hook || !root) {
			return;
		}
		// A hook is a command from the repository's settings: it only runs where the user trusts the folder.
		if (!vscode.workspace.isTrusted) {
			void vscode.window.showWarningMessage('This folder is not trusted, so Insilode will not run its hooks. Trust the folder first if you want to test them.');
			return;
		}
		const payload = samplePayload(item.hook.event, root, item.hook.matcher);
		// Claude Code runs hooks through bash (Git Bash on Windows); the system shell is the fallback where there is none.
		const bash = await findBash();
		if (!bash && looksLikeBash(item.hook.command)) {
			const anyway = await vscode.window.showWarningMessage(
				'Insilode could not find Git Bash, and this hook looks like it needs bash. In the Windows shell it would most likely fail in a way that says nothing about the hook itself.',
				{ detail: 'Install Git for Windows or set CLAUDE_CODE_GIT_BASH_PATH to its bash.exe (Claude Code needs the same).' },
				'Run Anyway',
			);
			if (anyway !== 'Run Anyway') {
				return;
			}
		}
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
			// The editor's own Electron flag must not leak into the hook: a `node` it starts would behave as plain Node.
			const { ELECTRON_RUN_AS_NODE: _electron, ...base } = process.env;
			const env = { ...base, CLAUDE_PROJECT_DIR: root };
			const child = bash
				? spawn(bash, ['-c', item.hook!.command], { cwd: root, env, windowsHide: true })
				// A hook is a shell command line by definition (Claude Code runs it the same way), and only on the user's click.
				: spawn(item.hook!.command, { cwd: root, env, shell: true, windowsHide: true }); // nosemgrep: insilode-shell-true
			let stdout = '';
			let stderr = '';
			let done = false;
			// The hook is over when its shell exits, not when every pipe closes: a command it left running in the background holds
			// them open for as long as it lives. Output still in flight gets a moment, then the pipes are cut.
			const finish = (exit: number | null, note = '') => {
				if (done) {
					return;
				}
				done = true;
				clearTimeout(timer);
				child.stdout.destroy();
				child.stderr.destroy();
				resolve({ exit, stdout, stderr: stderr + note });
			};
			const timer = setTimeout(() => {
				killTree(child);
				// Normally 'exit' follows; if it never does, still report.
				setTimeout(() => finish(null, '\nTimed out after 60 s and was stopped.'), 2000);
			}, 60_000);
			// A hook that prints without end must not fill the editor's memory: keep the first 256 KB.
			const keep = (text: string, chunk: Buffer) => text.length < MAX_OUTPUT ? text + chunk.toString('utf8') : text;
			child.stdout.on('data', d => stdout = keep(stdout, d));
			child.stderr.on('data', d => stderr = keep(stderr, d));
			// A hook that exits without reading its payload closes the pipe: that is EPIPE, not a crash.
			child.stdin.on('error', () => undefined);
			child.on('exit', code => setTimeout(() => finish(code), 300));
			child.on('close', code => finish(code));
			child.on('error', e => finish(null, String(e)));
			child.stdin.end(JSON.stringify(payload));
		});
		const ms = Date.now() - started;
		// Claude Code reads the JSON decision only on exit 0; exit 2 blocks whatever stdout says, any other exit is an error.
		const verdict = hookVerdict(run.exit, run.stdout);
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
			{ label: 'All my projects', detail: '~/.claude/settings.json', file: path.join(claudeDir(), 'settings.json') },
		].filter(x => x.file), { title: 'Add hook (4/4): where should it live?' });
		if (!where?.file) {
			return;
		}
		await previewAndWrite(where.file, `Add ${event.label} hook`, (s: object) => {
			// A settings file whose "hooks" is not an object must be reported, not silently rewritten.
			const hooks = objectAt<Record<string, unknown>>(s, 'hooks');
			arrayAt<unknown>(hooks, event.label).push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command }] });
		});
	}

	dispose() {
		this.out.dispose();
	}
}
