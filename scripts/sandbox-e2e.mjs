#!/usr/bin/env node
// Runs Insilode's desktop end-to-end scenarios (test/e2e-desktop) inside Windows Sandbox, so no Insilode window ever opens on your
// own desktop and nothing touches your Insilode install or profile.
//   npm run sandbox:e2e                           the newest dist/Insilode-Setup-*.exe (npm run installer builds it)
//   npm run sandbox:e2e -- --installer <exe>      another Setup
//   npm run sandbox:e2e -- --old-installer <Axle-Setup-x.exe> [--only upgrade]   also: an Axle install is upgraded by this Setup (lib/upgrade.mjs)
//   npm run sandbox:e2e -- --stage <dir>          only stage the folder the sandbox maps
// What it does: stages the installer, node.exe and the test code into a temp folder, writes a .wsb that maps that folder read-only
// and an output folder read-write (no network), starts Windows Sandbox minimized, waits for <out>/done.json, and prints the
// results and the screenshot paths. Turn Windows Sandbox on once: docs/building.md "Probing and testing the app without taking over your screen".
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, isWin, launchSync } from './lib.mjs'
import { buildWsb, missingSandboxMessage, parseDoneMarker, psQuote, sandboxExe, summarize } from './sandbox-config.mjs'

const E2E = join(ROOT, 'test', 'e2e-desktop')
const WAIT_MINUTES = 45

function fail(message) {
	console.error(`\n\x1b[31m✗ ${message}\x1b[0m`)
	process.exit(1)
}

/** The newest Setup in dist/ (by modification time). */
export function newestInstaller(dist = join(ROOT, 'dist')) {
	if (!existsSync(dist)) {
		return undefined
	}
	const newest = readdirSync(dist).filter(n => /^Insilode-Setup-.*-x64\.exe$/.test(n)).map(n => ({ n, t: statSync(join(dist, n)).mtimeMs })).sort((a, b) => b.t - a.t)[0]
	return newest && join(dist, newest.n)
}

/** Lays out the folder the sandbox maps: installer, node.exe and the test code. */
export function stage(dir, installer, oldInstaller, only) {
	rmSync(dir, { recursive: true, force: true })
	mkdirSync(join(dir, 'installer'), { recursive: true })
	mkdirSync(join(dir, 'node'), { recursive: true })
	cpSync(installer, join(dir, 'installer', installer.split(/[\\/]/).pop()))
	if (oldInstaller) {
		mkdirSync(join(dir, 'installer-old'), { recursive: true })
		cpSync(oldInstaller, join(dir, 'installer-old', oldInstaller.split(/[\\/]/).pop()))
	}
	if (only) {
		writeFileSync(join(dir, 'only.txt'), `${only}
`)
	}
	// The sandbox has no Node: bring the one running this script (a single exe on Windows).
	cpSync(process.execPath, join(dir, 'node', 'node.exe'))
	const repo = join(dir, 'repo')
	mkdirSync(join(repo, '.claude', 'skills', 'probe', 'scripts'), { recursive: true })
	cpSync(join(ROOT, 'package.json'), join(repo, 'package.json'))
	cpSync(join(ROOT, '.claude', 'skills', 'probe', 'scripts', 'demo-workspace.mjs'), join(repo, '.claude', 'skills', 'probe', 'scripts', 'demo-workspace.mjs'))
	if (!existsSync(join(E2E, 'node_modules', 'playwright-core'))) {
		console.log('Installing the test dependencies (playwright-core) on this machine, once…')
		const r = launchSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: E2E, stdio: 'inherit' })
		if (r.status !== 0) {
			fail('npm ci failed in test/e2e-desktop.')
		}
	}
	cpSync(E2E, join(repo, 'test', 'e2e-desktop'), { recursive: true, filter: src => !/[\\/](out|e2e-out)([\\/]|$)/.test(src) })
	return dir
}

async function main() {
	const args = process.argv.slice(2)
	const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
	if (!isWin) {
		fail('Windows Sandbox is a Windows feature. On Linux the desktop scenarios run in Docker: npm run docker:e2e.')
	}
	const installer = flag('--installer') ? resolve(flag('--installer')) : newestInstaller()
	if (!installer || !existsSync(installer)) {
		fail('No Insilode-Setup-*-x64.exe found. Build one with `npm run installer`, or pass --installer <path>.')
	}
	const oldInstaller = flag('--old-installer') ? resolve(flag('--old-installer')) : undefined
	if (oldInstaller && !existsSync(oldInstaller)) {
		fail(`--old-installer ${oldInstaller} does not exist.`)
	}
	if (flag('--stage')) {
		console.log(`Staged ${stage(resolve(flag('--stage')), installer, oldInstaller, flag('--only'))}`)
		return
	}
	const exe = sandboxExe()
	if (!existsSync(exe)) {
		fail(missingSandboxMessage(exe))
	}
	const running = spawnSync('tasklist', ['/FI', 'IMAGENAME eq WindowsSandbox.exe', '/NH'], { encoding: 'utf8' })
	if (/WindowsSandbox\.exe/i.test(running.stdout ?? '')) {
		fail('A Windows Sandbox is already running (Windows allows one at a time). Close it, then run this again.')
	}

	const work = mkdtempSync(join(tmpdir(), 'insilode-sandbox-'))
	const input = stage(join(work, 'in'), installer, oldInstaller, flag('--only'))
	const output = join(work, 'out')
	mkdirSync(output, { recursive: true })
	const wsb = join(work, 'insilode-e2e.wsb')
	writeFileSync(wsb, buildWsb({ inputDir: input, outputDir: output }))
	console.log(`Starting Windows Sandbox (minimized) with ${installer}\n  config  ${wsb}\n  output  ${output}\nThe run takes 10 to 20 minutes; the sandbox closes itself when it is done.`)

	// Minimized, so it does not come to the front over what you are doing. Nothing else of this machine is touched.
	spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath ${psQuote(exe)} -ArgumentList ${psQuote(`"${wsb}"`)} -WindowStyle Minimized`], { stdio: 'ignore', windowsHide: true }).unref()

	const marker = join(output, 'done.json')
	const end = Date.now() + WAIT_MINUTES * 60000
	let done
	while (!(done = existsSync(marker) ? parseDoneMarker(readFileSync(marker, 'utf8')) : undefined)) {
		if (Date.now() > end) {
			fail(`No result after ${WAIT_MINUTES} minutes. Look at ${join(output, 'sandbox.log')} (if it exists) and close the sandbox window.`)
		}
		await new Promise(r => setTimeout(r, 5000))
	}
	const resultsFile = join(output, 'results.json')
	if (!existsSync(resultsFile)) {
		fail(`The sandbox finished (exit code ${done.exitCode}) without results. Its log: ${join(output, 'sandbox.log')}`)
	}
	console.log(`\n${summarize(JSON.parse(readFileSync(resultsFile, 'utf8')), output)}\n\nEverything is in ${output}`)
	process.exit(done.exitCode === 0 ? 0 : 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main().catch(e => fail(e.stack ?? e.message))
}
