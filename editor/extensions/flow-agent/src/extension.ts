/*---------------------------------------------------------------------------------------------
 *  Axle: Claude Code and Codex. Terminal-first: each agent is its real CLI in a terminal and the
 *  Agents dock shows their status. The chat-panel session types stay available behind a setting.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AgentHost, type AgentKind } from './acp';
import { Agents } from './agents';
import { AgentsDock } from './dock';
import { registerPlaceholderModels } from './models';
import { pickAgent } from './pick';
import { startOrResume } from './resume';
import { AgentSessionType } from './sessionType';

export function activate(context: vscode.ExtensionContext) {
	const log = vscode.window.createOutputChannel('Axle Agents', { log: true });
	context.subscriptions.push(log, registerPlaceholderModels());
	// The chat session types are contributed only while flow.agents.showChat is on (their `when` in package.json), and VS Code
	// refuses a chat participant that is not contributed: registering them regardless logged two errors on every start.
	const showChat = () => vscode.workspace.getConfiguration('flow.agents').get<boolean>('showChat', false);
	if (showChat()) {
		for (const kind of ['claude', 'codex'] as AgentKind[]) {
			const host = new AgentHost(kind, context.extensionPath, log);
			context.subscriptions.push(host, new AgentSessionType(kind, host, log));
		}
	}
	const chatAtStart = showChat();
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('flow.agents.showChat') && showChat() !== chatAtStart) {
			void vscode.window.showInformationMessage('Reload the window to apply the chat panel setting.', 'Reload Window')
				.then(pick => pick && vscode.commands.executeCommand('workbench.action.reloadWindow'));
		}
	}));

	const agents = new Agents(context, log);
	agents.start().catch(e => log.error(`Agents: start failed: ${(e as Error).message}`));
	const dock = new AgentsDock(agents);
	context.subscriptions.push(
		agents,
		dock,
		vscode.window.registerWebviewViewProvider('flow.agents', dock, { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.commands.registerCommand('flow.agents.newClaude', () => agents.spawn('claude')),
		vscode.commands.registerCommand('flow.agents.newCodex', () => agents.spawn('codex')),
		vscode.commands.registerCommand('flow.agents.new', () => pickAgent(agents)),
		vscode.commands.registerCommand('flow.agents.resume', () => startOrResume(agents, 'claude', false)),
		vscode.commands.registerCommand('flow.agents.start', (cli: unknown) => cli === 'claude' || cli === 'codex' ? startOrResume(agents, cli) : undefined),
		// Called by flow-view (Home, "Ask about this flow"): a question for the agent in the dock.
		vscode.commands.registerCommand('flow.agents.ask', (text: unknown, submit: unknown) => typeof text === 'string' ? agents.ask(text, submit === true) : false),
	);
	// The dock is where Axle's agents live: on the first start, show it rather than the chat panel (which needs ACP to reach them).
	if (!showChat() && !context.globalState.get<boolean>('flow.agents.dockShown')) {
		void context.globalState.update('flow.agents.dockShown', true);
		void vscode.commands.executeCommand('workbench.view.extension.flowAgents');
	}
	log.info('Axle agents registered');
}

export function deactivate() { }
