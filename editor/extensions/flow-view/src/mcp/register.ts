/*---------------------------------------------------------------------------------------------
 *  Axle agent bridge: "Connect Claude Code Tools (MCP)". Adds the `axle` MCP server to the user's Claude
 *  Code configuration, and only after the user has read exactly what will run and confirmed. It runs the
 *  `claude` CLI's own `mcp add` command (never editing ~/.claude.json or any project file), and offers the
 *  matching removal. Axle's own agents do not need this: they get the server through --mcp-config.
 *--------------------------------------------------------------------------------------------*/

import { exec } from 'child_process';
import { existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { commandLine, findOnPath, mcpAddCommand } from './command';
import { TOOLS } from './tools';

interface Run { code: number; out: string }

/** Runs one command line through the shell (on Windows `claude` is a .cmd shim); no window, and a limit on time. */
function run(line: string): Promise<Run> {
	return new Promise(resolve => {
		exec(line, { windowsHide: true, timeout: 60_000, cwd: os.homedir(), maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
			const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as unknown as { code: number }).code : 1) : 0;
			resolve({ code, out: `${stdout}${stderr}`.trim() });
		});
	});
}

export function registerMcpCommands(context: vscode.ExtensionContext, log: vscode.LogOutputChannel) {
	const script = () => path.join(context.extensionPath, 'out', 'axle-mcp.js');

	const exists = async () => (await run(commandLine(['mcp', 'get', 'axle']))).code === 0;

	const connect = async () => {
		if (!existsSync(script())) {
			void vscode.window.showErrorMessage('Axle: the agent tools server is missing from this installation (out/axle-mcp.js). Rebuild or reinstall Axle.');
			return;
		}
		if ((await run(commandLine(['--version']))).code !== 0) {
			void vscode.window.showErrorMessage('Axle: the `claude` command was not found. Install Claude Code (https://claude.com/claude-code) and make sure `claude` works in a terminal, then try again.');
			return;
		}
		const cmd = mcpAddCommand(script(), { pathNode: findOnPath('node'), execPath: process.execPath });
		const already = await exists();
		const detail = [
			`This runs the Claude Code CLI once:`,
			``,
			commandLine(cmd.args),
			``,
			`What changes: your Claude Code user configuration gets an MCP server named "axle". From then on every \`claude\` session on this PC (in any terminal, not only Axle's) can call ${TOOLS.map((t, i) => (i === 0 ? 'mcp__axle__' : i === TOOLS.length - 1 ? 'and ' : '') + t.name).join(', ').replace(/, and /, ' and ')}.`,
			``,
			`What the tools can do: open files, the git diff and flows and draw diagrams in an Axle window that has the same folder open, and read diagnostics, symbols and the call flows Axle has indexed. They cannot write files or run commands, and refuse paths outside the open folder.`,
			cmd.electron ? `\nNode was not found on PATH, so Axle's own runtime runs the server.` : '',
			already ? `\nAn "axle" server is already configured: Reconnect removes it first and adds it again.` : '',
			`\nNothing else is touched. Undo any time with "Axle: Disconnect Claude Code Tools (MCP)".`,
		].join('\n');
		const pick = await vscode.window.showInformationMessage(already ? 'Reconnect Claude Code tools?' : 'Connect Claude Code tools to Axle?', { modal: true, detail }, already ? 'Reconnect' : 'Connect', ...(already ? ['Remove'] : []));
		if (pick === 'Remove') {
			return disconnect(false);
		}
		if (!pick) {
			return;
		}
		if (already) {
			const removed = await run(commandLine(['mcp', 'remove', 'axle', '--scope', 'user']));
			if (removed.code !== 0) {
				log.warn(`claude mcp remove: ${removed.out}`);
			}
		}
		const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Axle: connecting Claude Code tools' }, () => run(commandLine(cmd.args)));
		log.info(`claude mcp add → ${result.code}: ${result.out}`);
		if (result.code === 0) {
			const next = await vscode.window.showInformationMessage('Axle tools are connected. New `claude` sessions have them; a running one needs /mcp reconnect or a restart.', 'Disconnect');
			if (next) {
				await disconnect(true);
			}
		} else {
			void vscode.window.showErrorMessage(`Axle: connecting failed. ${result.out.slice(0, 400)}`);
		}
	};

	const disconnect = async (confirmed: boolean) => {
		if ((await run(commandLine(['--version']))).code !== 0) {
			void vscode.window.showErrorMessage('Axle: the `claude` command was not found.');
			return;
		}
		if (!await exists()) {
			void vscode.window.showInformationMessage('Axle: Claude Code has no "axle" tools server configured.');
			return;
		}
		if (!confirmed) {
			const pick = await vscode.window.showWarningMessage('Remove the Axle tools from Claude Code?', { modal: true, detail: `This runs:\n\n${commandLine(['mcp', 'remove', 'axle', '--scope', 'user'])}\n\nClaude Code sessions started afterwards no longer have mcp__axle__* tools.` }, 'Remove');
			if (!pick) {
				return;
			}
		}
		const result = await run(commandLine(['mcp', 'remove', 'axle', '--scope', 'user']));
		log.info(`claude mcp remove → ${result.code}: ${result.out}`);
		void (result.code === 0
			? vscode.window.showInformationMessage('Axle tools were removed from Claude Code.')
			: vscode.window.showErrorMessage(`Axle: removing failed. ${result.out.slice(0, 400)}`));
	};

	context.subscriptions.push(
		vscode.commands.registerCommand('flow.mcp.connect', () => connect().catch(e => vscode.window.showErrorMessage(`Axle: ${(e as Error).message}`))),
		vscode.commands.registerCommand('flow.mcp.disconnect', () => disconnect(false).catch(e => vscode.window.showErrorMessage(`Axle: ${(e as Error).message}`))),
	);
}
