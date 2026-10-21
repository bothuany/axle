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
import { overlayModel, overlayOptions, readAvatar, readSettings } from './desktopModel';

const SET_BADGE = 'flow.desktop.setBadge';
const SET_OVERLAY = 'flow.desktop.setOverlay';
/** Set while the desktop commands exist (not in the browser): the menu entries and commands that bring the island back need it. */
const AVAILABLE = 'flow.agents.desktop.available';
/** Hook events come in bursts: the same pause as the dock's repaint. */
const COALESCE_MS = 250;

/** The island's one on/off switch is the setting; it is written for the user, so every window follows. */
async function setOverlayEnabled(on: boolean) {
	await vscode.workspace.getConfiguration('flow.agents.desktop').update('overlay.enabled', on, vscode.ConfigurationTarget.Global);
}

export class DesktopStatus implements vscode.Disposable {
	private readonly subs: vscode.Disposable[] = [];
	private timer: NodeJS.Timeout | undefined;
	private available = false;
	private disposed = false;
	/** What was sent last, so a hook that changes nothing shown sends nothing. */
	private badge = 0;
	private overlay: string | undefined;
	/** How the island is brought back once it is off: the status bar button, the command, the Agents view menu, the setting. */
	private readonly restore = vscode.window.createStatusBarItem('flow.agents.island', vscode.StatusBarAlignment.Right, 90);

	constructor(private readonly agents: Agents, private readonly log: vscode.LogOutputChannel) {
		this.restore.name = 'Axle Agent Status Island';
		this.restore.text = '$(eye) Agent island';
		this.restore.tooltip = 'The agent status island is hidden. Click to show it again.';
		this.restore.command = 'flow.agents.desktop.showOverlay';
		this.subs.push(
			this.restore,
			vscode.commands.registerCommand('flow.agents.desktop.showOverlay', () => setOverlayEnabled(true)),
			// Also what the island's close button runs (core calls it): off is the setting, so the one on/off switch stays the setting.
			vscode.commands.registerCommand('flow.agents.desktop.hideOverlay', () => this.hideOverlay()),
		);
		void this.start();
	}

	private async hideOverlay() {
		await setOverlayEnabled(false);
		const show = 'Show Again';
		if (await vscode.window.showInformationMessage('The agent status island is hidden. Bring it back from the status bar (Agent island), the Agents view menu, the command "Show the Agent Status Island" or the setting flow.agents.desktop.overlay.enabled.', show) === show) {
			await setOverlayEnabled(true);
		}
	}

	/** The status bar button is there exactly while the island is off (and the desktop app can draw it). */
	private syncRestore() {
		const off = this.available && !readSettings(key => vscode.workspace.getConfiguration('flow.agents.desktop').get(key)).overlay;
		if (off) {
			this.restore.show();
		} else {
			this.restore.hide();
		}
	}

	private async start() {
		const commands = await vscode.commands.getCommands(false);
		if (this.disposed || !commands.includes(SET_BADGE) || !commands.includes(SET_OVERLAY)) {
			return;
		}
		this.available = true;
		void vscode.commands.executeCommand('setContext', AVAILABLE, true);
		this.subs.push(
			this.agents.onDidChange(() => this.schedule()),
			// A setting turned off clears its surface at once, not after the next hook.
			vscode.workspace.onDidChangeConfiguration(e => (e.affectsConfiguration('flow.agents.desktop') || e.affectsConfiguration('flow.agents.avatar')) && this.push()),
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
		const avatar = readAvatar(vscode.workspace.getConfiguration('flow.agents').get('avatar'));
		this.setBadge(settings.badge ? this.agents.needsYou : 0);
		this.syncRestore();
		this.setOverlay(settings.overlay ? { ...overlayModel(this.agents.sessions.values(), settings), options: overlayOptions(settings, avatar) } : undefined);
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
