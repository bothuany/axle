// Moves the real mouse pointer. The island is dragged by the main process, which reads the pointer's position on the screen
// (not the page's mouse events), so a test has to move the actual cursor. Only on an isolated machine (lib/isolation.mjs).
import { spawnSync } from 'node:child_process'

/** The command that puts the pointer at (x, y) on this OS, or undefined when this machine cannot. Pure, tested. */
export function pointerCommand(platform, x, y) {
	const [px, py] = [Math.round(x), Math.round(y)]
	if (platform === 'win32') {
		const script = `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);' -Name W -Namespace Axle; [Axle.W]::SetCursorPos(${px}, ${py}) | Out-Null`
		return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]]
	}
	if (platform === 'linux') {
		return ['xdotool', ['mousemove', String(px), String(py)]]
	}
	return undefined
}

export function movePointer(x, y, platform = process.platform) {
	const cmd = pointerCommand(platform, x, y)
	if (!cmd) {
		return false
	}
	const r = spawnSync(cmd[0], cmd[1], { stdio: 'ignore' })
	return r.status === 0
}
