/*---------------------------------------------------------------------------------------------
 *  Axle: tells you when an agent starts needing you while you look elsewhere. A VS Code
 *  notification (which the OS shows as well when the window is in the background, if VS Code is
 *  set up to), with a button that brings the agent's terminal up. Nothing here takes focus by
 *  itself: only the button does, when you press it.
 *
 *  "Elsewhere" means the window is not focused, or the agent's terminal is not the active one. VS
 *  Code does not say whether the terminal panel itself is open, so an active terminal in a closed
 *  panel counts as seen.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { Agents } from './agents';
import { attentionKey, attentionKind, type AttentionKind } from './attention';

const SAY: Record<AttentionKind, string> = {
	approval: 'needs your approval',
	question: 'asks you',
	error: 'hit an error',
	done: 'is done',
};

export class AttentionNotifier implements vscode.Disposable {
	/** The attention each session was last notified (or seen) for, so a repeated hook is not news. */
	private readonly last = new Map<string, string | undefined>();
	private readonly sub: vscode.Disposable;

	constructor(private readonly agents: Agents) {
		this.sub = agents.onDidChange(() => this.check());
	}

	dispose() {
		this.sub.dispose();
	}

	private check() {
		const config = vscode.workspace.getConfiguration('flow.agents.notify');
		for (const s of this.agents.sessions.values()) {
			const key = attentionKey(s);
			if (this.last.get(s.id) === key) {
				continue;
			}
			this.last.set(s.id, key);
			const kind = attentionKind(s);
			if (!kind || !key || config.get<boolean>('quiet', false) || !config.get<boolean>(kind, true) || this.agents.isWatched(s.id)) {
				continue;
			}
			const text = s.need?.text;
			const message = `${s.name} ${SAY[kind]}${text ? `: ${text}` : ''}`;
			const show = kind === 'error' ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
			void show(message, 'Show Terminal').then(pick => pick && this.agents.show(s.id));
		}
		for (const id of this.last.keys()) {
			if (!this.agents.sessions.has(id)) {
				this.last.delete(id);
			}
		}
	}
}
