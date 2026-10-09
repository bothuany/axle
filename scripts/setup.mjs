#!/usr/bin/env node
// Sets up Flow on macOS, Linux or Windows:
//   1. clones VS Code at the version Flow is built on (editor/vscode),
//   2. applies Flow's core patches,
//   3. links the Flow extensions into it,
//   4. installs and builds everything (editor, extensions, canvas, analyzer, desktop shell).
// Safe to run again: finished steps are skipped. `npm run setup -- --skip-editor-install` skips step 4's slow part.

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VSCODE_TAG = '1.141.0'
const VSCODE = join(ROOT, 'editor', 'vscode')
const EXTENSIONS = join(ROOT, 'editor', 'extensions')
const PATCHES = join(ROOT, 'editor', 'patches')
const isWin = process.platform === 'win32'
const args = new Set(process.argv.slice(2))

function step(title) {
	console.log(`\n\x1b[1m▸ ${title}\x1b[0m`)
}

function run(cmd, cmdArgs, cwd = ROOT, { optional = false } = {}) {
	console.log(`  $ ${cmd} ${cmdArgs.join(' ')}${cwd !== ROOT ? `   (in ${cwd.replace(ROOT, '.')})` : ''}`)
	// npm/npx are .cmd shims on Windows and need a shell.
	const r = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', shell: isWin })
	if (r.status !== 0) {
		if (optional) {
			console.warn(`  ! ${cmd} failed; continuing without it.`)
			return false
		}
		console.error(`\n✗ ${cmd} ${cmdArgs.join(' ')} failed.`)
		process.exit(r.status ?? 1)
	}
	return true
}

function has(cmd, versionArg = '--version') {
	return spawnSync(cmd, [versionArg], { stdio: 'ignore', shell: isWin }).status === 0
}

// ── prerequisites ────────────────────────────────────────────────────────────
step('Checking tools')
const major = Number(process.versions.node.split('.')[0])
if (major < 22) {
	console.error(`Node ${process.versions.node} is too old: VS Code ${VSCODE_TAG} needs Node 22 or newer (24 recommended).`)
	process.exit(1)
}
if (!has('git')) {
	console.error('git is required.')
	process.exit(1)
}
const dotnet = has('dotnet')
const cargo = has('cargo')
console.log(`  node ${process.versions.node} · git ✓ · dotnet ${dotnet ? '✓' : '✗ (C# flows disabled)'} · cargo ${cargo ? '✓' : '✗ (desktop shell disabled; use `npm run web`)'}`)
if (isWin) {
	console.log('  Windows: VS Code\'s native modules need Python 3 and the "Desktop development with C++" workload of Visual Studio Build Tools.')
}

// ── 1. VS Code ───────────────────────────────────────────────────────────────
step(`VS Code ${VSCODE_TAG}`)
if (!existsSync(join(VSCODE, 'package.json'))) {
	run('git', ['clone', '--depth', '1', '--branch', VSCODE_TAG, 'https://github.com/microsoft/vscode.git', VSCODE])
} else {
	console.log('  already cloned')
}

// ── 2. patches ───────────────────────────────────────────────────────────────
step('Applying Flow patches')
for (const patch of readdirSync(PATCHES).filter(f => f.endsWith('.patch')).sort()) {
	const file = join(PATCHES, patch)
	const applied = spawnSync('git', ['apply', '--reverse', '--check', file], { cwd: VSCODE, stdio: 'ignore' }).status === 0
	if (applied) {
		console.log(`  ${patch}: already applied`)
	} else {
		run('git', ['apply', '--whitespace=nowarn', file], VSCODE)
	}
}

// ── 3. extensions ────────────────────────────────────────────────────────────
step('Linking Flow extensions')
for (const name of readdirSync(EXTENSIONS).filter(n => n.startsWith('flow-'))) {
	const target = join(VSCODE, 'extensions', name)
	if (existsSync(target) || isLink(target)) {
		console.log(`  ${name}: linked`)
		continue
	}
	try {
		// A junction needs no admin rights on Windows; elsewhere a plain directory symlink.
		symlinkSync(join(EXTENSIONS, name), target, isWin ? 'junction' : 'dir')
		console.log(`  ${name} → editor/vscode/extensions/${name}`)
	} catch (e) {
		console.warn(`  could not link ${name} (${e.message}); copying instead. Run setup again after editing it.`)
		cpSync(join(EXTENSIONS, name), target, { recursive: true })
	}
}

function isLink(p) {
	try {
		return lstatSync(p).isSymbolicLink()
	} catch {
		return false
	}
}

// ── 4. install and build ─────────────────────────────────────────────────────
if (!args.has('--skip-editor-install')) {
	step('Installing the editor (first time: 10–20 minutes)')
	run('npm', ['ci'], VSCODE)
}
step('Compiling the editor')
run('npm', ['run', 'transpile-client'], VSCODE)
// Built-in extensions and Node for the server, the same way scripts/code-server.sh prepares them.
run('node', ['build/lib/preLaunch.ts'], VSCODE, { optional: true })
run('npm', ['run', 'gulp', 'node'], VSCODE, { optional: true })

step('Building the Flow extensions')
for (const name of ['flow-view', 'flow-agent', 'flow-harness']) {
	const dir = join(EXTENSIONS, name)
	run('npm', ['install', '--no-audit', '--no-fund'], dir)
	run('node', ['esbuild.mjs'], dir)
}

step('Building the canvas')
run('npm', ['install', '--no-audit', '--no-fund'], join(ROOT, 'ui'))
run('npm', ['run', 'build'], join(ROOT, 'ui'))

if (dotnet) {
	step('Building the C# analyzer')
	run('dotnet', ['build', join(ROOT, 'analyzer'), '-nologo', '-v', 'q'], ROOT, { optional: true })
}

if (cargo) {
	step('Installing the desktop shell')
	run('npm', ['install', '--no-audit', '--no-fund'], join(ROOT, 'desktop'))
}

// Old builds of a removed extension would linger in the editor: drop dangling links.
for (const name of readdirSync(join(VSCODE, 'extensions')).filter(n => n.startsWith('flow-'))) {
	if (!existsSync(join(EXTENSIONS, name))) {
		rmSync(join(VSCODE, 'extensions', name), { recursive: true, force: true })
	}
}

console.log(`\n\x1b[32m✓ Flow is ready.\x1b[0m  Start it with \x1b[1mnpm start\x1b[0m${cargo ? '' : ' (or `npm run web` for the browser)'}.`)
