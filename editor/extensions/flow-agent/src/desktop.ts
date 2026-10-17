/*---------------------------------------------------------------------------------------------
 *  Axle: agent status outside the window. Sends the number of agents that need you to the app
 *  badge (Dock, taskbar overlay icon, launcher) and, when turned on, a small model of the live
 *  agents to the status overlay. Both are drawn by core (editor/patches/flow-desktop.patch), which
 *  registers the `flow.desktop.*` commands in the desktop app only: in the browser they do not
 *  exist and this does nothing.
 *
 *  Neither surface takes focus. A click on an overlay item is the user's gesture: core then calls
 *  `flow.agents.reveal` here and brings the window forward.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { Agents } from './agents';
import { overlayModel, overlayOptions, readSettings } from './desktopModel';

const SET_BADGE = 'flow.desktop.setBadge';
const SET_OVERLAY = 'flow.desktop.setOverlay';
/** Hook events come in bursts: the same pause as the dock's repaint. */
const COALESCE_MS = 250;

export class DesktopStatus implements vscode.Disposable {
	private readonly subs: vscode.Disposable[] = [];
	private timer: NodeJS.Timeout | undefined;
	private available = false;
	private disposed = false;
	/** What was sent last, so a hook that changes nothing shown sends nothing. */
	private badge = 0;
	private overlay: string | undefined;

	constructor(private readonly agents: Agents, private readonly log: vscode.LogOutputChannel) {
		void this.start();
	}

	private async start() {
		const commands = await vscode.commands.getCommands(false);
		if (this.disposed || !commands.includes(SET_BADGE) || !commands.includes(SET_OVERLAY)) {
			return;
		}
		this.available = true;
		this.subs.push(
			this.agents.onDidChange(() => this.schedule()),
			// A setting turned off clears its surface at once, not after the next hook.
			vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('flow.agents.desktop') && this.push()),
		);
		this.push();
	}

	private schedule() {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.push(), COALESCE_MS);
	}

	private push() {
		clearTimeout(this.timer);
		const config = vscode.workspace.getConfiguration('flow.agents.desktop');
		const settings = readSettings(key => config.get(key));
		this.setBadge(settings.badge ? this.agents.needsYou : 0);
		this.setOverlay(settings.overlay ? { ...overlayModel(this.agents.sessions.values(), settings), options: overlayOptions(settings) } : undefined);
	}

	private setBadge(count: number) {
		if (count === this.badge) {
			return;
		}
		this.badge = count;
		void Promise.resolve(vscode.commands.executeCommand(SET_BADGE, count)).catch(e => this.log.warn(`Desktop badge: ${(e as Error).message}`));
	}

	private setOverlay(state: object | undefined) {
		const key = state && JSON.stringify(state);
		if (key === this.overlay) {
			return;
		}
		this.overlay = key;
		void Promise.resolve(vscode.commands.executeCommand(SET_OVERLAY, state)).catch(e => this.log.warn(`Desktop overlay: ${(e as Error).message}`));
	}

	dispose() {
		this.disposed = true;
		clearTimeout(this.timer);
		this.subs.forEach(s => s.dispose());
		// The badge is app-wide on macOS and Linux, and the overlay outlives a window: neither may stay behind this one.
		if (this.available) {
			this.setBadge(0);
			this.setOverlay(undefined);
		}
	}
}
