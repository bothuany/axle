// The first-start copy of what an Axle install left (editor/patches/flow-desktop.patch, src/insilodeMigrate.ts).
// The module is pure TypeScript: it is cut out of the patch (what ships, not a copy) and run by Node's type stripping.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const patch = readFileSync(join(ROOT, 'editor', 'patches', 'flow-desktop.patch'), 'utf8').replace(/\r\n/g, '\n')

function addedLines(file) {
	const section = patch.split(/^diff --git /m).find(part => part.startsWith(`a/${file} `))
	assert.ok(section, `${file} is not in the patch`)
	return section.split('\n').slice(section.split('\n').findIndex(line => line.startsWith('@@')) + 1).filter(line => line.startsWith('+')).map(line => line.slice(1))
}

const dir = mkdtempSync(join(realpathSync.native(tmpdir()), 'insilode-migrate-'))
writeFileSync(join(dir, 'insilodeMigrate.ts'), addedLines('src/insilodeMigrate.ts').join('\n') + '\n')
const { migrateLegacyData, appDataFolder, rewriteSettings, MARKER } = await import(pathToFileURL(join(dir, 'insilodeMigrate.ts')).href)

const write = (file, text = 'x') => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
const product = { nameShort: 'Insilode', dataFolderName: '.insilode' }

/** A machine that had Axle: settings with the old theme, a global state, a cache, and an extensions folder with its bridge. */
function axleMachine() {
	const home = mkdtempSync(join(dir, 'home-'))
	const appData = join(home, 'AppData', 'Roaming')
	write(join(appData, 'Axle', 'User', 'settings.json'), '{\n\t"workbench.colorTheme": "Axle Dark",\n\t"editor.fontSize": 15\n}\n')
	write(join(appData, 'Axle', 'User', 'profiles', 'p1', 'settings.json'), '{ "workbench.preferredLightColorTheme": "Axle Light" }')
	write(join(appData, 'Axle', 'User', 'globalStorage', 'state.vscdb'), 'trust')
	write(join(appData, 'Axle', 'storage.json'), '{}')
	write(join(appData, 'Axle', 'Cache', 'junk'), 'cache')
	write(join(appData, 'Axle', 'logs', 'a.log'), 'log')
	write(join(home, '.axle', 'extensions', 'extensions.json'), JSON.stringify([{ location: { path: '/c:/Users/u/.axle/extensions/foo-1', fsPath: 'c:\\Users\\u\\.axle\\extensions\\foo-1' } }]))
	write(join(home, '.axle', 'extensions', 'foo-1', 'package.json'), '{}')
	write(join(home, '.axle', 'argv.json'), '{}')
	write(join(home, '.axle', 'bridge', '1.json'), '{}')
	return { home, appData, input: (extra = {}) => ({ platform: 'win32', env: { APPDATA: appData }, home, argv: [], product, isPortable: false, ...extra }) }
}

test('the first start copies the settings and the extensions, with the old names rewritten', () => {
	const m = axleMachine()
	const r = migrateLegacyData(m.input())
	assert.deepEqual(r.failed, [])
	assert.equal(r.copied.length, 2)
	const user = join(m.appData, 'Insilode')
	assert.match(readFileSync(join(user, 'User', 'settings.json'), 'utf8'), /"workbench.colorTheme": "Insilode Dark"/)
	assert.match(readFileSync(join(user, 'User', 'settings.json'), 'utf8'), /"editor.fontSize": 15/)
	assert.match(readFileSync(join(user, 'User', 'profiles', 'p1', 'settings.json'), 'utf8'), /"Insilode Light"/)
	assert.ok(existsSync(join(user, 'User', 'globalStorage', 'state.vscdb')), 'workspace trust and extension state come along')
	assert.ok(existsSync(join(user, 'storage.json')))
	assert.ok(existsSync(join(user, MARKER)))
	assert.ok(!existsSync(join(user, 'Cache')) && !existsSync(join(user, 'logs')), 'caches and logs are not copied')
	const data = join(m.home, '.insilode')
	const recorded = readFileSync(join(data, 'extensions', 'extensions.json'), 'utf8')
	assert.ok(recorded.includes('/.insilode/extensions/foo-1') && recorded.includes('\\\\.insilode\\\\extensions\\\\foo-1'), recorded)
	assert.ok(existsSync(join(data, 'extensions', 'foo-1', 'package.json')) && existsSync(join(data, 'argv.json')))
	assert.ok(!existsSync(join(data, 'bridge')), 'the agent bridge is runtime state')
})

test('the old folders are left exactly as they were', () => {
	const m = axleMachine()
	migrateLegacyData(m.input())
	assert.match(readFileSync(join(m.appData, 'Axle', 'User', 'settings.json'), 'utf8'), /"Axle Dark"/)
	assert.ok(existsSync(join(m.home, '.axle', 'bridge', '1.json')))
	assert.ok(!readFileSync(join(m.home, '.axle', 'extensions', 'extensions.json'), 'utf8').includes('.insilode'))
})

test('it runs once: a folder that exists is never overwritten, and a half-made copy is redone', () => {
	const m = axleMachine()
	migrateLegacyData(m.input())
	write(join(m.appData, 'Insilode', 'User', 'settings.json'), '{ "mine": true }')
	assert.deepEqual(migrateLegacyData(m.input()), { copied: [], failed: [] })
	assert.equal(readFileSync(join(m.appData, 'Insilode', 'User', 'settings.json'), 'utf8'), '{ "mine": true }')

	const fresh = axleMachine()
	write(join(fresh.appData, 'Insilode.migrating', 'leftover'), 'a copy that stopped half way')
	const r = migrateLegacyData(fresh.input())
	assert.equal(r.copied.length, 2)
	assert.ok(!existsSync(join(fresh.appData, 'Insilode.migrating')) && !existsSync(join(fresh.appData, 'Insilode', 'leftover')))
})

test('nothing to migrate, a chosen folder and portable mode are left alone', () => {
	const none = mkdtempSync(join(dir, 'none-'))
	assert.deepEqual(migrateLegacyData({ platform: 'win32', env: { APPDATA: join(none, 'a') }, home: none, argv: [], product, isPortable: false }), { copied: [], failed: [] })

	const m = axleMachine()
	assert.equal(migrateLegacyData(m.input({ argv: ['--user-data-dir', 'x'] })).copied.length, 1, 'only the extensions folder')
	assert.ok(!existsSync(join(m.appData, 'Insilode')))
	const e = axleMachine()
	assert.equal(migrateLegacyData(e.input({ argv: ['--extensions-dir=/x'] })).copied.length, 1, 'only the user data folder')
	assert.ok(!existsSync(join(e.home, '.insilode')))
	const p = axleMachine()
	assert.deepEqual(migrateLegacyData(p.input({ isPortable: true })), { copied: [], failed: [] })
	assert.deepEqual(migrateLegacyData(p.input({ env: { APPDATA: p.appData, VSCODE_PORTABLE: '/x' } })), { copied: [], failed: [] })
	// A build run from source uses folders of its own and must not copy a person's real data into them.
	assert.deepEqual(migrateLegacyData(p.input({ env: { APPDATA: p.appData, VSCODE_DEV: '1' } })), { copied: [], failed: [] })
	assert.ok(!existsSync(join(p.appData, 'Insilode')) && !existsSync(join(p.home, '.insilode')))
})

test('where the user data folder is, on each platform', () => {
	assert.equal(appDataFolder({ platform: 'win32', env: { APPDATA: 'C:\\Roaming' }, home: 'C:\\u' }), 'C:\\Roaming')
	assert.equal(appDataFolder({ platform: 'darwin', env: {}, home: '/Users/u' }).replace(/\\/g, '/'), '/Users/u/Library/Application Support')
	assert.equal(appDataFolder({ platform: 'linux', env: {}, home: '/home/u' }).replace(/\\/g, '/'), '/home/u/.config')
	assert.equal(appDataFolder({ platform: 'linux', env: { XDG_CONFIG_HOME: '/cfg' }, home: '/home/u' }), '/cfg')
	assert.equal(appDataFolder({ platform: 'linux', env: { VSCODE_APPDATA: '/data', XDG_CONFIG_HOME: '/cfg' }, home: '/home/u' }), '/data')
})

test('only the two old theme names and the old folder path are rewritten', () => {
	assert.equal(rewriteSettings('settings', '{"a": "Axle Dark", "b": "Axle Light", "c": "Axle Pro", "d": "Dark+"}'), '{"a": "Insilode Dark", "b": "Insilode Light", "c": "Axle Pro", "d": "Dark+"}')
	assert.equal(rewriteSettings('extensions', '/h/.axle/extensions/x C:\\u\\.axle\\extensions\\y .axle-other'), '/h/.insilode/extensions/x C:\\u\\.insilode\\extensions\\y .axle-other')
})
