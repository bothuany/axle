// The Windows installer scenarios: silent install, the in-app update against a local static server, uninstall.
// The update server is the one packaging/README.md describes: a folder of `update-win32-x64-user-axle.json` plus the Setup
// exe it points at, served from 127.0.0.1 and found through AXLE_UPDATE_URL.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { launchAxle, sleep, until } from './app.mjs'
import { runCommand, shot } from './ui.mjs'

/** Inno Setup's command line for a silent per-user install: no dialogs, no restart, no "launch Axle" at the end. */
export function installArgs(dir, log) {
	return ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', `/DIR=${dir}`, `/LOG=${log}`, '/MERGETASKS=!runcode']
}

/** The update file for the Windows per-user build: what scripts/update-manifests.mjs writes, pointing at a local server. */
export function updateManifest({ url, file, version, sha256hash, timestamp = Date.now() }) {
	return { url: `${url}/${basename(file)}`, name: `Axle ${version}`, version: 'e2e-update-commit', productVersion: version, sha256hash, timestamp }
}

const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex')

function run(exe, args, ms = 300000) {
	const r = spawnSync(exe, args, { timeout: ms, encoding: 'utf8' })
	if (r.error) {
		throw new Error(`${basename(exe)} ${args[0]}: ${r.error.message}`)
	}
	return r
}

/** Installs silently into `dir`; returns the installed Axle.exe. Throws with the tail of Inno's log when it fails. */
export function install(setup, dir, log) {
	mkdirSync(join(dir, '..'), { recursive: true })
	const r = run(setup, installArgs(dir, log))
	const exe = join(dir, 'Axle.exe')
	if (r.status !== 0 || !existsSync(exe)) {
		const tail = existsSync(log) ? readFileSync(log, 'utf8').split('\n').slice(-15).join('\n') : '(no log)'
		throw new Error(`Setup exited with ${r.status} and ${existsSync(exe) ? 'left' : 'did not create'} ${exe}.\n${tail}`)
	}
	return exe
}

/** Silent uninstall; resolves when the install folder's Axle.exe is gone. */
export async function uninstall(dir) {
	const unins = readdirSync(dir).find(n => /^unins\d+\.exe$/i.test(n))
	if (!unins) {
		throw new Error(`No uninstaller (unins000.exe) in ${dir}`)
	}
	run(join(dir, unins), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], 120000)
	// Inno's uninstaller copies itself to %TEMP% and returns at once: wait for the files to go.
	await until('the install folder to be emptied', () => !existsSync(join(dir, 'Axle.exe')), { ms: 120000, every: 1000 })
}

const productJson = dir => join(dir, 'resources', 'app', 'product.json')

/** Starts the static update server; `log` collects the paths it was asked for, which is the evidence of detect and download. */
export function updateServer(folder) {
	const log = []
	const server = createServer((req, res) => {
		const path = decodeURIComponent((req.url ?? '/').split('?')[0])
		log.push(path)
		const file = join(folder, basename(path))
		if (!existsSync(file) || !statSync(file).isFile()) {
			res.writeHead(404).end()
			return
		}
		res.writeHead(200, { 'content-type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'content-length': statSync(file).size })
		createReadStream(file).pipe(res)
	})
	return new Promise(done => server.listen(0, '127.0.0.1', () => done({ port: server.address().port, log, close: () => server.close() })))
}

/** Processes named Axle.exe that run from `dir` (a leftover from a failed run must not satisfy "relaunched"). */
function axlePids(dir) {
	const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-Process Axle -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${join(dir, '*').replace(/'/g, "''")}' } | ForEach-Object { $_.Id }`], { encoding: 'utf8' })
	return r.stdout.split(/\s+/).filter(Boolean).map(Number)
}

/**
 * detect -> download -> ready -> Update -> relaunch on the new version.
 * The installed build is made to look old (product.json says 0.0.1), the update file offers the real version, and the "new"
 * build is the Setup exe itself: after the relaunch product.json is the real one again, which a copy of the old build cannot fake.
 */
export async function updateFlow({ setup, dir, out, label, version, workdir }) {
	const results = { out, label }
	const serve = join(workdir, 'update-site')
	mkdirSync(serve, { recursive: true })
	const copy = spawnSync('cmd.exe', ['/d', '/c', 'copy', '/y', setup, join(serve, basename(setup))], { encoding: 'utf8' })
	if (copy.status !== 0) {
		throw new Error(`Could not stage ${setup}: ${copy.stderr || copy.stdout}`)
	}
	const server = await updateServer(serve)
	const base = `http://127.0.0.1:${server.port}`
	writeFileSync(join(serve, 'update-win32-x64-user-axle.json'), JSON.stringify(updateManifest({ url: base, file: setup, version, sha256hash: sha256(setup) })))
	const product = JSON.parse(readFileSync(productJson(dir), 'utf8'))
	const real = product.axleVersion
	writeFileSync(productJson(dir), JSON.stringify({ ...product, axleVersion: '0.0.1' }))
	const stages = []
	const app = await launchAxle({ exe: join(dir, 'Axle.exe'), out, updates: true, env: { AXLE_UPDATE_URL: base }, settings: { 'update.mode': 'manual' } })
	try {
		const page = await app.workbench()
		const before = axlePids(dir)
		await runCommand(page, 'Check for Updates')
		await until('the update file to be requested', () => server.log.some(p => p.endsWith('update-win32-x64-user-axle.json')), { ms: 60000 })
		stages.push('detect')
		// Whatever the update service offers next, in the order a person would click: download, install, restart.
		const next = ['Download Update', 'Install Update', 'Restart to Update', 'Update Now']
		await until('the update to be downloaded', async () => {
			if (server.log.some(p => p.endsWith(basename(setup)))) {
				return true
			}
			for (const title of next) {
				if (await tryCommand(page, title)) {
					break
				}
			}
			return false
		}, { ms: 180000, every: 2000 })
		stages.push('download')
		await shot(page, results, 'update-downloading')
		await until('"Restart to Update" to be offered', async () => (await paletteHas(page, 'Restart to Update')), { ms: 300000, every: 3000 })
		stages.push('ready')
		await shot(page, results, 'update-ready')
		await tryCommand(page, 'Restart to Update')
		stages.push('update')
		await until('Axle to quit and start again from the same folder', () => {
			const now = axlePids(dir)
			return now.length > 0 && now.every(p => !before.includes(p))
		}, { ms: 300000, every: 2000 })
		stages.push('relaunch')
		await sleep(8000)
		const now = JSON.parse(readFileSync(productJson(dir), 'utf8')).axleVersion
		if (now !== real) {
			throw new Error(`After the update product.json says ${now}, not ${real} (stages seen: ${stages.join(' > ')})`)
		}
		stages.push(`on ${now}`)
	} catch (e) {
		e.message += `\nStages seen: ${stages.join(' > ') || 'none'}. Update server was asked for: ${server.log.join(', ') || 'nothing'}.`
		throw e
	} finally {
		server.close()
		await app.close()
		// The relaunched Axle is not ours to hold: stop it so the uninstall can remove its files.
		for (const pid of axlePids(dir)) {
			spawnSync('taskkill', ['/F', '/PID', String(pid)])
		}
	}
	return { status: 'pass', detail: stages.join(' > '), shots: ['update-downloading', 'update-ready'].map(n => `shots/${label}-${n}.png`) }
}

async function paletteHas(page, title) {
	await page.keyboard.press('Control+Shift+P')
	const input = page.locator('.quick-input-widget .quick-input-box input')
	await input.waitFor({ state: 'visible', timeout: 15000 })
	await input.fill(`>${title}`)
	await sleep(600)
	const rows = await page.locator('.quick-input-list .monaco-list-row').allInnerTexts()
	const found = rows.some(r => r.toLowerCase().includes(title.toLowerCase()))
	await page.keyboard.press('Escape')
	return found
}

/** Runs the command when the palette offers it right now; leaves the palette closed either way. */
async function tryCommand(page, title) {
	if (!await paletteHas(page, title)) {
		return false
	}
	await runCommand(page, title)
	return true
}
