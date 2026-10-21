/*---------------------------------------------------------------------------------------------
 *  Insilode agent bridge: "Connect Claude Code Tools (MCP)". Adds the `insilode` MCP server to the user's Claude
 *  Code configuration, and only after the user has read exactly what will run and confirmed. It runs the
 *  `claude` CLI's own `mcp add` command (never editing ~/.claude.json or any project file), and offers the
 *  matching removal. Insilode's own agents do not need this: they get the server through --mcp-config.
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
	const script = () => path.join(context.extensionPath, 'out', 'insilode-mcp.js');

	const exists = async () => (await run(commandLine(['mcp', 'get', 'insilode']))).code === 0;

	const connect = async () => {
		if (!existsSync(script())) {
			void vscode.window.showErrorMessage('Insilode: the agent tools server is missing from this installation (out/insilode-mcp.js). Rebuild or reinstall Insilode.');
			return;
		}
		if ((await run(commandLine(['--version']))).code !== 0) {
			void vscode.window.showErrorMessage('Insilode: the `claude` command was not found. Install Claude Code (https://claude.com/claude-code) and make sure `claude` works in a terminal, then try again.');
			return;
		}
		const cmd = mcpAddCommand(script(), { pathNode: findOnPath('node'), execPath: process.execPath });
		const already = await exists();
		const detail = [
			`This runs the Claude Code CLI once:`,
			``,
			commandLine(cmd.args),
			``,
			`What changes: your Claude Code user configuration gets an MCP server named "insilode". From then on every \`claude\` session on this PC (in any terminal, not only Insilode's) can call ${TOOLS.map((t, i) => (i === 0 ? 'mcp__insilode__' : i === TOOLS.length - 1 ? 'and ' : '') + t.name).join(', ').replace(/, and /, ' and ')}.`,
			``,
			`What the tools can do: open files, the git diff and flows and draw diagrams in an Insilode window that has the same folder open, and read diagnostics, symbols and the call flows Insilode has indexed. They cannot write files or run commands, and refuse paths outside the open folder.`,
			cmd.electron ? `\nNode was not found on PATH, so Insilode's own runtime runs the server.` : '',
			already ? `\nAn "insilode" server is already configured: Reconnect removes it first and adds it again.` : '',
			`\nNothing else is touched. Undo any time with "Insilode: Disconnect Claude Code Tools (MCP)".`,
		].join('\n');
		const pick = await vscode.window.showInformationMessage(already ? 'Reconnect Claude Code tools?' : 'Connect Claude Code tools to Insilode?', { modal: true, detail }, already ? 'Reconnect' : 'Connect', ...(already ? ['Remove'] : []));
		if (pick === 'Remove') {
			return disconnect(false);
		}
		if (!pick) {
			return;
		}
		if (already) {
			const removed = await run(commandLine(['mcp', 'remove', 'insilode', '--scope', 'user']));
			if (removed.code !== 0) {
				log.warn(`claude mcp remove: ${removed.out}`);
			}
		}
		const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Insilode: connecting Claude Code tools' }, () => run(commandLine(cmd.args)));
		log.info(`claude mcp add → ${result.code}: ${result.out}`);
		if (result.code === 0) {
			const next = await vscode.window.showInformationMessage('Insilode tools are connected. New `claude` sessions have them; a running one needs /mcp reconnect or a restart.', 'Disconnect');
			if (next) {
				await disconnect(true);
			}
		} else {
			void vscode.window.showErrorMessage(`Insilode: connecting failed. ${result.out.slice(0, 400)}`);
		}
	};

	const disconnect = async (confirmed: boolean) => {
		if ((await run(commandLine(['--version']))).code !== 0) {
			void vscode.window.showErrorMessage('Insilode: the `claude` command was not found.');
			return;
		}
		if (!await exists()) {
			void vscode.window.showInformationMessage('Insilode: Claude Code has no "insilode" tools server configured.');
			return;
		}
		if (!confirmed) {
			const pick = await vscode.window.showWarningMessage('Remove the Insilode tools from Claude Code?', { modal: true, detail: `This runs:\n\n${commandLine(['mcp', 'remove', 'insilode', '--scope', 'user'])}\n\nClaude Code sessions started afterwards no longer have mcp__insilode__* tools.` }, 'Remove');
			if (!pick) {
				return;
			}
		}
		const result = await run(commandLine(['mcp', 'remove', 'insilode', '--scope', 'user']));
		log.info(`claude mcp remove → ${result.code}: ${result.out}`);
		void (result.code === 0
			? vscode.window.showInformationMessage('Insilode tools were removed from Claude Code.')
			: vscode.window.showErrorMessage(`Insilode: removing failed. ${result.out.slice(0, 400)}`));
	};

	// A registration made before the rename is named `axle` and runs out/axle-mcp.js (kept as a stub for it). It keeps working, with the old
	// mcp__axle__* tool names; this offers, once, to move it to `insilode`. Never silently: it edits the user's Claude Code configuration.
	const moveLegacy = async () => {
		if (context.globalState.get<boolean>('insilode.mcpLegacyAsked') || (await run(commandLine(['--version']))).code !== 0) {
			return;
		}
		if ((await run(commandLine(['mcp', 'get', 'axle']))).code !== 0) {
			return;
		}
		await context.globalState.update('insilode.mcpLegacyAsked', true);
		if (await exists() || !existsSync(script())) {
			return;
		}
		const cmd = mcpAddCommand(script(), { pathNode: findOnPath('node'), execPath: process.execPath });
		const pick = await vscode.window.showInformationMessage('Move Claude Code tools from Axle to Insilode?', {
			modal: true,
			detail: [
				'Claude Code has an MCP server named "axle" from before Axle was renamed Insilode. It still works, but its tools are called mcp__axle__*, and Insilode now offers them as mcp__insilode__*.',
				'',
				'This runs the Claude Code CLI twice:',
				'',
				commandLine(['mcp', 'remove', 'axle', '--scope', 'user']),
				commandLine(cmd.args),
				'',
				'Permission rules you wrote for mcp__axle__* in .claude/settings.json are not changed: rename them to mcp__insilode__* yourself.',
			].join('\n'),
		}, 'Move');
		if (pick !== 'Move') {
			return;
		}
		const removed = await run(commandLine(['mcp', 'remove', 'axle', '--scope', 'user']));
		const added = removed.code === 0 ? await run(commandLine(cmd.args)) : removed;
		log.info(`claude mcp move axle → insilode: ${added.code}: ${added.out}`);
		void (added.code === 0
			? vscode.window.showInformationMessage('Insilode tools are connected. A running `claude` session needs /mcp reconnect or a restart.')
			: vscode.window.showErrorMessage(`Insilode: moving the tools failed. ${added.out.slice(0, 400)}`));
	};
	setTimeout(() => void moveLegacy().catch(e => log.warn(`mcp legacy check: ${(e as Error).message}`)), 8000);

	context.subscriptions.push(
		vscode.commands.registerCommand('flow.mcp.connect', () => connect().catch(e => vscode.window.showErrorMessage(`Insilode: ${(e as Error).message}`))),
		vscode.commands.registerCommand('flow.mcp.disconnect', () => disconnect(false).catch(e => vscode.window.showErrorMessage(`Insilode: ${(e as Error).message}`))),
	);
}
