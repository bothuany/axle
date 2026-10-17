/*---------------------------------------------------------------------------------------------
 *  Axle: where a question for the agent goes. Home's prompt and "Ask about this flow" hand it to
 *  flow-agent's `flow.agents.ask`, which sends it to the agent the user chose (a running session of
 *  any CLI, a new one, the chat panel or the clipboard) and remembers that choice. The chat panel is
 *  used directly only when flow-agent is not there to ask.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Sends `text` to the user's chosen agent; `submit` sends it, else it waits in the prompt to be finished. `files` are
 * attached the way the target reads them (an @-mention for Claude, a path for the others, attachments in the chat).
 * True when flow-agent dealt with it (also when the user closed its picker); false: flow-agent is not there, use the chat panel.
 */
export async function askInDock(text: string, submit: boolean, origin: string, files: string[] = []): Promise<boolean> {
	const commands = await vscode.commands.getCommands(true);
	if (!commands.includes('flow.agents.ask')) {
		return false;
	}
	return (await vscode.commands.executeCommand<boolean>('flow.agents.ask', text, submit, origin, files)) === true;
}
