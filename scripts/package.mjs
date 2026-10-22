#!/usr/bin/env node
// Builds Insilode's macOS and Linux packages, what scripts/installer.mjs is for Windows: files an end user installs without
// the repository, Node or build tools.
//   npm run package                   this machine's platform and processor
//   npm run package -- --arch arm64   says which processor is expected (CI passes it): it must be this machine's, as the
//                                     native modules are built for the machine that ran `npm run setup`
// What it makes, in dist/:
//   macOS   Insilode-<version>-darwin-<arch>.zip   the app, zipped with ditto (what the Homebrew cask installs)
//           Insilode-<version>-darwin-<arch>.dmg   the same app on a disk image, with an Applications link to drag it to
//   Linux   insilode_<version>_amd64.deb           VS Code's Debian package, with Insilode's control file and maintainer scripts
//           insilode-<version>-1.x86_64.rpm        VS Code's RPM, when rpmbuild is installed (best effort: a failure is reported, not fatal)
//           Insilode-<version>-linux-x64.tar.gz    the app folder, to unpack anywhere
// What it does:
//   1. checks that `npm run setup` was done,
//   2. builds the Insilode extensions, the canvas and the C# analyzer (a framework-dependent Release publish),
//   3. runs VS Code's own production build (gulp vscode-<platform>-<arch>-min) into editor/VSCode-<platform>-<arch>,
//   4. replaces the Insilode extensions in that app by real, trimmed copies and puts the analyzer and the canvas next to
//      flow-view's code (the same layout as the Windows installer),
//   5. macOS: signs the app ad hoc (it is not Developer ID signed: Gatekeeper asks on first launch), zips it, makes the dmg;
//      Linux: runs VS Code's deb (and rpm) packaging tasks on the app and packs the tarball.
// It needs what `npm run setup` needs, the .NET 10 SDK, about 20 GB of disk and 8 GB of RAM; on Linux also fakeroot
// (and rpm for the .rpm).

import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, cpSync, createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { EXTENSIONS, ROOT, VSCODE, buildableExtensions, launchSync, patchesApplied } from './lib.mjs'
import { debVersion, rpmVersion } from './release-files.mjs'

const argv = process.argv.slice(2)
let wantArch = ''
for (let i = 0; i < argv.length; i++) {
	if (argv[i] === '--arch' && argv[i + 1]) {
		wantArch = argv[++i]
	} else {
		console.error(`Unknown option ${argv[i]}. Options: --arch x64|arm64.`)
		process.exit(1)
	}
}
const PLATFORM = process.platform
const ARCH = process.arch
const DIST = join(ROOT, 'dist')
const STAGE = join(DIST, 'stage')
const PACKAGING = join(ROOT, 'packaging')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const version = pkg.version
// Ctrl+C ends the script through `exit`, so what is put back on exit (the extension links, the build files withEdits changed) always is.
process.on('SIGINT', () => process.exit(130))

function step(title) {
	console.log(`\n\x1b[1m▸ ${title}\x1b[0m`)
}

function fail(message) {
	console.error(`\n\x1b[31m✗ ${message}\x1b[0m`)
	process.exit(1)
}

/** Runs a command; a failure ends the script, unless `optional`, when it returns false. */
function run(cmd, cmdArgs, cwd = ROOT, { hint = '', env, optional = false } = {}) {
	console.log(`  $ ${cmd} ${cmdArgs.join(' ')}${cwd !== ROOT ? `   (in ${cwd.replace(ROOT, '.')})` : ''}`)
	const r = launchSync(cmd, cmdArgs, { cwd, stdio: 'inherit', env: env ?? process.env })
	if (r.error || r.status !== 0) {
		const what = r.error ? `Could not start ${cmd}: ${r.error.message}` : `${cmd} ${cmdArgs.join(' ')} failed.`
		if (optional) {
			console.warn(`  ! ${what}`)
			return false
		}
		fail(`${what}${hint ? `\n${hint}` : ''}`)
	}
	return true
}

const has = cmd => launchSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0
const mb = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const readJson = file => JSON.parse(readFileSync(file, 'utf8'))

function sha256(file) {
	return new Promise((resolve, reject) => {
		const hash = createHash('sha256')
		createReadStream(file).on('data', d => hash.update(d)).on('error', reject).on('end', () => resolve(hash.digest('hex')))
	})
}

// ── prerequisites ────────────────────────────────────────────────────────────
step('Checking')
if (PLATFORM !== 'darwin' && PLATFORM !== 'linux') {
	fail(PLATFORM === 'win32' ? 'On Windows, build the installer: npm run installer.' : `Packages for ${PLATFORM} are not built.`)
}
if (wantArch && wantArch !== ARCH) {
	fail(`--arch ${wantArch} was asked for, but this machine is ${ARCH}: the native modules from \`npm run setup\` are built for ${ARCH}.`)
}
if (PLATFORM === 'linux' && ARCH !== 'x64') {
	fail(`Linux packages are built for x64 only (this machine is ${ARCH}).`)
}
if (PLATFORM === 'darwin' && ARCH !== 'x64' && ARCH !== 'arm64') {
	fail(`macOS packages are built for x64 and arm64 (this machine is ${ARCH}).`)
}
const nvmrc = readFileSync(join(VSCODE, '.nvmrc'), 'utf8').trim().replace(/^v/, '')
const [needMajor, needMinor] = nvmrc.split('.').map(Number)
const [major, minor] = process.versions.node.split('.').map(Number)
if (major !== needMajor || minor < needMinor) {
	fail(`Node ${process.versions.node} will not do: the VS Code build needs Node ${needMajor}.${needMinor} or a newer ${needMajor}.x (switch with nvm or fnm, then run this again).`)
}
if (!existsSync(join(VSCODE, 'node_modules', '.package-lock.json'))) {
	fail('Insilode is not set up yet: run `npm run setup` first (it fetches and builds VS Code, which this packages).')
}
if (!patchesApplied()) {
	fail('editor/vscode does not carry Insilode\'s patches (or has other changes to the same files): run `npm run setup`, or delete editor/vscode and run it again.')
}
const sdks = launchSync('dotnet', ['--list-sdks'], { encoding: 'utf8' })
if (sdks.error || !(sdks.stdout ?? '').split(/\r?\n/).some(line => Number.parseInt(line, 10) >= 10)) {
	fail('The .NET 10 SDK is required to publish the C# analyzer: install it from https://dotnet.microsoft.com/download/dotnet/10.0')
}
const tools = PLATFORM === 'darwin' ? ['ditto', 'hdiutil', 'codesign', 'xattr'] : ['fakeroot', 'dpkg-deb', 'perl', 'tar']
const missing = tools.filter(t => !has(t))
if (missing.length) {
	fail(`Missing ${missing.join(', ')}.${PLATFORM === 'linux' ? ' On Debian or Ubuntu: sudo apt-get install fakeroot dpkg perl tar' : ''}`)
}
const rpm = PLATFORM === 'linux' && has('rpmbuild')
console.log(`  node ${process.versions.node} · .NET SDK ✓ · ${PLATFORM}-${ARCH} · Insilode ${version}${PLATFORM === 'linux' && !rpm ? ' · no rpmbuild: the .rpm is skipped' : ''}`)

/** `gulp <task>` of the VS Code checkout, with the heap its build asks for (what `npm run gulp` runs). */
function gulp(task, { optional = false } = {}) {
	return run('node', ['--experimental-strip-types', '--max-old-space-size=8192', join('node_modules', 'gulp', 'bin', 'gulp.js'), task], VSCODE, {
		optional,
		hint: 'This is VS Code\'s own build: the error above comes from it. A download that failed (Electron, built-in extensions, a sysroot) is worth running again.',
	})
}

function installDependencies(dir) {
	if (!existsSync(join(dir, 'node_modules'))) {
		run('npm', [existsSync(join(dir, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund'], dir)
	}
}

/**
 * Runs `fn` with lines of a VS Code build file replaced, and puts the file back afterwards, however the script ends.
 * Each `from` must be in the file: when VS Code changes it, this says so instead of building something else.
 */
function withEdits(file, edits, fn) {
	const original = readFileSync(file, 'utf8')
	let edited = original
	for (const [from, to] of edits) {
		if (!edited.includes(from)) {
			fail(`${relative(ROOT, file)} no longer contains "${from}": VS Code's build changed, and scripts/package.mjs needs updating.`)
		}
		edited = edited.replace(from, to)
	}
	const restore = () => writeFileSync(file, original)
	process.on('exit', restore)
	writeFileSync(file, edited)
	try {
		return fn()
	} finally {
		restore()
		process.off('exit', restore)
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
// No apphost and no symbols: the extension starts it as `dotnet FlowAnalyzer.dll`, so one build serves every platform.
run('dotnet', ['publish', join(ROOT, 'analyzer', 'FlowAnalyzer.csproj'), '-c', 'Release', '-o', analyzerOut, '--no-self-contained',
	'-p:UseAppHost=false', '-p:DebugType=None', '-p:DebugSymbols=false', '-p:SatelliteResourceLanguages=en', '-nologo', '-v', 'q'])
if (!existsSync(join(analyzerOut, 'FlowAnalyzer.dll'))) {
	fail('dotnet publish did not produce FlowAnalyzer.dll.')
}

// ── VS Code ──────────────────────────────────────────────────────────────────
step('Applying the Insilode app icon')
// Setup copied Insilode's icons over VS Code's; a newer editor/branding is copied again here.
for (const [from, to] of [['icon.icns', 'darwin/code.icns'], ['icon.png', 'linux/code.png']]) {
	const icon = join(ROOT, 'editor', 'branding', from)
	const target = join(VSCODE, 'resources', to)
	if (existsSync(icon) && !readFileSync(icon).equals(readFileSync(target))) {
		copyFileSync(icon, target)
		console.log(`  resources/${to}: refreshed from editor/branding/${from}`)
	}
}

step(`Building VS Code for production (gulp vscode-${PLATFORM}-${ARCH}-min: 15 to 40 minutes)`)
// VS Code's packager lists an extension's files with vsce, which sees nothing through the links that `npm start` uses.
// The links are taken away for the build and put back when this script ends, however it ends; Insilode's extensions are
// added to the app afterwards from editor/extensions.
const linked = readdirSync(join(VSCODE, 'extensions')).filter(n => n.startsWith('flow-') && lstatSync(join(VSCODE, 'extensions', n)).isSymbolicLink())
const relink = () => {
	for (const name of linked) {
		const link = join(VSCODE, 'extensions', name)
		if (!existsSync(link) && existsSync(join(EXTENSIONS, name, 'package.json'))) {
			symlinkSync(join(EXTENSIONS, name), link, 'dir')
		}
	}
}
if (linked.length) {
	process.on('exit', relink)
	for (const name of linked) {
		rmSync(join(VSCODE, 'extensions', name), { force: true })
	}
}
gulp(`vscode-${PLATFORM}-${ARCH}-min`)
relink()

const product = readJson(join(VSCODE, 'product.json'))
const APP = join(ROOT, 'editor', `VSCode-${PLATFORM}-${ARCH}`)
const bundle = PLATFORM === 'darwin' ? join(APP, `${product.nameLong}.app`) : APP
const appDir = PLATFORM === 'darwin' ? join(bundle, 'Contents', 'Resources', 'app') : join(APP, 'resources', 'app')
if (!existsSync(join(appDir, 'product.json'))) {
	fail(`${relative(ROOT, appDir)} has no product.json: the production build did not finish.`)
}

step('Putting Insilode into the app')
/** What stays out of the copies: sources, tests, tooling and, at the top only, node_modules (flow-agent's come back below). */
const TOP_ONLY = /^(node_modules|src|tests?|tsconfig.*\.json|esbuild\.mjs|package-lock\.json|\.vscodeignore|\.gitignore|\.gitattributes)$/
const leaveOut = rel => (!rel.includes('/') && TOP_ONLY.test(rel)) || /\.(map|ts)$/.test(rel)
/** Extensions whose dependencies ship as node_modules (flow-agent's ACP adapters run as their own node processes). */
const RUNTIME_MODULES = ['flow-agent']
const extensionsDir = join(appDir, 'extensions')
const flowExtensions = readdirSync(EXTENSIONS).filter(n => n.startsWith('flow-') && existsSync(join(EXTENSIONS, n, 'package.json')))
for (const name of flowExtensions) {
	const from = join(EXTENSIONS, name)
	const to = join(extensionsDir, name)
	rmSync(to, { recursive: true, force: true })
	cpSync(from, to, { recursive: true, filter: src => !leaveOut(relative(from, src)) })
	const manifest = readJson(join(from, 'package.json'))
	const dependencies = Object.keys(manifest.dependencies ?? {})
	if (RUNTIME_MODULES.includes(name) && dependencies.length) {
		// Production dependencies fresh from the lockfile: no dev tools, and only this platform's native binaries.
		const deps = join(STAGE, `${name}-deps`)
		rmSync(deps, { recursive: true, force: true })
		mkdirSync(deps, { recursive: true })
		for (const f of ['package.json', 'package-lock.json']) {
			copyFileSync(join(from, f), join(deps, f))
		}
		run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], deps)
		cpSync(join(deps, 'node_modules'), join(to, 'node_modules'), { recursive: true, verbatimSymlinks: true, filter: src => !src.endsWith('.map') })
		console.log(`  ${name}: copy with ${dependencies.length} runtime ${dependencies.length === 1 ? 'dependency' : 'dependencies'}`)
	} else {
		console.log(`  ${name}: copy`)
	}
}
const flowView = join(extensionsDir, 'flow-view')
rmSync(join(flowView, 'analyzer'), { recursive: true, force: true })
cpSync(analyzerOut, join(flowView, 'analyzer'), { recursive: true })
rmSync(join(flowView, 'ui'), { recursive: true, force: true })
cpSync(canvas, join(flowView, 'ui', 'dist-webview'), { recursive: true, filter: src => !src.endsWith('.map') })
console.log('  flow-view/analyzer, flow-view/ui/dist-webview')

// A broken app is cheaper to find here than in a package someone installed.
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
for (const file of ['extensions/flow-view/analyzer/FlowAnalyzer.dll', 'extensions/flow-view/ui/dist-webview/webview.js', 'extensions/flow-view/ui/dist-webview/board.js', 'extensions/flow-view/out/insilode-mcp.js', 'extensions/flow-view/out/axle-mcp.js']) {
	if (!existsSync(join(appDir, file))) {
		problems.push(`${file} is missing`)
	}
}
if (PLATFORM === 'linux' && !existsSync(join(APP, product.applicationName))) {
	problems.push(`${product.applicationName} (the executable) is missing`)
}
if (problems.length) {
	fail(`The app in ${relative(ROOT, APP)} is not right:\n  - ${problems.join('\n  - ')}`)
}

mkdirSync(DIST, { recursive: true })
const built = []

// ── macOS ────────────────────────────────────────────────────────────────────
if (PLATFORM === 'darwin') {
	step('Signing the app ad hoc (no Developer ID yet)')
	// Copying Insilode in changed the bundle, so Electron's own signature no longer matches it, and Apple silicon then
	// calls the app "damaged". An ad hoc signature makes it whole again; Gatekeeper still asks on first launch, as the
	// signature names no developer.
	run('xattr', ['-cr', bundle])
	run('codesign', ['--force', '--deep', '--sign', '-', bundle])
	run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle], ROOT, {
		hint: 'The signed app does not verify: macOS would call it damaged.',
	})

	step('Zipping the app (ditto, which keeps the frameworks\' symlinks)')
	const zip = join(DIST, `Insilode-${version}-darwin-${ARCH}.zip`)
	run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundle, zip])
	built.push(zip)

	step('Making the disk image')
	// VS Code's create-dmg.ts names the volume and picks its background from VS Code's quality ("VS Code", "Code OSS"):
	// hdiutil, with Insilode's name and an Applications link to drag the app to, is all an unsigned build needs.
	const dmgRoot = join(STAGE, 'dmg')
	rmSync(dmgRoot, { recursive: true, force: true })
	mkdirSync(dmgRoot, { recursive: true })
	run('ditto', [bundle, join(dmgRoot, `${product.nameLong}.app`)])
	symlinkSync('/Applications', join(dmgRoot, 'Applications'))
	const dmg = join(DIST, `Insilode-${version}-darwin-${ARCH}.dmg`)
	// hdiutil on a busy build machine sometimes says "Resource busy": it is worth a second and a third try.
	let made = false
	for (let attempt = 1; attempt <= 3 && !made; attempt++) {
		made = run('hdiutil', ['create', '-volname', product.nameLong, '-srcfolder', dmgRoot, '-ov', '-format', 'UDZO', dmg], ROOT, { optional: attempt < 3 })
	}
	built.push(dmg)
}

// ── Linux ────────────────────────────────────────────────────────────────────
if (PLATFORM === 'linux') {
	step('Packing the tarball')
	const tarball = join(DIST, `Insilode-${version}-linux-${ARCH}.tar.gz`)
	run('tar', ['--owner=0', '--group=0', '--transform', `s,^VSCode-linux-${ARCH},Insilode-linux-${ARCH},`, '-czf', tarball, '-C', join(ROOT, 'editor'), `VSCode-linux-${ARCH}`])
	built.push(tarball)

	// VS Code's package tasks compute the package dependencies from the binaries with dpkg-shlibdeps against Chromium's
	// sysroot. Two of their assumptions do not hold for Insilode, so the generator is edited for the length of the task:
	// - it fails when the list differs from VS Code's own release build, whose native modules are compiled against a
	//   glibc 2.28 sysroot; Insilode's are compiled on the build machine, so its list is used (and printed) instead;
	// - it adds the tunnel CLI (bin/<tunnelApplicationName>), which is a separate Rust build that Insilode does not ship.
	const generator = join(VSCODE, 'build', 'linux', 'dependencies-generator.ts')
	const GENERATOR_EDITS = [
		['const FAIL_BUILD_FOR_NEW_DEPENDENCIES: boolean = true;', 'const FAIL_BUILD_FOR_NEW_DEPENDENCIES: boolean = false;'],
		['files.push(path.join(buildDir, \'bin\', product.tunnelApplicationName));', '// Insilode ships no tunnel CLI (edited by scripts/package.mjs for this build).'],
	]
	const description = [
		`Description: ${pkg.description.split('. ')[0].replace(/^Insilode: a/, 'A')}`,
		...pkg.description.split('. ').slice(1).map(s => ` ${s.replace(/\.$/, '')}.`),
		` Built on Code - OSS. See ${pkg.repository}`,
	]

	step('Preparing the Debian package (gulp vscode-linux-x64-prepare-deb)')
	withEdits(generator, GENERATOR_EDITS, () => gulp(`vscode-linux-${ARCH}-prepare-deb`))
	// VS Code's package says it is Microsoft's, and its maintainer scripts add (and, on removal, delete) Microsoft's VS Code
	// apt repository and key: wrong for Insilode, and harmful to a machine that has VS Code from that repository. Insilode's
	// control fields and scripts (packaging/linux/deb) replace them.
	const debArch = 'amd64'
	const debRoot = join(VSCODE, '.build', 'linux', 'deb', debArch, `${product.applicationName}-${debArch}`)
	const controlFile = join(debRoot, 'DEBIAN', 'control')
	if (!existsSync(controlFile)) {
		fail(`${relative(ROOT, controlFile)} was not written: the prepare-deb task did not finish.`)
	}
	const DROP = new Set(['Provides', 'Conflicts', 'Replaces', 'Description', 'Maintainer', 'Homepage'])
	const fields = []
	for (const line of readFileSync(controlFile, 'utf8').split('\n')) {
		if (/^\s/.test(line) || !line) {
			if (line && fields.length) {
				fields.at(-1).lines.push(line)
			}
			continue
		}
		fields.push({ key: line.slice(0, line.indexOf(':')), lines: [line] })
	}
	// A prerelease (0.6.0-rc.1) is written 0.6.0~rc.1, which dpkg sorts before 0.6.0; with a "-" it would read rc.1 as a revision of 0.6.0
	// and sort it after the release, which would then never upgrade it.
	const control = fields.filter(f => !DROP.has(f.key)).map(f => f.key === 'Version' ? [`Version: ${debVersion(version)}`] : f.lines).flat()
	// The package was called axle until 0.4.x: installing this one takes the old one off (its files are not shared, the name is).
	control.push('Replaces: axle', 'Conflicts: axle', 'Provides: axle', 'Maintainer: Insilode <bothuany@users.noreply.github.com>', `Homepage: ${pkg.repository}`, ...description)
	writeFileSync(controlFile, `${control.join('\n')}\n`)
	console.log(`  DEBIAN/control:\n${control.filter(l => !l.startsWith(' ')).map(l => `    ${l.length > 160 ? `${l.slice(0, 157)}...` : l}`).join('\n')}`)
	rmSync(join(debRoot, 'DEBIAN', 'templates'), { force: true })
	for (const script of ['postinst', 'prerm', 'postrm']) {
		const target = join(debRoot, 'DEBIAN', script)
		writeFileSync(target, readFileSync(join(PACKAGING, 'linux', 'deb', script), 'utf8').replace(/\r\n/g, '\n').replaceAll('@@NAME@@', product.applicationName))
		chmodSync(target, 0o755)
	}
	console.log('  DEBIAN/postinst, prerm, postrm: Insilode\'s (packaging/linux/deb); DEBIAN/templates: removed')

	step('Building the Debian package (gulp vscode-linux-x64-build-deb)')
	gulp(`vscode-linux-${ARCH}-build-deb`)
	const debOut = join(VSCODE, '.build', 'linux', 'deb', debArch, 'deb')
	const debs = existsSync(debOut) ? readdirSync(debOut).filter(f => f.endsWith('.deb')) : []
	if (debs.length !== 1) {
		fail(`Expected one .deb in ${relative(ROOT, debOut)}, found ${debs.length}.`)
	}
	const deb = join(DIST, `${product.applicationName}_${version}_${debArch}.deb`)
	copyFileSync(join(debOut, debs[0]), deb)
	built.push(deb)

	if (rpm) {
		step('Building the RPM (best effort)')
		const rpmArch = 'x86_64'
		const rpmBase = join(VSCODE, '.build', 'linux', 'rpm', rpmArch)
		const prepared = withEdits(generator, GENERATOR_EDITS, () => gulp(`vscode-linux-${ARCH}-prepare-rpm`, { optional: true }))
		const spec = join(rpmBase, 'rpmbuild', 'SPECS', `${product.applicationName}.spec`)
		let ok = prepared && existsSync(spec)
		if (ok) {
			// RPM's Version cannot hold a "-": a prerelease is Version 0.6.0 with Release 0.rc.1, which sorts before the release's 1.
			const rpmv = rpmVersion(version)
			const text = readFileSync(spec, 'utf8')
				.replace(/^Version:.*$/m, `Version:  ${rpmv.version}`)
				.replace(/^Release:.*$/m, `Release:  ${rpmv.release}\nObsoletes: axle\nProvides:  axle`)
				.replace(/^Summary:.*$/m, `Summary:  ${description[0].replace('Description: ', '')}`)
				.replace(/^Vendor:.*$/m, 'Vendor:   Insilode')
				.replace(/^Packager:.*$/m, 'Packager: Insilode <bothuany@users.noreply.github.com>')
				.replace(/^URL:.*$/m, `URL:      ${pkg.repository}`)
				.replace(/(%description\n)[^\n]*/, `$1${pkg.description} Built on Code - OSS.`)
			writeFileSync(spec, text)
			ok = gulp(`vscode-linux-${ARCH}-build-rpm`, { optional: true })
		}
		const rpms = ok && existsSync(rpmBase) ? readdirSync(rpmBase).filter(f => f.endsWith('.rpm')) : []
		if (rpms.length === 1) {
			const out = join(DIST, `${product.applicationName}-${version}-1.${rpmArch}.rpm`)
			copyFileSync(join(rpmBase, rpms[0]), out)
			built.push(out)
		} else {
			console.warn('  ! The RPM was not built (see above); the .deb and the tarball are.')
		}
	}
}

rmSync(STAGE, { recursive: true, force: true })
console.log(`\n\x1b[32m✓ Insilode ${version} for ${PLATFORM}-${ARCH} is packaged.\x1b[0m`)
for (const file of built) {
	console.log(`  ${relative(ROOT, file)}  (${mb(statSync(file).size)})  sha256 ${await sha256(file)}`)
}
if (PLATFORM === 'darwin') {
	console.log('  The app is signed ad hoc, not with a Developer ID: macOS asks before the first launch (Privacy & Security, Open Anyway).')
}
