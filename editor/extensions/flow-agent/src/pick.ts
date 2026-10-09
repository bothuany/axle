/*---------------------------------------------------------------------------------------------
 *  Flow: choosing which agent to start. Claude Code and Codex, any agent CLI found on PATH, and
 *  commands you saved yourself; a custom agent is just a command run in its own terminal.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { Agents, CustomAgent } from './agents';

/** Agent CLIs worth offering when they are installed. */
const KNOWN: CustomAgent[] = [
	{ name: 'Gemini', command: 'gemini' },
	{ name: 'OpenCode', command: 'opencode' },
	{ name: 'Aider', command: 'aider' },
	{ name: 'Cursor Agent', command: 'cursor-agent' },
	{ name: 'Amp', command: 'amp' },
	{ name: 'Goose', command: 'goose' },
	{ name: 'Qwen Code', command: 'qwen' },
	{ name: 'Crush', command: 'crush' },
	{ name: 'Copilot CLI', command: 'copilot' },
];

async function onPath(bin: string) {
	for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
		try {
			await fs.access(path.join(dir, bin), fs.constants.X_OK);
			return true;
		} catch {
			// not here
		}
	}
	return false;
}

export function savedAgents(): CustomAgent[] {
	return vscode.workspace.getConfiguration('flow.agents').get<CustomAgent[]>('custom', []).filter(a => a?.name && a?.command);
}

type Item = vscode.QuickPickItem & { run?: () => unknown };

export async function pickAgent(agents: Agents) {
	const saved = savedAgents();
	const found = (await Promise.all(KNOWN.filter(k => !saved.some(s => s.command.split(/\s+/)[0] === k.command)).map(async k => (await onPath(k.command) ? k : undefined)))).filter((k): k is CustomAgent => !!k);
	const items: Item[] = [
		{ label: '$(sparkle) Claude Code', detail: 'Status, permissions, diffs and context show up in Flow', run: () => agents.spawn('claude') },
		{ label: '$(hubot) Codex', detail: 'Listed here; runs as a plain terminal', run: () => agents.spawn('codex') },
	];
	if (saved.length) {
		items.push({ label: 'Your agents', kind: vscode.QuickPickItemKind.Separator });
		items.push(...saved.map(a => ({ label: `$(terminal) ${a.name}`, description: a.command, run: () => agents.spawn('custom', undefined, a) })));
	}
	if (found.length) {
		items.push({ label: 'Installed', kind: vscode.QuickPickItemKind.Separator });
		items.push(...found.map(a => ({ label: `$(terminal) ${a.name}`, description: a.command, run: () => agents.spawn('custom', undefined, a) })));
	}
	items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
	items.push({ label: '$(add) Add a custom agent…', detail: 'Any command that runs an agent in a terminal', run: () => addAgent(agents) });
	const pick = await vscode.window.showQuickPick(items, { title: 'Start an agent', placeHolder: 'Each agent runs in its own terminal', ignoreFocusOut: true });
	await pick?.run?.();
}

async function addAgent(agents: Agents) {
	const command = await vscode.window.showInputBox({ title: 'Add a custom agent (1/2): command', placeHolder: 'gemini --yolo, aider --model sonnet, ./scripts/my-agent.sh', prompt: 'Runs in a new terminal in this folder' });
	if (!command?.trim()) {
		return;
	}
	const guess = command.trim().split(/\s+/)[0].split('/').pop() ?? 'Agent';
	const name = await vscode.window.showInputBox({ title: 'Add a custom agent (2/2): name', value: guess.charAt(0).toUpperCase() + guess.slice(1), prompt: 'How it appears in the Agents list' });
	if (!name?.trim()) {
		return;
	}
	const agent = { name: name.trim(), command: command.trim() };
	await vscode.workspace.getConfiguration('flow.agents').update('custom', [...savedAgents().filter(a => a.name !== agent.name), agent], vscode.ConfigurationTarget.Global);
	await agents.spawn('custom', undefined, agent);
}
