/*---------------------------------------------------------------------------------------------
 *  Flow: Claude Code and Codex. Terminal-first: each agent is its real CLI in a terminal and the
 *  Agents dock shows their status. The chat-panel session types stay available behind a setting.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AgentHost, type AgentKind } from './acp';
import { Agents } from './agents';
import { AgentsDock } from './dock';
import { registerPlaceholderModels } from './models';
import { pickAgent } from './pick';
import { AgentSessionType } from './sessionType';

export function activate(context: vscode.ExtensionContext) {
	const log = vscode.window.createOutputChannel('Flow Agents', { log: true });
	context.subscriptions.push(log, registerPlaceholderModels());
	for (const kind of ['claude', 'codex'] as AgentKind[]) {
		const host = new AgentHost(kind, context.extensionPath, log);
		context.subscriptions.push(host, new AgentSessionType(kind, host, log));
	}

	const agents = new Agents(context, log);
	void agents.start();
	context.subscriptions.push(
		agents,
		vscode.window.registerWebviewViewProvider('flow.agents', new AgentsDock(agents), { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.commands.registerCommand('flow.agents.newClaude', () => agents.spawn('claude')),
		vscode.commands.registerCommand('flow.agents.newCodex', () => agents.spawn('codex')),
		vscode.commands.registerCommand('flow.agents.new', () => pickAgent(agents)),
	);
	log.info('Flow agents registered');
}

export function deactivate() { }
