// Finding another editor's User folder and extension list (src/sources.ts), on fixture homes laid out as each OS keeps
// them, so every layout is checked on any machine.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIX = join(ROOT, 'test', 'fixtures')
let s
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-import-sources-'))
	const outfile = join(tmp, 'sources.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'sources.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent', mainFields: ['module', 'main'] })
	s = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const names = sources => sources.map(x => x.product.name)

test('Windows: VS Code under %APPDATA%\\Code\\User and Cursor beside it, VS Code first', () => {
	const home = join(FIX, 'win')
	const found = s.findSources({ platform: 'win32', home, appData: join(home, 'AppData', 'Roaming') })
	assert.deepEqual(names(found), ['VS Code', 'Cursor'])
	assert.equal(found[0].userDir, join(home, 'AppData', 'Roaming', 'Code', 'User'))
	assert.equal(found[0].extensionsDir, join(home, '.vscode', 'extensions'))
	// Without %APPDATA% the default place under the home folder is used.
	assert.deepEqual(names(s.findSources({ platform: 'win32', home })), ['VS Code', 'Cursor'])
})

test('macOS: Code - Insiders under ~/Library/Application Support', () => {
	const home = join(FIX, 'mac')
	const found = s.findSources({ platform: 'darwin', home })
	assert.deepEqual(names(found), ['VS Code Insiders'])
	assert.equal(found[0].userDir, join(home, 'Library', 'Application Support', 'Code - Insiders', 'User'))
	assert.equal(found[0].extensionsDir, join(home, '.vscode-insiders', 'extensions'))
})

test('Linux: ~/.config/Code/User, or $XDG_CONFIG_HOME/Code/User when it is set', () => {
	const home = join(FIX, 'linux')
	assert.equal(s.findSources({ platform: 'linux', home })[0].userDir, join(home, '.config', 'Code', 'User'))
	const xdg = join(FIX, 'linux-xdg', 'xdg')
	const found = s.findSources({ platform: 'linux', home, xdgConfigHome: xdg })
	assert.equal(found[0].userDir, join(xdg, 'Code', 'User'))
	assert.deepEqual(s.readSource(found[0]).settings.includes('80'), true)
})

test('no editor installed: no source', () => {
	assert.deepEqual(s.findSources({ platform: 'linux', home: join(FIX, 'nowhere') }), [])
	// A Linux home read as Windows: no %APPDATA%\Code and no ~/.vscode, so nothing.
	assert.deepEqual(s.findSources({ platform: 'win32', home: join(FIX, 'linux') }), [])
	// An extensions folder alone is enough to offer the extensions.
	assert.deepEqual(names(s.findSources({ platform: 'win32', home: join(FIX, 'mac') })), ['VS Code Insiders'])
})

test('extensions.json: each id once (lower case), uninstalled ones in .obsolete and Insilode\'s own left out', () => {
	assert.deepEqual(s.listExtensions(join(FIX, 'win', '.vscode', 'extensions')), [
		'esbenp.prettier-vscode',
		'ms-vscode-remote.remote-ssh',
		'pkief.material-icon-theme',
	])
})

test('no extensions.json (an older install): the folder names are the list, versions folded, .obsolete honoured', () => {
	assert.deepEqual(s.listExtensions(join(FIX, 'mac', '.vscode-insiders', 'extensions')), ['eamodio.gitlens', 'ms-python.python'])
	assert.deepEqual(s.listExtensions(join(FIX, 'nowhere')), [])
})

test('readSource: settings and keybindings as text, snippet files sorted, extensions listed', () => {
	const home = join(FIX, 'win')
	const [code] = s.findSources({ platform: 'win32', home })
	const c = s.readSource(code)
	assert.match(c.settings, /"editor.fontSize": 15/)
	assert.match(c.keybindings, /copyLinesDownAction/)
	assert.deepEqual(c.snippets.map(x => x.name), ['react.code-snippets', 'typescript.json'])
	assert.equal(c.extensions.length, 3)
	const cursor = s.readSource(s.findSources({ platform: 'win32', home })[1])
	assert.equal(cursor.keybindings, undefined)
	assert.deepEqual(cursor.snippets, [])
	assert.deepEqual(cursor.extensions, [])
	assert.deepEqual(c.unreadable, [])
})

test('readSource: a locked (EBUSY) or forbidden (EPERM) file is skipped and named, the rest is still read', async () => {
	const { readFileSync } = await import('node:fs')
	const [code] = s.findSources({ platform: 'win32', home: join(FIX, 'win') })
	const fail = (code, name) => file => {
		if (file.endsWith(name)) {
			throw Object.assign(new Error(`${code}: resource busy or locked, open '${file}'`), { code })
		}
		return readFileSync(file, 'utf8')
	}
	const busy = s.readSource(code, fail('EBUSY', 'react.code-snippets'))
	assert.deepEqual(busy.snippets.map(x => x.name), ['typescript.json'])
	assert.match(busy.settings, /"editor.fontSize": 15/)
	assert.deepEqual(busy.unreadable, [{ file: join(code.userDir, 'snippets', 'react.code-snippets'), reason: 'EBUSY' }])
	const denied = s.readSource(code, fail('EPERM', 'settings.json'))
	assert.equal(denied.settings, undefined)
	assert.equal(denied.snippets.length, 2)
	assert.deepEqual(denied.unreadable.map(u => u.reason), ['EPERM'])
	// A file that is simply not there is not "unreadable".
	const cursor = s.readSource(s.findSources({ platform: 'win32', home: join(FIX, 'win') })[1], fail('EBUSY', 'nothing'))
	assert.deepEqual(cursor.unreadable, [])
})

test('Insilode\'s own extensions folder: $VSCODE_EXTENSIONS, a portable install, or ~/<dataFolderName>/extensions', () => {
	const home = join('/', 'home', 'me')
	assert.deepEqual(s.ownExtensionDirs(home, '.insilode', {}), [join(home, '.insilode', 'extensions')])
	assert.deepEqual(s.ownExtensionDirs(home, '.insilode', { VSCODE_EXTENSIONS: '/x/ext', VSCODE_PORTABLE: '/p' }), ['/x/ext', join('/p', 'extensions'), join(home, '.insilode', 'extensions')])
	assert.deepEqual(s.ownExtensionDirs(home, undefined, {}), [])
})
