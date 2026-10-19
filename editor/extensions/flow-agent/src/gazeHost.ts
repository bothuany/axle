/*---------------------------------------------------------------------------------------------
 *  Axle: the gaze's one way out of flow-agent. Terminal agents (agents.ts) and ACP sessions
 *  (sessionType.ts) hand their looks here; one queue throttles them and sends the batches to
 *  flow-view's `flow.agent.gaze`. The setting flow.agents.gaze turns it off at the source:
 *  then nothing is sent at all.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { GAZE_COLOR, GazeQueue, looksFromAcp, looksFromHook } from './gaze';

const queue = new GazeQueue(batch => void Promise.resolve(vscode.commands.executeCommand('flow.agent.gaze', batch)).catch(() => undefined));
/** Each session's prompt count: flow-view replays the looks of the latest one. */
const turns = new Map<string, number>();

const on = () => vscode.workspace.getConfiguration('flow.agents').get<boolean>('gaze', true);

function roots(extra?: string) {
	const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
	return extra && !folders.includes(extra) ? [extra, ...folders] : folders;
}

function who(session: string, agent: string, cli: string) {
	return { session, agent, color: GAZE_COLOR[cli] ?? GAZE_COLOR.custom, turn: turns.get(session) ?? 0 };
}

/** A new prompt: what the agent looks at from now on is a new trail. */
export function gazeTurn(session: string) {
	turns.set(session, (turns.get(session) ?? 0) + 1);
}

/** A terminal agent's PostToolUse. `root`: the checkout it works in (its worktree), which counts as the workspace. */
export function gazeHook(session: string, agent: string, cli: string, tool: string, input: Record<string, unknown> | undefined, response: Record<string, unknown> | undefined, cwd: string | undefined, root: string | undefined) {
	if (!on()) {
		return;
	}
	const looks = looksFromHook(tool, input, response, cwd, roots(root));
	if (looks.length) {
		queue.push(who(session, agent, cli), looks);
	}
}

/** An ACP tool call (or its update) with locations. */
export function gazeAcp(session: string, agent: string, cli: string, kind: string | null | undefined, locations: readonly { path?: unknown; line?: unknown }[] | null | undefined) {
	if (!on()) {
		return;
	}
	const looks = looksFromAcp(kind, locations, roots());
	if (looks.length) {
		queue.push(who(session, agent, cli), looks);
	}
}

export function disposeGaze() {
	queue.dispose();
	turns.clear();
}
