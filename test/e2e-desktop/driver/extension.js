// Loaded only by the desktop e2e run (--extensionDevelopmentPath), never shipped. It stands in for live agents: the status
// island draws what flow-agent pushes, and a CI machine has no Claude Code to push anything. Three fake agents are pushed to
// `flow.desktop.setOverlay` (registered by the desktop app only) for as long as the island is switched on in the settings,
// so a test can switch it off (or let the island's own close button do it) and see it go.
const vscode = require('vscode')

const SET_OVERLAY = 'flow.desktop.setOverlay'
const AGENTS = [
	{ id: 'e2e-1', name: 'Claude 1', cli: 'claude', state: 'needs', attention: 'approval', activity: 'Wants approval' },
	{ id: 'e2e-2', name: 'Claude 2', cli: 'claude', state: 'working', activity: 'Running' },
	{ id: 'e2e-3', name: 'Codex 1', cli: 'codex', state: 'done', attention: 'done' },
]

/** The model the island takes (src/vs/platform/insilodeDesktop/common/insilodeDesktop.ts); the main process sanitizes it again. */
function model() {
	const o = vscode.workspace.getConfiguration('flow.agents.desktop.overlay')
	return {
		items: AGENTS,
		counts: { needs: 1, working: 1, done: 1 },
		options: { position: 'top-center', display: 'insilode', style: 'pill', size: 'medium', opacity: 1, theme: 'black', avatar: 'gyro', autoHide: o.get('autoHide') ?? { noAgents: true, insilodeFocused: false } },
	}
}

async function push() {
	if (!vscode.workspace.getConfiguration('flow.agents.desktop.overlay').get('enabled')) {
		return
	}
	if ((await vscode.commands.getCommands(false)).includes(SET_OVERLAY)) {
		await vscode.commands.executeCommand(SET_OVERLAY, model())
	}
}

exports.activate = context => {
	// flow-agent pushes (an empty list) when it starts and on a settings change; pushing again every few seconds wins that race.
	const timer = setInterval(() => push().catch(() => undefined), 3000)
	context.subscriptions.push({ dispose: () => clearInterval(timer) }, vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('flow.agents.desktop') && push().catch(() => undefined)))
	push().catch(() => undefined)
}
