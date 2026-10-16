// ruleid: axle-vscode-in-headless-module
import * as vscode from 'vscode';
// ruleid: axle-vscode-in-headless-module
import { commands } from 'vscode';
import * as cp from 'child_process';
import { spawn, execFile, exec, execSync } from 'child_process';

const HOME_COMMANDS = new Set(['flow.home']);
const OTHER = new Set(['x']);
const Command = { showEntry: 'flow.showEntry' } as const;
const FOCUS_TYPE = 'flow.types.focusType';

async function onMessage(m: { command?: string; id?: string; type: string; payload: { command: string } }, key: 'command') {
	// ruleid: axle-command-id-not-allowlisted
	await vscode.commands.executeCommand(m.command!);
	// ruleid: axle-command-id-not-allowlisted
	await commands.executeCommand(m.payload.command);
	// ruleid: axle-command-id-not-allowlisted
	await vscode.commands.executeCommand(m[key]!);
	const { command } = m.payload;
	// ruleid: axle-command-id-not-allowlisted
	await vscode.commands.executeCommand(command);
	if (OTHER.has(m.id ?? '')) {
		// ruleid: axle-command-id-not-allowlisted
		await vscode.commands.executeCommand(m.command!);
	}

	// ok: axle-command-id-not-allowlisted
	await (HOME_COMMANDS.has(m.command ?? '') ? vscode.commands.executeCommand(m.command!) : undefined);
	if (HOME_COMMANDS.has(m.command ?? '')) {
		// ok: axle-command-id-not-allowlisted
		await vscode.commands.executeCommand(m.command!);
	}
	if (!HOME_COMMANDS.has(command)) {
		return;
	}
	// ok: axle-command-id-not-allowlisted
	await vscode.commands.executeCommand(command);
	// ok: axle-command-id-not-allowlisted
	await vscode.commands.executeCommand('flow.home', m.id);
	// ok: axle-command-id-not-allowlisted
	await vscode.commands.executeCommand(Command.showEntry, m.id);
	// ok: axle-command-id-not-allowlisted
	await vscode.commands.executeCommand(FOCUS_TYPE);
}

function run(cmd: string) {
	// ruleid: axle-shell-true
	spawn(cmd, { cwd: '.', shell: true });
	// ruleid: axle-shell-true
	execFile('codex', ['mcp', 'list'], { shell: true, timeout: 8000 }, () => undefined);
	// ruleid: axle-shell-true
	cp.spawnSync('x', { shell: true });
	// ruleid: axle-shell-true
	cp.execFileSync('x', [], { shell: true });
	const options = { cwd: '.', shell: true };
	// ruleid: axle-shell-true
	spawn('x', [], options);
	// ruleid: axle-shell-true
	exec(cmd, () => undefined);
	// ruleid: axle-shell-true
	execSync(cmd);
	// ruleid: axle-shell-true
	cp.exec(cmd);

	// ok: axle-shell-true
	spawn('git', ['status'], { cwd: '.' });
	// ok: axle-shell-true
	spawn('git', ['status'], { shell: false });
	// ok: axle-shell-true
	/^(\w+)$/.exec(cmd);
}
