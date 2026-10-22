// The import command end to end (src/extension.ts), with a stand-in for `vscode` (test/vscode-fake.cjs): files are
// real files in a temp folder, and the test answers what a person or the workbench would (the quick pick, the
// extension installs, a file that is locked). Covers what must never happen: writing settings without a backup after
// a read that failed, two imports at once adding everything twice, a theme name the editor would not match, and
// installing again an extension the user disabled.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const COMMAND = 'flow.importFromVSCode'

const fake = globalThis.__vscodeFake = {}
let vscode
let tmp
let user
let context

before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-import-ext-'))
	// CommonJS, as the extension ships (esbuild.mjs): the stand-in requires Node's modules, which an ES module bundle cannot.
	const outfile = join(tmp, 'extension.cjs')
	await build({ entryPoints: [join(ROOT, 'src', 'extension.ts')], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent', mainFields: ['module', 'main'], alias: { vscode: join(ROOT, 'test', 'vscode-fake.cjs') } })
	const require = createRequire(import.meta.url)
	const ext = require(outfile)
	vscode = require('./vscode-fake.cjs')
	user = join(tmp, 'insilode', 'User')
	const state = new Map([['flowImport.offered', true]])
	context = {
		subscriptions: [],
		globalState: { get: k => state.get(k), update: async (k, v) => { state.set(k, v) } },
		globalStorageUri: vscode.Uri.file(join(user, 'globalStorage', 'flow.flow-import')),
		extension: { extensionKind: vscode.ExtensionKind.UI },
	}
	ext.activate(context)
})
after(() => {
	rmSync(tmp, { recursive: true, force: true })
	delete process.env.INSILODE_IMPORT_HOME
	delete process.env.VSCODE_EXTENSIONS
})

// Every test starts with an empty Insilode User folder and no answers given.
beforeEach(() => {
	rmSync(user, { recursive: true, force: true })
	mkdirSync(user, { recursive: true })
	for (const k of ['readHook', 'quickPick', 'install', 'onInfo', 'remoteName', 'uiKind']) {
		delete fake[k]
	}
	fake.extensions = []
	fake.messages = []
	fake.log = []
	fake.appRoot = join(tmp, 'app')
	mkdirSync(fake.appRoot, { recursive: true })
	// No dataFolderName: the developer's own ~/.insilode/extensions is never read by a test.
	writeFileSync(join(fake.appRoot, 'product.json'), '{}')
	process.env.VSCODE_EXTENSIONS = join(tmp, 'no-extensions')
	context.extension.extensionKind = vscode.ExtensionKind.UI
})

/** A home folder with VS Code's User folder where this OS keeps it, and its extensions list. */
function vsCodeHome(name, { settings, keybindings, extensions } = {}) {
	const home = join(tmp, name)
	const roots = { win32: ['AppData', 'Roaming'], darwin: ['Library', 'Application Support'] }
	const dir = join(home, ...(roots[process.platform] ?? ['.config']), 'Code', 'User')
	mkdirSync(dir, { recursive: true })
	if (settings) {
		writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings, null, '\t'))
	}
	if (keybindings) {
		writeFileSync(join(dir, 'keybindings.json'), JSON.stringify(keybindings, null, '\t'))
	}
	if (extensions) {
		const ext = join(home, '.vscode', 'extensions')
		mkdirSync(ext, { recursive: true })
		writeFileSync(join(ext, 'extensions.json'), JSON.stringify(extensions.map(id => ({ identifier: { id }, relativeLocation: `${id}-1.0.0` }))))
	}
	process.env.INSILODE_IMPORT_HOME = home
	return home
}

const mine = (...p) => join(user, ...p)
const read = (...p) => readFileSync(mine(...p), 'utf8')
const pickOnly = (...ids) => items => items.filter(i => ids.includes(i.id))
const run = () => vscode.commands.executeCommand(COMMAND)
const messages = level => fake.messages.filter(m => m.level === level).map(m => m.message)

for (const [code, error] of [['EBUSY', 'Unknown'], ['EPERM', 'NoPermissions']]) {
	test(`a settings.json that cannot be read (${code}) stops the import: nothing is written, nothing replaced`, async () => {
		vsCodeHome(`locked-${code}`, { settings: { 'editor.tabSize': 2 }, keybindings: [{ key: 'ctrl+q', command: 'workbench.action.quit' }] })
		const own = '// mine\n{ "editor.fontSize": 13 }\n'
		writeFileSync(mine('settings.json'), own)
		// What OneDrive or a virus scanner holding the file looks like through the file service.
		fake.readHook = uri => {
			if (uri.fsPath.endsWith('settings.json')) {
				throw new fake.FileSystemError(`${code}: resource busy or locked, open '${uri.fsPath}'`, error)
			}
		}
		await run()
		assert.equal(read('settings.json'), own, 'the user\'s settings are untouched')
		assert.equal(existsSync(mine('keybindings.json')), false, 'nothing else was written either')
		assert.equal(existsSync(mine('import-backups')), false)
		const [err] = messages('error')
		assert.match(err, new RegExp(`stopped: Could not read .*settings\\.json: ${code}`))
		assert.match(err, /Nothing was changed\./)
		assert.equal(messages('info').length, 0, 'no "Imported" notification')
	})
}

test('a settings.json that does not exist yet is not an error: it is created, with nothing to back up', async () => {
	vsCodeHome('fresh', { settings: { 'editor.tabSize': 2 } })
	await run()
	assert.deepEqual(JSON.parse(read('settings.json')), { 'editor.tabSize': 2 })
	assert.equal(existsSync(mine('import-backups')), false)
	assert.match(messages('info')[0], /Imported from VS Code: 1 setting\./)
})

test('a second import while one runs is turned away, so nothing is added twice', async () => {
	vsCodeHome('twice', { keybindings: [{ key: 'ctrl+q', command: 'workbench.action.quit' }, { key: 'ctrl+w', command: 'workbench.action.closeWindow' }] })
	let release
	const held = new Promise(r => { release = r })
	let picks = 0
	// The first import waits in its quick pick; the command runs again meanwhile (the first-start offer and the
	// Command Palette at once).
	fake.quickPick = items => picks++ === 0 ? held.then(() => items) : items
	const first = run()
	await new Promise(r => setImmediate(r))
	await run()
	assert.deepEqual(messages('info'), ['An import from VS Code is already running. Wait for it to finish.'])
	assert.equal(picks, 1, 'the second import never got as far as the list')
	release()
	await first
	const bindings = JSON.parse(read('keybindings.json').replace(/^\/\/.*$/m, ''))
	assert.deepEqual(bindings.map(b => b.key), ['ctrl+q', 'ctrl+w'])
	// Once it is done the command works again (and finds the shortcuts already there).
	await run()
	assert.equal(picks, 2)
	assert.ok(fake.log.some(l => /Keyboard shortcuts: 0 added, 2 already there/.test(l)))
})

test('a theme named in another case is written with the id the editor matches, or not at all', async () => {
	vsCodeHome('theme-case', { settings: { 'workbench.colorTheme': 'one dark pro', 'workbench.iconTheme': 'Material-Icon-Theme', 'workbench.preferredDarkColorTheme': 'Label Of A Theme With An Id' } })
	fake.extensions = [{
		id: 'zhuangtongfa.material-theme',
		packageJSON: { contributes: { themes: [{ id: 'One Dark Pro', label: 'One Dark Pro' }, { id: 'theme-with-id', label: 'Label Of A Theme With An Id' }], iconThemes: [{ id: 'material-icon-theme', label: 'Material Icon Theme' }] } },
	}]
	fake.quickPick = pickOnly('theme')
	await run()
	const settings = JSON.parse(read('settings.json'))
	assert.equal(settings['workbench.colorTheme'], 'One Dark Pro')
	assert.equal(settings['workbench.iconTheme'], 'material-icon-theme')
	// VS Code chooses a theme with an id by its id only; its label would leave the default in place.
	assert.equal('workbench.preferredDarkColorTheme' in settings, false)
	assert.ok(fake.log.some(l => /Not applied because the theme is not installed.*workbench\.preferredDarkColorTheme/.test(l)))
})

test('an extension installed but disabled in Insilode is not installed again; "not found" is known by its name, in any language', async () => {
	vsCodeHome('extensions', { extensions: ['zhuangtongfa.material-theme', 'esbenp.prettier-vscode', 'ms-python.vscode-pylance', 'some.vsix-404', 'already.enabled'] })
	// Insilode's extensions folder: material-theme is installed there, but the extension API (enabled only) does not list it.
	const own = join(tmp, 'own-extensions')
	mkdirSync(own, { recursive: true })
	writeFileSync(join(own, 'extensions.json'), JSON.stringify([{ identifier: { id: 'zhuangtongfa.material-theme' }, relativeLocation: 'zhuangtongfa.material-theme-3.0.0' }]))
	process.env.VSCODE_EXTENSIONS = own
	fake.extensions = [{ id: 'already.enabled', packageJSON: {} }]
	const asked = []
	fake.install = async id => {
		asked.push(id)
		if (id === 'ms-python.vscode-pylance') {
			// A German language pack: the text is translated, the name (the error code) is not.
			throw Object.assign(new Error(`Die Erweiterung '${id}' kann nicht installiert werden, da sie nicht gefunden wurde.`), { name: 'NotFound' })
		}
		if (id === 'some.vsix-404') {
			// English "not found" in some other failure is not the gallery saying it has no such extension.
			throw new Error('Download failed: 404 not found')
		}
		throw Object.assign(new Error('Canceled'), { name: 'Canceled' })
	}
	fake.quickPick = pickOnly('extensions')
	await run()
	assert.deepEqual(asked, ['esbenp.prettier-vscode', 'ms-python.vscode-pylance', 'some.vsix-404'])
	assert.ok(fake.log.some(l => /2 already installed/.test(l)))
	assert.ok(fake.log.some(l => /Installed in Insilode but disabled, so left as they are: zhuangtongfa\.material-theme\./.test(l)))
	assert.ok(fake.log.some(l => /Not on Open VSX, so not installed: ms-python\.vscode-pylance\./.test(l)))
	assert.ok(fake.log.some(l => /Could not install: some\.vsix-404 \(Download failed: 404 not found\)/.test(l)))
	assert.match(messages('info')[0], /1 extension is not on Open VSX: ms-python\.vscode-pylance\./)
})

test('forced onto the remote machine by remote.extensionKind, it refuses instead of writing the server\'s settings', async () => {
	vsCodeHome('remote', { settings: { 'editor.tabSize': 2 } })
	fake.remoteName = 'ssh-remote'
	context.extension.extensionKind = vscode.ExtensionKind.Workspace
	await run()
	assert.match(messages('warning')[0], /remote\.extensionKind/)
	assert.equal(existsSync(mine('settings.json')), false)
	// Running on this computer (the UI side, which extensionKind ["ui", "workspace"] prefers) in the same remote window imports as usual.
	context.extension.extensionKind = vscode.ExtensionKind.UI
	await run()
	assert.deepEqual(JSON.parse(read('settings.json')), { 'editor.tabSize': 2 })
})
