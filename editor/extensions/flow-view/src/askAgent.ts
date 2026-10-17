/*---------------------------------------------------------------------------------------------
 *  Axle: where a question for the agent goes. Home's prompt and "Ask about this flow" opened VS Code's
 *  chat panel, which reaches Claude Code and Codex only with the ACP chat sessions on (off by default):
 *  otherwise the question went to a panel with no agent behind it. They now go to the Claude Code
 *  session in the Agents dock (flow-agent's `flow.agents.ask`), and to the chat panel only when that
 *  is turned on or the dock is not there.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/** Sends `text` to Claude Code in the Agents dock; `submit` sends it, else it waits in the prompt. False: use the chat panel. */
export async function askInDock(text: string, submit: boolean): Promise<boolean> {
	if (vscode.workspace.getConfiguration('flow.agents').get<boolean>('showChat', false)) {
		return false;
	}
	const commands = await vscode.commands.getCommands(true);
	if (!commands.includes('flow.agents.ask')) {
		return false;
	}
	return (await vscode.commands.executeCommand<boolean>('flow.agents.ask', text, submit)) === true;
}
