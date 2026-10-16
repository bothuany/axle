#!/usr/bin/env node
// Sets up Axle on macOS, Linux or Windows:
//   1. clones VS Code at the version Axle is built on (editor/vscode),
//   2. applies Axle's core patches,
//   3. links the Axle extensions into it,
//   4. installs and builds everything (editor, extensions, canvas, analyzer).
// Safe to run again: the clone, the patches and the links are skipped when done, and so is the editor's `npm ci`
// when its dependencies have not changed (`--force-install` runs it anyway, `--skip-editor-install` never runs it).

import { copyFileSync, cpSync, existsSync, lstatSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { EXTENSIONS, ROOT, VSCODE, buildableExtensions, isWin, launchSync } from './lib.mjs'

const VSCODE_TAG = '1.141.0'
/** What editor/vscode/.nvmrc asks for at VS Code 1.141: the same major, at least this minor. */
const NODE = { major: 24, minor: 18 }
const PATCHES = join(ROOT, 'editor', 'patches')
const args = new Set(process.argv.slice(2))

function step(title) {
	console.log(`\n\x1b[1m▸ ${title}\x1b[0m`)
}

/** Optional steps that failed, and what that costs: said again at the end, where a warning from the middle of the log is long gone. */
const skipped = []

function run(cmd, cmdArgs, cwd = ROOT, { optional = false, consequence = '', hint = '' } = {}) {
	console.log(`  $ ${cmd} ${cmdArgs.join(' ')}${cwd !== ROOT ? `   (in ${cwd.replace(ROOT, '.')})` : ''}`)
	const r = launchSync(cmd, cmdArgs, { cwd, stdio: 'inherit' })
	if (r.status !== 0) {
		if (optional) {
			console.warn(`  ! ${cmd} failed; continuing without it.`)
			skipped.push(`${cmd} ${cmdArgs.join(' ')}${consequence ? `: ${consequence}` : ''}`)
			return false
		}
		console.error(`\n✗ ${cmd} ${cmdArgs.join(' ')} failed.`)
		if (hint) {
			console.error(hint)
		}
		process.exit(r.status ?? 1)
	}
	return true
}

function has(cmd, versionArg = '--version') {
	return launchSync(cmd, [versionArg], { stdio: 'ignore' }).status === 0
}

/** `npm ci` where there is a lockfile (what the lockfile says, nothing newer), `npm install` where there is not. */
function installDependencies(dir) {
	const locked = existsSync(join(dir, 'package-lock.json'))
	run('npm', [locked ? 'ci' : 'install', '--no-audit', '--no-fund'], dir)
}

/** The editor's dependencies are in place when npm's own record of them is newer than the lockfile. */
function editorInstalled() {
	try {
		return statSync(join(VSCODE, 'node_modules', '.package-lock.json')).mtimeMs >= statSync(join(VSCODE, 'package-lock.json')).mtimeMs
	} catch {
		return false
	}
}

function isLink(p) {
	try {
		return lstatSync(p).isSymbolicLink()
	} catch {
		return false
	}
}

/** Copies editor/branding/* over VS Code's icons and, on Windows, stamps the icon into the dev Electron binary. */
function applyBranding() {
	const brand = join(ROOT, 'editor', 'branding')
	const copies = [['icon.ico', 'win32/code.ico'], ['icon.icns', 'darwin/code.icns'], ['icon.png', 'linux/code.png']]
	for (const [from, to] of copies) {
		if (existsSync(join(brand, from))) {
			copyFileSync(join(brand, from), join(VSCODE, 'resources', to))
		}
	}
	if (isWin) {
		const exe = join(VSCODE, '.build', 'electron', 'Axle.exe')
		const rcedit = join(VSCODE, 'node_modules', 'rcedit', 'bin', 'rcedit.exe')
		if (existsSync(exe) && existsSync(rcedit)) {
			run(rcedit, [exe, '--set-icon', join(brand, 'icon.ico')], ROOT, { optional: true, consequence: 'the dev window keeps the stock VS Code icon' })
		}
	}
}

// ── prerequisites ────────────────────────────────────────────────────────────
step('Checking tools')
const [major, minor] = process.versions.node.split('.').map(Number)
if (major !== NODE.major || minor < NODE.minor) {
	console.error(`Node ${process.versions.node} will not do: VS Code ${VSCODE_TAG} needs Node ${NODE.major}.${NODE.minor} or a newer ${NODE.major}.x.`)
	process.exit(1)
}
if (!has('git')) {
	console.error('git is required.')
	process.exit(1)
}
const sdks = launchSync('dotnet', ['--list-sdks'], { encoding: 'utf8' }).stdout ?? ''
const dotnet = sdks.split(/\r?\n/).some(line => Number.parseInt(line, 10) >= 10)
console.log(`  node ${process.versions.node} · git ✓ · dotnet ${dotnet ? '✓' : '✗ (C# flows disabled: install the .NET 10 SDK)'}`)
if (isWin) {
	console.log('  Windows: VS Code\'s native modules need Python 3 and the "Desktop development with C++" workload of Visual Studio Build Tools, with its "MSVC Spectre-mitigated libs".')
}

// ── 1. VS Code ───────────────────────────────────────────────────────────────
step(`VS Code ${VSCODE_TAG}`)
if (!existsSync(join(VSCODE, 'package.json'))) {
	run('git', ['clone', '--depth', '1', '--branch', VSCODE_TAG, 'https://github.com/microsoft/vscode.git', VSCODE])
} else {
	// A checkout of another version would take the patches wrongly or not at all: say so instead of building on it.
	const described = launchSync('git', ['describe', '--tags'], { cwd: VSCODE, encoding: 'utf8' })
	const have = described.status === 0 ? described.stdout.trim() : 'an unknown version'
	if (have !== VSCODE_TAG) {
		console.error(`editor/vscode is at ${have}, but Axle is built on VS Code ${VSCODE_TAG}.`)
		console.error('Delete editor/vscode (after saving any changes you made there) and run setup again to clone the right version.')
		process.exit(1)
	}
	console.log(`  already cloned (${have})`)
}

// ── 2. patches ───────────────────────────────────────────────────────────────
step('Applying Axle patches')
for (const patch of readdirSync(PATCHES).filter(f => f.endsWith('.patch')).sort()) {
	const file = join(PATCHES, patch)
	const applied = launchSync('git', ['apply', '--reverse', '--check', file], { cwd: VSCODE, stdio: 'ignore' }).status === 0
	if (applied) {
		console.log(`  ${patch}: already applied`)
	} else {
		// An Axle checkout from before .gitattributes kept patches LF can still hold one with CRLF line endings, which
		// git apply rejects: deleting editor/vscode would not help there.
		const crlf = readFileSync(file, 'utf8').includes('\r\n')
		run('git', ['apply', '--whitespace=nowarn', file], VSCODE, {
			hint: crlf
				? `${patch} has CRLF line endings, which git apply rejects. Restore it as LF (delete editor/patches/${patch}, then run git checkout -- editor/patches/${patch}) and run setup again.`
				: `${patch} does not apply to editor/vscode: it was probably changed by hand, or an earlier setup stopped half way. Delete editor/vscode and run setup again for a clean checkout.`,
		})
	}
}

// ── 3. extensions ────────────────────────────────────────────────────────────
step('Linking Axle extensions')
for (const name of readdirSync(EXTENSIONS).filter(n => n.startsWith('flow-'))) {
	const target = join(VSCODE, 'extensions', name)
	if (isLink(target)) {
		console.log(`  ${name}: linked`)
		continue
	}
	if (existsSync(target)) {
		// What an earlier run copied when linking was not possible: it does not follow edits, so it is refreshed.
		rmSync(target, { recursive: true, force: true })
		cpSync(join(EXTENSIONS, name), target, { recursive: true })
		console.log(`  ${name}: copy refreshed (a copy, not a link: run setup again after editing it)`)
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

// ── 4. install and build ─────────────────────────────────────────────────────
if (args.has('--skip-editor-install')) {
	console.log('\nSkipping the editor install (--skip-editor-install)')
} else if (editorInstalled() && !args.has('--force-install')) {
	console.log('\nThe editor\'s dependencies are up to date (--force-install installs them again)')
} else {
	step('Installing the editor (first time: 10–20 minutes)')
	run('npm', ['ci'], VSCODE)
}
step('Compiling the editor')
run('npm', ['run', 'transpile-client'], VSCODE)
// The icon font (without it every UI icon renders as an empty box) and the built-in extensions (git, emmet, the
// language features: without them the editor logs activation errors). `gulp copy-codicons` is part of this task.
run('npm', ['run', 'build-fast-extensions'], VSCODE)
// Electron and the server's Node, the same way scripts/code-server.sh prepares them.
run('node', ['build/lib/preLaunch.ts'], VSCODE, { optional: true, consequence: 'npm start fetches Electron on its first launch instead' })
run('npm', ['run', 'gulp', 'node'], VSCODE, { optional: true, consequence: 'npm run web falls back to the Node that runs it' })

step('Applying the Axle app icon')
applyBranding()

step('Building the Axle extensions')
for (const name of buildableExtensions()) {
	const dir = join(EXTENSIONS, name)
	installDependencies(dir)
	run('node', ['esbuild.mjs'], dir)
}

step('Building the canvas')
installDependencies(join(ROOT, 'ui'))
run('npm', ['run', 'build'], join(ROOT, 'ui'))

if (dotnet) {
	step('Building the C# analyzer')
	run('dotnet', ['build', join(ROOT, 'analyzer'), '-nologo', '-v', 'q'], ROOT, { optional: true, consequence: 'C# flows are unavailable' })
} else {
	skipped.push('the C# analyzer was not built, so C# flows are unavailable (install the .NET 10 SDK and run setup again)')
}

// Old builds of a removed extension would linger in the editor: drop dangling links.
for (const name of readdirSync(join(VSCODE, 'extensions')).filter(n => n.startsWith('flow-'))) {
	if (!existsSync(join(EXTENSIONS, name))) {
		rmSync(join(VSCODE, 'extensions', name), { recursive: true, force: true })
	}
}

if (skipped.length) {
	console.log(`\n\x1b[33m! Axle is built, but ${skipped.length} optional ${skipped.length === 1 ? 'step' : 'steps'} did not run:\x1b[0m`)
	for (const what of skipped) {
		console.log(`  - ${what}`)
	}
	console.log('  Start it with \x1b[1mnpm start\x1b[0m.')
} else {
	console.log(`\n\x1b[32m✓ Axle is ready.\x1b[0m  Start it with \x1b[1mnpm start\x1b[0m.`)
}
