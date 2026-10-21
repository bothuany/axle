#!/usr/bin/env node
// Desktop end-to-end run: starts Axle for real (Electron, driven by Playwright) and records what a person would see.
//   node run.mjs --label linux --out out --source ../../editor/vscode             a source checkout (Linux, under xvfb)
//   node run.mjs --label windows --out out --installer ../../dist/Axle-Setup-x.y.z-x64.exe   install, scenarios, update, uninstall
//   node run.mjs --label windows --out out --exe "C:\...\Axle.exe"                  an app that is already installed
// Opens windows and moves the pointer, so it only runs where AXLE_E2E_ISOLATED=1 (CI, Windows Sandbox): lib/isolation.mjs.
// Writes <out>/results.json and <out>/shots/*.png; exits 1 when a scenario failed.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchAxle, withRetries } from './lib/app.mjs'
import { refusal } from './lib/isolation.mjs'
import { install, uninstall, updateFlow } from './lib/installer.mjs'
import { Results } from './lib/results.mjs'
import { APP_SCENARIOS } from './lib/scenarios.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(HERE, '..', '..')

export function parseArgs(argv) {
	const o = {}
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith('--')) {
			throw new Error(`Unexpected argument "${argv[i]}"`)
		}
		o[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i]
	}
	return o
}

/** The Electron binary of a VS Code source checkout: `.build/electron/<applicationName>` (Linux) or `<nameLong>.exe` (Windows). */
export function sourceElectron(vscodeDir) {
	const product = JSON.parse(readFileSync(join(vscodeDir, 'product.json'), 'utf8'))
	const dir = join(vscodeDir, '.build', 'electron')
	const candidates = process.platform === 'win32' ? [`${product.nameShort}.exe`] : [product.applicationName, product.nameShort]
	const found = candidates.map(n => join(dir, n)).find(existsSync)
	if (!found) {
		throw new Error(`No Electron binary in ${dir} (looked for ${candidates.join(', ')}; there: ${existsSync(dir) ? readdirSync(dir).slice(0, 12).join(', ') : 'no such folder'}). Run \`npm run setup\` first.`)
	}
	return found
}

function collectLogs(app, out, name) {
	try {
		cpSync(join(app.profile, 'user-data', 'logs'), join(out, 'logs', name), { recursive: true })
	} catch {
		// the app wrote none
	}
}

async function main() {
	const why = refusal()
	if (why) {
		console.error(why)
		process.exit(2)
	}
	const o = parseArgs(process.argv.slice(2))
	const label = String(o.label ?? process.platform)
	const out = resolve(String(o.out ?? 'e2e-out'))
	const only = o.only ? String(o.only).split(',') : undefined
	const results = new Results(label, out)
	const work = realpathSync.native(mkdtempSync(join(tmpdir(), 'axle-e2e-work-')))
	const folder = join(work, 'demo-shop')
	execFileSync(process.execPath, [join(ROOT, '.claude', 'skills', 'probe', 'scripts', 'demo-workspace.mjs'), folder], { stdio: 'inherit' })

	const driver = join(HERE, 'driver')
	const settings = { 'flow.agents.desktop.overlay.enabled': true, 'flow.agents.desktop.overlay.autoHide': { noAgents: true, axleFocused: false } }
	let exe, args, cwd, env
	let installDir
	const record = (id, title, r) => results.add({ id, title, ms: Date.now() - r.t0, ...r.value })
	const timed = async (id, title, fn) => {
		const t0 = Date.now()
		try {
			record(id, title, { t0, value: await fn() })
		} catch (e) {
			record(id, title, { t0, value: { status: 'fail', detail: String(e.message).split('\n').slice(0, 12).join(' / '), shots: [] } })
		}
	}

	if (o.installer) {
		installDir = join(work, 'Axle')
		await timed('install', 'Windows installer: silent install', async () => {
			exe = install(resolve(String(o.installer)), installDir, join(out, 'setup.log'))
			return { status: 'pass', detail: `Axle.exe in ${installDir}`, shots: [] }
		})
	} else if (o.exe) {
		exe = resolve(String(o.exe))
		args = []
	} else if (o.source) {
		const vscode = resolve(String(o.source))
		exe = sourceElectron(vscode)
		args = ['.']
		cwd = vscode
		env = { NODE_ENV: 'development', VSCODE_DEV: '1', VSCODE_CLI: '1' }
	} else {
		throw new Error('Say what to run: --installer <Setup.exe>, --exe <Axle.exe> or --source <editor/vscode>')
	}

	if (exe) {
		for (const s of APP_SCENARIOS) {
			if (only && !only.includes(s.id)) {
				continue
			}
			await timed(s.id, s.title, () => withRetries(2, async attempt => {
				const app = await launchAxle({ exe, args, cwd, env, out, folder, settings, extensions: [driver] })
				const ctx = { app, results, folder, setSettings: p => app.setSettings(p) }
				try {
					return await s.run(ctx)
				} catch (e) {
					// The window as it was when it failed is the best evidence there is.
					const page = app.pages().find(p => !p.isClosed())
					await page?.screenshot({ path: join(out, 'shots', `${label}-${s.id}-failed-${attempt}.png`) }).catch(() => undefined)
					throw e
				} finally {
					await app.close()
					collectLogs(app, out, `${s.id}-${attempt}`)
				}
			}, (n, e) => console.log(`  ${s.id}: attempt ${n} failed (${String(e.message).split('\n')[0]}); trying again from a fresh app`)))
		}
	}

	if (installDir && exe && (!only || only.includes('update'))) {
		await timed('update', 'Windows installer: in-app update through AXLE_UPDATE_URL', () => withRetries(2, async attempt => {
			if (attempt > 1) {
				// A half-applied update is not a state to retry on: start from a clean install.
				await uninstall(installDir).catch(() => undefined)
				install(resolve(String(o.installer)), installDir, join(out, `setup-retry-${attempt}.log`))
			}
			const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
			return updateFlow({ setup: resolve(String(o.installer)), dir: installDir, out, label, version, workdir: work })
		}))
	}

	if (installDir && existsSync(installDir) && (!only || only.includes('uninstall'))) {
		await timed('uninstall', 'Windows installer: silent uninstall', async () => {
			await uninstall(installDir)
			return { status: 'pass', detail: 'Axle.exe removed', shots: [] }
		})
	}

	console.log(`\n${results.scenarios.filter(s => s.status === 'pass').length} passed, ${results.scenarios.filter(s => s.status === 'fail').length} failed, ${results.scenarios.filter(s => s.status === 'skip').length} skipped. Results: ${join(out, 'results.json')}`)
	process.exit(results.failed ? 1 : 0)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch(e => {
		console.error(e.stack ?? e.message)
		process.exit(1)
	})
}
