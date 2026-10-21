#!/usr/bin/env node
// Builds Insilode's Windows installer: dist/Insilode-Setup-<version>-x64.exe, one file an end user runs to install Insilode
// (no repository, Node or Visual Studio build tools needed on their PC).
//   npm run installer                 per-user installer (no admin rights)
//   npm run installer -- --system     also the system-wide one (dist/Insilode-Setup-<version>-x64-system.exe)
//   npm run installer -- --system-only
//   npm run installer -- --fast       reuse editor/VSCode-win32-x64 from the last full build, if nothing it was built from has
//                                     changed (VS Code's version, Insilode's core patch, product.json, the icon: a stamp says so).
//                                     Only Insilode's own parts and the Inno Setup step are redone: minutes, not half an hour.
//                                     Without a matching stamp it says so and does the full build.
//   npm run installer -- --full       the full build, whatever the stamp says (this is also the default)
// What it does:
//   1. checks that `npm run setup` was done,
//   2. builds the Insilode extensions, the canvas and the C# analyzer (a framework-dependent Release publish),
//   3. runs VS Code's own production build (gulp vscode-win32-x64-min) into editor/VSCode-win32-x64,
//   4. replaces the Insilode extensions in that app by real, trimmed copies and puts the analyzer and the canvas next to
//      flow-view's code (extensions/flow-view/analyzer, extensions/flow-view/ui/dist-webview: where flowRoot() finds them),
//   5. runs VS Code's Inno Setup step on the result and copies the installer to dist/.
// It needs what `npm run setup` needs (Windows: Python 3, Visual Studio Build Tools with the Spectre-mitigated libs), plus
// the .NET 10 SDK, the Windows SDK's signtool.exe (VS Code's build calls it) and about 20 GB of disk and 8 GB of RAM.

import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { EXTENSIONS, ROOT, VSCODE, buildableExtensions, isWin, launchSync } from './lib.mjs'

const args = new Set(process.argv.slice(2))
const KNOWN = ['--system', '--system-only', '--fast', '--full']
const unknown = [...args].filter(a => !KNOWN.includes(a))
if (unknown.length) {
	console.error(`Unknown option ${unknown.join(', ')}. Options: ${KNOWN.join(', ')}.`)
	process.exit(1)
}
if (args.has('--fast') && args.has('--full')) {
	console.error('--fast and --full contradict each other.')
	process.exit(1)
}
const targets = args.has('--system-only') ? ['system'] : args.has('--system') ? ['user', 'system'] : ['user']
const ARCH = 'x64'
const APP = join(ROOT, 'editor', `VSCode-win32-${ARCH}`)
const DIST = join(ROOT, 'dist')
const STAGE = join(DIST, 'stage')
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

function step(title) {
	console.log(`\n\x1b[1m▸ ${title}\x1b[0m`)
}

function fail(message) {
	console.error(`\n\x1b[31m✗ ${message}\x1b[0m`)
	process.exit(1)
}

function run(cmd, cmdArgs, cwd = ROOT, { hint = '', env } = {}) {
	console.log(`  $ ${cmd} ${cmdArgs.join(' ')}${cwd !== ROOT ? `   (in ${cwd.replace(ROOT, '.')})` : ''}`)
	const r = launchSync(cmd, cmdArgs, { cwd, stdio: 'inherit', env: env ?? process.env })
	if (r.error) {
		fail(`Could not start ${cmd}: ${r.error.message}`)
	}
	if (r.status !== 0) {
		fail(`${cmd} ${cmdArgs.join(' ')} failed.${hint ? `\n${hint}` : ''}`)
	}
}

const mb = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const readJson = file => JSON.parse(readFileSync(file, 'utf8'))

// ── prerequisites ────────────────────────────────────────────────────────────
step('Checking')
if (!isWin) {
	fail('The installer is a Windows .exe: build it on Windows.')
}
const nvmrc = readFileSync(join(VSCODE, '.nvmrc'), 'utf8').trim().replace(/^v/, '')
const [needMajor, needMinor] = nvmrc.split('.').map(Number)
const [major, minor] = process.versions.node.split('.').map(Number)
if (major !== needMajor || minor < needMinor) {
	fail(`Node ${process.versions.node} will not do: the VS Code build needs Node ${needMajor}.${needMinor} or a newer ${needMajor}.x (switch with nvm or fnm, then run this again).`)
}
if (!existsSync(join(VSCODE, 'node_modules', '.package-lock.json'))) {
	fail('Insilode is not set up yet: run `npm run setup` first (it fetches and builds VS Code, which the installer packages).')
}
const patched = ['flow-core.patch', 'flow-update.patch'].every(patch => launchSync('git', ['apply', '--reverse', '--check', join(ROOT, 'editor', 'patches', patch)], { cwd: VSCODE, stdio: 'ignore' }).status === 0)
if (!patched) {
	fail('editor/vscode does not carry Insilode\'s patches (or has other changes to the same files): run `npm run setup`, or delete editor/vscode and run it again.')
}
const product = readJson(join(VSCODE, 'product.json'))
if (product.win32VersionedUpdate) {
	fail('product.json sets win32VersionedUpdate: the installer script assumes the app lives in resources/app, not in a commit-named folder.')
}
const iscc = join(VSCODE, 'node_modules', 'innosetup', 'bin', 'ISCC.exe')
if (!existsSync(iscc)) {
	fail('Inno Setup is missing from editor/vscode/node_modules (the "innosetup" package): run `npm run setup -- --force-install`.')
}
const sdks = launchSync('dotnet', ['--list-sdks'], { encoding: 'utf8' })
if (sdks.error || !(sdks.stdout ?? '').split(/\r?\n/).some(line => Number.parseInt(line, 10) >= 10)) {
	fail('The .NET 10 SDK is required to publish the C# analyzer: install it from https://dotnet.microsoft.com/download/dotnet/10.0')
}

/** VS Code's build runs signtool.exe (to strip signatures before it stamps version info): it comes with the Windows SDK, which is rarely on PATH. */
function withSigntool(env) {
	const onPath = (env.PATH ?? env.Path ?? '').split(';').some(dir => dir && existsSync(join(dir, 'signtool.exe')))
	if (onPath) {
		return env
	}
	const kits = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin')
	const versions = existsSync(kits) ? readdirSync(kits).filter(v => existsSync(join(kits, v, 'x64', 'signtool.exe'))).sort() : []
	if (!versions.length) {
		fail('signtool.exe was not found: install the "Windows SDK" component of Visual Studio Build Tools (VS Code\'s build calls it).')
	}
	const dir = join(kits, versions.at(-1), 'x64')
	console.log(`  signtool: ${dir}`)
	// Windows variable names are case-insensitive, but a JS object's keys are not: replace the one that exists.
	const key = Object.keys(env).find(k => k.toLowerCase() === 'path') ?? 'PATH'
	return { ...env, [key]: `${dir};${env[key] ?? ''}` }
}
const buildEnv = withSigntool(process.env)
console.log(`  node ${process.versions.node} · .NET SDK ✓ · Inno Setup ✓ · Insilode ${version}${args.has('--fast') ? ' · --fast' : ''}`)

/** `gulp <task>` of the VS Code checkout, with the heap its build asks for (what `npm run gulp` runs). */
function gulp(task) {
	run('node', ['--experimental-strip-types', '--max-old-space-size=8192', join('node_modules', 'gulp', 'bin', 'gulp.js'), task], VSCODE, {
		env: buildEnv,
		hint: 'This is VS Code\'s own build: the error above comes from it. A download that failed (Electron, built-in extensions) is worth running again.',
	})
}

function installDependencies(dir) {
	if (!existsSync(join(dir, 'node_modules'))) {
		run('npm', [existsSync(join(dir, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund'], dir)
	}
}

// ── Insilode's own parts ─────────────────────────────────────────────────────────
step('Building the Insilode extensions')
for (const name of buildableExtensions()) {
	const dir = join(EXTENSIONS, name)
	installDependencies(dir)
	run('node', ['esbuild.mjs'], dir)
}

step('Building the canvas')
installDependencies(join(ROOT, 'ui'))
run('npm', ['run', 'build'], join(ROOT, 'ui'))
const canvas = join(ROOT, 'ui', 'dist-webview')
if (!existsSync(join(canvas, 'webview.js')) || !existsSync(join(canvas, 'board.js'))) {
	fail('ui/dist-webview/webview.js or board.js was not built.')
}

step('Publishing the C# analyzer (framework-dependent, Release)')
const analyzerOut = join(STAGE, 'analyzer')
rmSync(analyzerOut, { recursive: true, force: true })
// No apphost and no symbols: the extension starts it as `dotnet FlowAnalyzer.dll`. English resources only: Roslyn's
// satellite assemblies for a dozen languages would add megabytes for messages Insilode never shows.
run('dotnet', ['publish', join(ROOT, 'analyzer', 'FlowAnalyzer.csproj'), '-c', 'Release', '-o', analyzerOut, '--no-self-contained',
	'-p:UseAppHost=false', '-p:DebugType=None', '-p:DebugSymbols=false', '-p:SatelliteResourceLanguages=en', '-nologo', '-v', 'q'])
if (!existsSync(join(analyzerOut, 'FlowAnalyzer.dll'))) {
	fail('dotnet publish did not produce FlowAnalyzer.dll.')
}

// ── VS Code ──────────────────────────────────────────────────────────────────
step('Applying the Insilode app icon')
// The installer, the exe and the uninstaller read their icon from VS Code's resources/win32/code.ico; setup copied Insilode's there.
const icon = join(ROOT, 'editor', 'branding', 'icon.ico')
const iconTarget = join(VSCODE, 'resources', 'win32', 'code.ico')
if (existsSync(icon) && !readFileSync(icon).equals(readFileSync(iconTarget))) {
	copyFileSync(icon, iconTarget)
	console.log('  resources/win32/code.ico: refreshed from editor/branding/icon.ico')
} else {
	console.log('  resources/win32/code.ico: Insilode\'s')
}

/** What the production build is made from: when none of it changed, the app of the last full build is still right. */
function appStamp() {
	const hash = createHash('sha256')
	const described = launchSync('git', ['describe', '--tags'], { cwd: VSCODE, encoding: 'utf8' })
	hash.update(described.status === 0 ? described.stdout.trim() : 'unknown version')
	for (const file of [join(ROOT, 'editor', 'patches', 'flow-core.patch'), join(ROOT, 'editor', 'patches', 'flow-update.patch'), join(VSCODE, 'product.json'), join(VSCODE, 'resources', 'win32', 'code.ico')]) {
		hash.update(readFileSync(file))
	}
	return hash.digest('hex')
}
const STAMP = join(DIST, 'app-build.stamp')
const stamp = appStamp()
let reuse = false
if (args.has('--fast')) {
	const last = existsSync(STAMP) ? readFileSync(STAMP, 'utf8').trim() : ''
	if (!existsSync(join(APP, 'Insilode.exe'))) {
		console.log(`  --fast: ${relative(ROOT, APP)} has no earlier build: doing the full build.`)
	} else if (last !== stamp) {
		console.log(`  --fast: ${last ? 'VS Code, the core patch, product.json or the icon changed since the last full build' : 'no record of the last full build (dist/app-build.stamp)'}: doing the full build.`)
	} else {
		reuse = true
	}
}

if (reuse) {
	step('Reusing the production build (--fast: nothing it is made from has changed)')
	console.log(`  ${relative(ROOT, APP)}`)
} else {
	step('Building VS Code for production (gulp vscode-win32-x64-min: 15 to 40 minutes)')
	// VS Code's packager lists an extension's files with vsce, which sees nothing through the junctions that `npm start` uses
	// (and then fails reading the folder itself). The links are taken away for the build, and put back when this script ends,
	// however it ends; Insilode's extensions are added to the app afterwards from editor/extensions.
	const linked = readdirSync(join(VSCODE, 'extensions')).filter(n => n.startsWith('flow-') && lstatSync(join(VSCODE, 'extensions', n)).isSymbolicLink())
	const relink = () => {
		for (const name of readdirSync(EXTENSIONS).filter(n => n.startsWith('flow-') && existsSync(join(EXTENSIONS, n, 'package.json')))) {
			const link = join(VSCODE, 'extensions', name)
			if (!existsSync(link) && linked.includes(name)) {
				symlinkSync(join(EXTENSIONS, name), link, 'junction')
			}
		}
	}
	if (linked.length) {
		process.on('exit', relink)
		process.on('SIGINT', () => process.exit(130))
		for (const name of linked) {
			rmSync(join(VSCODE, 'extensions', name), { force: true })
		}
	}
	gulp(`vscode-win32-${ARCH}-min`)
	relink()
	mkdirSync(DIST, { recursive: true })
	writeFileSync(STAMP, stamp)
}
const appDir = join(APP, 'resources', 'app')
if (!existsSync(join(appDir, 'product.json'))) {
	fail(`${relative(ROOT, appDir)} has no product.json: the production build did not finish.`)
}

step('Putting Insilode into the app')
// Insilode's extensions are linked into editor/vscode/extensions for development. VS Code's packager follows that link
// (and, as these extensions are not built by gulp, ships whatever vsce lists: sources, dev dependencies): they are
// replaced by copies of exactly what the extension host loads.
/** What stays out of the copies: sources, tests, tooling and, at the top only, node_modules (flow-agent's come back below). */
const TOP_ONLY = /^(node_modules|src|tests?|tsconfig.*\.json|esbuild\.mjs|package-lock\.json|\.vscodeignore|\.gitignore|\.gitattributes)$/
const leaveOut = rel => (!rel.includes('\\') && TOP_ONLY.test(rel)) || /\.(map|ts)$/.test(rel)
/**
 * Extensions whose dependencies are not bundled by esbuild and so ship as node_modules: flow-agent's ACP adapters run as
 * their own node processes. Their production dependencies are installed fresh from the lockfile (no dev tools, and only
 * this platform's native binaries: the claude and codex executables are hundreds of MB per platform).
 */
const RUNTIME_MODULES = ['flow-agent']
const extensionsDir = join(appDir, 'extensions')
const flowExtensions = readdirSync(EXTENSIONS).filter(n => n.startsWith('flow-') && existsSync(join(EXTENSIONS, n, 'package.json')))
for (const name of flowExtensions) {
	const from = join(EXTENSIONS, name)
	const to = join(extensionsDir, name)
	rmSync(to, { recursive: true, force: true })
	cpSync(from, to, {
		recursive: true,
		filter: src => !leaveOut(relative(from, src)),
	})
	const manifest = readJson(join(from, 'package.json'))
	const dependencies = Object.keys(manifest.dependencies ?? {})
	if (RUNTIME_MODULES.includes(name) && dependencies.length) {
		const deps = join(STAGE, `${name}-deps`)
		rmSync(deps, { recursive: true, force: true })
		mkdirSync(deps, { recursive: true })
		for (const f of ['package.json', 'package-lock.json']) {
			copyFileSync(join(from, f), join(deps, f))
		}
		run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], deps)
		// Source maps are only for debugging the packages: left out they also keep paths short (Windows stops at 260 characters).
		cpSync(join(deps, 'node_modules'), join(to, 'node_modules'), { recursive: true, filter: src => !src.endsWith('.map') })
		console.log(`  ${name}: copy with ${dependencies.length} runtime ${dependencies.length === 1 ? 'dependency' : 'dependencies'}`)
	} else {
		console.log(`  ${name}: copy`)
	}
}
// Where flowRoot() of flow-view looks first: the extension's own folder.
const flowView = join(extensionsDir, 'flow-view')
rmSync(join(flowView, 'analyzer'), { recursive: true, force: true })
cpSync(analyzerOut, join(flowView, 'analyzer'), { recursive: true })
rmSync(join(flowView, 'ui'), { recursive: true, force: true })
cpSync(canvas, join(flowView, 'ui', 'dist-webview'), { recursive: true, filter: src => !src.endsWith('.map') })
console.log('  flow-view/analyzer, flow-view/ui/dist-webview')

// A broken app is cheaper to find here than after a 15 minute Inno Setup run.
const problems = []
const productJson = readJson(join(appDir, 'product.json'))
// The app's own version is VS Code's (product.json "version"); the update check compares Insilode's with the release's.
if (productJson.insilodeVersion !== version) {
	productJson.insilodeVersion = version
	writeFileSync(join(appDir, 'product.json'), JSON.stringify(productJson, null, '\t') + '\n')
}
for (const [key, want] of [['applicationName', 'insilode'], ['dataFolderName', '.insilode'], ['nameShort', 'Insilode']]) {
	if (productJson[key] !== want) {
		problems.push(`product.json: ${key} is ${JSON.stringify(productJson[key])}, not ${JSON.stringify(want)}`)
	}
}
for (const name of flowExtensions) {
	const dir = join(extensionsDir, name)
	if (lstatSync(dir).isSymbolicLink()) {
		problems.push(`extensions/${name} is a link, not a copy`)
	}
	const main = readJson(join(dir, 'package.json')).main
	if (main && !existsSync(join(dir, main))) {
		problems.push(`extensions/${name}: ${main} is missing (the extension was not built)`)
	}
}
for (const file of ['extensions/flow-view/analyzer/FlowAnalyzer.dll', 'extensions/flow-view/ui/dist-webview/webview.js', 'extensions/flow-view/ui/dist-webview/board.js', 'extensions/flow-view/out/insilode-mcp.js']) {
	if (!existsSync(join(appDir, file))) {
		problems.push(`${file} is missing`)
	}
}
if (!existsSync(join(APP, 'Insilode.exe'))) {
	problems.push('Insilode.exe is missing')
}
if (problems.length) {
	fail(`The app in ${relative(ROOT, APP)} is not right:\n  - ${problems.join('\n  - ')}`)
}

// ── Inno Setup ───────────────────────────────────────────────────────────────
step('Insilode images for the installer and the Start tile')
// Inno shows resources/win32/inno-*.bmp on its pages (VS Code's are blue): Insilode's come from editor/installer (made by
// scripts/make-installer-images.py). They are read only by the Inno step, so they are not part of the --fast stamp.
const images = join(ROOT, 'editor', 'installer')
for (const name of existsSync(images) ? readdirSync(images).filter(n => /^inno-(big|small)-\d+\.bmp$/.test(n)) : []) {
	copyFileSync(join(images, name), join(VSCODE, 'resources', 'win32', name))
}
// The tile of a Start entry takes its name and colour from this manifest (VS Code's says "Code - OSS").
const tile = join(APP, `${readJson(join(appDir, 'product.json')).nameShort}.VisualElementsManifest.xml`)
if (existsSync(tile)) {
	writeFileSync(tile, readFileSync(tile, 'utf8').replace(/ShortDisplayName="[^"]*"/, 'ShortDisplayName="Insilode"').replace(/BackgroundColor="[^"]*"/, 'BackgroundColor="#161A2A"'))
}
// ...and so do its two logos, which are VS Code's blue icon unless replaced.
for (const logo of ['code_70x70.png', 'code_150x150.png']) {
	if (existsSync(join(images, logo))) {
		copyFileSync(join(images, logo), join(appDir, 'resources', 'win32', logo))
	}
}

step('Preparing the updater')
gulp(`vscode-win32-${ARCH}-inno-updater`)

mkdirSync(DIST, { recursive: true })
const built = []
for (const target of targets) {
	step(`Building the ${target === 'user' ? 'per-user' : 'system-wide'} installer (Inno Setup, LZMA: several minutes)`)
	gulp(`vscode-win32-${ARCH}-${target}-setup`)
	const made = join(VSCODE, '.build', `win32-${ARCH}`, `${target}-setup`, 'VSCodeSetup.exe')
	if (!existsSync(made)) {
		fail(`Inno Setup did not write ${relative(ROOT, made)}.`)
	}
	const out = join(DIST, `Insilode-Setup-${version}-${ARCH}${target === 'system' ? '-system' : ''}.exe`)
	copyFileSync(made, out)
	built.push(out)
}

rmSync(STAGE, { recursive: true, force: true })
console.log('\n\x1b[32m✓ The installer is ready.\x1b[0m')
for (const file of built) {
	console.log(`  ${file}  (${mb(statSync(file).size)})`)
}
console.log('  It is not code-signed, so Windows SmartScreen asks for confirmation the first time it runs.')
