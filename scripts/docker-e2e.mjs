#!/usr/bin/env node
// Runs Insilode's desktop end-to-end scenarios, or one probe script, inside a Docker container: Insilode from source on a virtual display
// (xvfb), so nothing opens on your screen, takes your pointer or shares your network ports.
//   npm run docker:e2e                                   the desktop scenarios (test/e2e-desktop) on the working tree
//   npm run docker:e2e -- --scenario island,canvas-tour  only these
//   npm run docker:e2e -- --probe my-probe.mjs [args]    a Playwright script: see test/e2e-desktop/lib/probe.mjs
//   options: --out <dir>  --reset-volume (throw the VS Code build away)  --rebuild-image
// The first run builds the image and the VS Code checkout (20 to 40 minutes); the checkout lives in the named volume
// insilode-e2e-work, so later runs take minutes. Screenshots, results.json and logs go to the output folder, which is printed.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT } from './lib.mjs'
import { WORK_VOLUME, dockerMissingMessage, dockerRunArgs, imageTag } from './docker-config.mjs'
import { summarize } from './sandbox-config.mjs'

const DOCKER_DIR = join(ROOT, 'test', 'e2e-desktop', 'docker')

function fail(message) {
	console.error(`\n\x1b[31m✗ ${message}\x1b[0m`)
	process.exit(1)
}

const docker = args => spawnSync('docker', args, { encoding: 'utf8' })

/** The files a run takes from the working tree: tracked and new ones, not ignored ones, so uncommitted work is tested too. */
export function sourceFiles(root = ROOT) {
	const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 })
	if (r.status !== 0) {
		throw new Error(`git ls-files failed: ${r.stderr}`)
	}
	// A tracked file that was deleted in the working tree is still listed.
	return r.stdout.split('\0').filter(f => f && existsSync(join(root, f)))
}

function parse(argv) {
	const o = {}
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		if (a === '--probe') {
			o.probe = argv[++i]
			o.rest = argv.slice(i + 1)
			break
		}
		if (a === '--scenario') {
			o.scenario = argv[++i]
		} else if (a === '--out') {
			o.out = argv[++i]
		} else if (a === '--reset-volume' || a === '--rebuild-image') {
			o[a.slice(2)] = true
		} else {
			fail(`Unknown option ${a}. See the top of scripts/docker-e2e.mjs.`)
		}
	}
	return o
}

async function main() {
	const o = parse(process.argv.slice(2))
	const info = docker(['info', '--format', '{{.OSType}}'])
	if (info.error || info.status !== 0) {
		fail(dockerMissingMessage(info.error?.message ?? (info.stderr.trim().split('\n').pop() || 'the engine does not answer')))
	}
	if (info.stdout.trim() !== 'linux') {
		fail('Docker is set to Windows containers. Switch Docker Desktop to Linux containers.')
	}
	if (o.probe && !existsSync(o.probe)) {
		fail(`No such probe script: ${o.probe}`)
	}

	const image = imageTag(readFileSync(join(DOCKER_DIR, 'Dockerfile')), readFileSync(join(DOCKER_DIR, 'entrypoint.sh')))
	if (o['rebuild-image'] || docker(['image', 'inspect', image]).status !== 0) {
		console.log(`Building ${image} (once; the toolchain only, a few minutes)...`)
		const build = spawnSync('docker', ['build', '-t', image, DOCKER_DIR], { stdio: 'inherit' })
		if (build.status !== 0) {
			fail('docker build failed.')
		}
	}
	if (o['reset-volume']) {
		docker(['volume', 'rm', '-f', WORK_VOLUME])
	}

	const work = mkdtempSync(join(tmpdir(), 'insilode-docker-e2e-'))
	const ctl = join(work, 'ctl')
	mkdirSync(ctl)
	writeFileSync(join(ctl, 'files'), sourceFiles().join('\0'))
	const out = resolve(o.out ?? join(work, 'out'))
	mkdirSync(out, { recursive: true })

	const modeArgs = o.probe ? [basename(o.probe), ...o.rest] : o.scenario ? ['--only', o.scenario] : []
	const args = dockerRunArgs({
		image, name: `insilode-e2e-${Date.now()}`, repo: ROOT, ctl, out, mode: o.probe ? 'probe' : 'run', modeArgs,
		probeDir: o.probe ? dirname(resolve(o.probe)) : undefined,
	})
	console.log(`Running in Docker (no ports, display or input shared with this machine)\n  output  ${out}`)
	const child = spawn('docker', args, { stdio: 'inherit' })
	const code = await new Promise(done => child.on('exit', c => done(c ?? 1)))

	const results = join(out, 'results.json')
	if (existsSync(results)) {
		console.log(`\n${summarize(JSON.parse(readFileSync(results, 'utf8')), out)}`)
	}
	console.log(`\nEverything is in ${out}`)
	process.exit(code)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main().catch(e => fail(e.stack ?? e.message))
}
