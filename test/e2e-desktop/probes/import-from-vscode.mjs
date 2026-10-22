// Docker probe for "Insilode: Import from VS Code…": a fake VS Code home with three extensions Open VSX has and one it
// does not (Pylance); the import must install the three and report Pylance as not found. Needs the network (Open VSX).
//   npm run docker:e2e -- --probe test/e2e-desktop/probes/import-from-vscode.mjs
import { startInsilode, shot, runCommand, sleep, until } from '/work/insilode/test/e2e-desktop/lib/probe.mjs'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OPEN_VSX = ['esbenp.prettier-vscode', 'dbaeumer.vscode-eslint', 'redhat.vscode-yaml']
const MISSING = 'ms-python.vscode-pylance'

// The fake home: Linux layout (~/.config/Code/User and ~/.vscode/extensions).
const home = mkdtempSync(join(tmpdir(), 'fake-vscode-home-'))
const user = join(home, '.config', 'Code', 'User')
mkdirSync(join(user, 'snippets'), { recursive: true })
writeFileSync(join(user, 'settings.json'), JSON.stringify({ 'editor.fontSize': 15, 'files.autoSave': 'afterDelay', 'telemetry.telemetryLevel': 'all', 'workbench.colorTheme': 'Default Light Modern' }, null, 2))
writeFileSync(join(user, 'keybindings.json'), JSON.stringify([{ key: 'ctrl+shift+d', command: 'editor.action.copyLinesDownAction' }], null, 2))
writeFileSync(join(user, 'snippets', 'typescript.json'), JSON.stringify({ Arrow: { prefix: 'af', body: ['const $1 = () => {}'] } }, null, 2))
const exts = join(home, '.vscode', 'extensions')
mkdirSync(exts, { recursive: true })
writeFileSync(join(exts, 'extensions.json'), JSON.stringify([...OPEN_VSX, MISSING].map(id => ({ identifier: { id }, version: '1.0.0', relativeLocation: `${id}-1.0.0` }))))
process.env.INSILODE_IMPORT_HOME = home
console.log('fake home:', home)

const started = Date.now()

/** Copies this run's editor logs (shared process: gallery and installs; extension hosts) to /out/editor-logs. */
function dumpLogs() {
	for (const p of readdirSync(tmpdir()).filter(n => n.startsWith('insilode-e2e-')).map(n => join(tmpdir(), n))) {
		const logs = join(p, 'user-data', 'logs')
		if (existsSync(logs)) {
			cpSync(logs, join(process.env.INSILODE_E2E_OUT ?? '/out', 'editor-logs', p.split('/').pop()), { recursive: true })
		}
	}
}
// Dialogs drawn in the page (not native ones, which a page screenshot and Playwright cannot see): the publisher trust prompt.
const { app, page } = await startInsilode({ settings: { 'window.dialogStyle': 'custom' } })
console.log('screenshot:', await shot(page, 'import-0-start'))

await runCommand(page, 'Insilode: Import from VS Code…')
const input = page.locator('.quick-input-widget .quick-input-box input')
await input.waitFor({ state: 'visible', timeout: 15000 })
await sleep(1000)
console.log('screenshot:', await shot(page, 'import-1-items'))
const rows = await page.locator('.quick-input-list .monaco-list-row').allInnerTexts()
console.log('items:', JSON.stringify(rows))
// Enter in the filter box accepts the ticked items (retry: the first press can land before the list is ready).
for (let i = 0; i < 5 && await input.isVisible(); i++) {
	await input.press('Enter')
	await sleep(1500)
}

// Progress, then the final notification.
await sleep(4000)
console.log('screenshot:', await shot(page, 'import-2-progress'))
const done = page.locator('.notifications-toasts .notification-list-item-message', { hasText: 'Imported from VS Code' })
// The editor asks once per new publisher whether to trust it (a modal dialog); a person answers "Trust Publisher & Install".
let trustDialogs = 0
try {
	await until('the import to finish', async () => {
		const trust = page.locator('.monaco-dialog-box .monaco-button', { hasText: /Trust Publishers? & Install/ })
		if (await trust.count()) {
			trustDialogs++
			if (trustDialogs === 1) {
				console.log('screenshot:', await shot(page, 'import-2b-trust-publisher'))
			}
			await trust.first().click()
		}
		return (await done.count()) > 0
	}, { ms: 240000 })
} catch (e) {
	console.log('screenshot:', await shot(page, 'import-timeout'))
	dumpLogs()
	throw e
}
console.log('publisher trust dialogs answered:', trustDialogs)
const message = await done.first().innerText()
console.log('notification:', message)
console.log('screenshot:', await shot(page, 'import-3-done'))

// The extensions folder of this run's profile (launchInsilode makes it under a fresh insilode-e2e-* temp folder).
const profiles = readdirSync(tmpdir()).filter(n => n.startsWith('insilode-e2e-')).map(n => join(tmpdir(), n))
	.filter(p => statSync(p).mtimeMs >= started - 1000).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
const extDir = profiles.map(p => join(p, 'extensions')).find(existsSync)
const installed = extDir ? readdirSync(extDir).filter(n => !n.startsWith('.') && n !== 'extensions.json') : []
console.log('extensions dir:', extDir, JSON.stringify(installed))

const results = []
for (const id of OPEN_VSX) {
	const ok = installed.some(n => n.toLowerCase().startsWith(`${id}-`))
	results.push(`${ok ? 'PASS' : 'FAIL'} ${id} installed`)
}
results.push(`${installed.some(n => n.toLowerCase().startsWith(`${MISSING}-`)) ? 'FAIL' : 'PASS'} ${MISSING} not installed`)
results.push(`${message.includes(MISSING) && /not on Open VSX/.test(message) ? 'PASS' : 'FAIL'} ${MISSING} reported as not on Open VSX`)

// The settings that landed, through the Settings JSON editor.
await runCommand(page, 'Preferences: Open User Settings (JSON)')
await sleep(2500)
console.log('screenshot:', await shot(page, 'import-4-settings-json'))
const text = await page.locator('.monaco-editor .view-lines').first().innerText().catch(() => '')
results.push(`${/editor\.fontSize.*15/.test(text) ? 'PASS' : 'FAIL'} editor.fontSize imported`)
results.push(`${/telemetryLevel.*"all"/.test(text) ? 'FAIL' : 'PASS'} telemetry.telemetryLevel kept as Insilode's`)

dumpLogs()
for (const r of results) {
	console.log(r)
}
console.log(results.every(r => r.startsWith('PASS')) ? 'PROBE PASSED' : 'PROBE FAILED')
await app.close()
