// For a probe script that `npm run docker:e2e -- --probe <file>` runs inside the container: starts Insilode from the source checkout on
// the container's virtual display and hands back the Playwright pages. Nothing opens on the host's screen.
//
//   import { startInsilode, shot, runCommand } from '/work/insilode/test/e2e-desktop/lib/probe.mjs'
//   const { app, page } = await startInsilode()                  // the demo project, the first-run dialog dismissed
//   await runCommand(page, 'Insilode: Show Flow at Cursor')
//   console.log(await shot(page, 'flow'))                    // /out/shots/probe-flow.png
//   await app.close()
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchInsilode } from './app.mjs'
import { sourceElectron } from '../run.mjs'
import { dismissWelcome } from './ui.mjs'

export { runCommand, dismissWelcome, findCanvas, tabTitles } from './ui.mjs'
export { until, sleep } from './app.mjs'

const out = process.env.INSILODE_E2E_OUT ?? '/out'

/**
 * @param {object} [o]
 * @param {string} [o.folder]    workspace to open (default: the probe demo project, freshly made)
 * @param {object} [o.settings]  profile settings
 * @param {boolean} [o.driver]   load the fake-agents driver extension (the status island needs it)
 */
export async function startInsilode(o = {}) {
	const source = process.env.INSILODE_E2E_SOURCE
	if (!source) {
		throw new Error('INSILODE_E2E_SOURCE is not set: run this script with `npm run docker:e2e -- --probe <file>`.')
	}
	let folder = o.folder
	if (!folder) {
		folder = join(realpathSync(mkdtempSync(join(tmpdir(), 'insilode-probe-'))), 'demo-shop')
		execFileSync(process.execPath, ['/work/insilode/.claude/skills/probe/scripts/demo-workspace.mjs', folder], { stdio: 'inherit' })
	}
	mkdirSync(join(out, 'shots'), { recursive: true })
	const app = await launchInsilode({
		exe: sourceElectron(source), args: ['.'], cwd: source, out, folder, settings: o.settings,
		env: { NODE_ENV: 'development', VSCODE_DEV: '1', VSCODE_CLI: '1' },
		extensions: o.driver ? ['/work/insilode/test/e2e-desktop/driver'] : [],
	})
	const page = await app.workbench()
	await dismissWelcome(page)
	return { app, page, folder }
}

/** Saves a screenshot of `page` as <out>/shots/probe-<name>.png and returns the path. */
export async function shot(page, name) {
	const file = join(out, 'shots', `probe-${name}.png`)
	await page.screenshot({ path: file })
	return file
}
