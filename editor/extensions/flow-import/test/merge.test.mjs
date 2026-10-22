// Merging VS Code's settings, shortcuts and snippets into Insilode's (src/merge.ts): what the user already has stays,
// Insilode's own and Microsoft-service settings are never taken, comments survive. Runs on the fixture folders.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIX = join(ROOT, 'test', 'fixtures')
const read = (...p) => readFileSync(join(FIX, ...p), 'utf8')
const CODE = ['win', 'AppData', 'Roaming', 'Code', 'User']
const MINE = ['insilode', 'User']

let m
let jsonc
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-import-merge-'))
	const outfile = join(tmp, 'merge.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'merge.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent', mainFields: ['module', 'main'] })
	m = await import(pathToFileURL(outfile).href)
	const parser = join(tmp, 'jsonc.mjs')
	await build({ stdin: { contents: "export { parse } from 'jsonc-parser'", resolveDir: ROOT }, bundle: true, platform: 'node', format: 'esm', outfile: parser, logLevel: 'silent', mainFields: ['module', 'main'] })
	jsonc = await import(pathToFileURL(parser).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const parse = text => jsonc.parse(text, [], { allowTrailingComma: true })

test('settings: the user\'s own values stay, new ones are added, language blocks merge key by key', () => {
	const mine = read(...MINE, 'settings.json')
	const plan = m.planSettings(mine, read(...CODE, 'settings.json'))
	assert.deepEqual(plan.add.map(a => a.path.join('.')), ['editor.tabSize', 'files.autoSave', '[python].editor.formatOnSave', '[markdown]'])
	assert.deepEqual(plan.kept, ['editor.fontSize', '[python].editor.tabSize'])
	const merged = parse(m.writeSettings(mine, plan.add))
	assert.equal(merged['editor.fontSize'], 13)
	assert.equal(merged['editor.tabSize'], 2)
	assert.equal(merged['files.autoSave'], 'afterDelay')
	assert.deepEqual(merged['[python]'], { 'editor.tabSize': 2, 'editor.formatOnSave': true })
	assert.deepEqual(merged['[markdown]'], { 'editor.wordWrap': 'on' })
})

test('settings: telemetry, Settings Sync, the update service and Insilode\'s own keys are never imported', () => {
	const plan = m.planSettings(undefined, read(...CODE, 'settings.json'))
	assert.deepEqual(plan.skipped, ['telemetry.telemetryLevel', 'settingsSync.ignoredSettings', 'update.mode', 'flow.agents.enabled'])
	const merged = parse(m.writeSettings(undefined, plan.add))
	for (const key of plan.skipped) {
		assert.equal(key in merged, false, key)
	}
})

test('settings: comments and the user\'s layout survive the merge', () => {
	const mine = read(...MINE, 'settings.json')
	const text = m.writeSettings(mine, m.planSettings(mine, read(...CODE, 'settings.json')).add)
	assert.match(text, /^\/\/ Insilode's user settings before the import: these values stay\./)
	assert.match(text, /"editor\.fontSize": 13, \/\/ chosen in Insilode/)
})

test('settings: an empty or missing file starts a new object', () => {
	for (const start of [undefined, '', '   ']) {
		const text = m.writeSettings(start, [{ path: ['editor.tabSize'], value: 2 }])
		assert.deepEqual(parse(text), { 'editor.tabSize': 2 })
	}
	assert.equal(m.hasSettings(undefined), false)
	assert.equal(m.hasSettings('// only a comment\n{}\n'), false)
	assert.equal(m.hasSettings(read(...MINE, 'settings.json')), true)
})

test('theme: kept apart from settings, and applied only for themes the editor has', () => {
	const plan = m.planSettings(undefined, read(...CODE, 'settings.json'))
	assert.deepEqual(plan.theme.map(t => t.key), ['workbench.colorTheme', 'workbench.iconTheme', 'workbench.colorCustomizations'])
	assert.equal(plan.add.some(a => a.path[0] === 'workbench.colorTheme'), false)
	// VS Code still writes "Default Dark Modern"; the built-in theme is now called "Dark Modern" (migrateThemeSettingsId).
	const installed = { color: ['Dark Modern'], icon: [], product: [] }
	const { apply, missing } = m.applicableTheme(plan.theme, installed)
	assert.deepEqual(apply.map(t => t.key), ['workbench.colorTheme', 'workbench.colorCustomizations'])
	assert.equal(apply[0].value, 'Dark Modern')
	assert.deepEqual(missing.map(t => t.value), ['material-icon-theme'])
	// A theme the user already chose in Insilode stays.
	assert.deepEqual(m.planSettings('{ "workbench.colorTheme": "Insilode Light" }', read(...CODE, 'settings.json')).kept, ['workbench.colorTheme'])
})

test('keybindings: appended, exact duplicates and keys the user already binds left out', () => {
	const mine = read(...MINE, 'keybindings.json')
	const plan = m.planKeybindings(mine, read(...CODE, 'keybindings.json'))
	assert.deepEqual(plan.add.map(k => k.command), ['editor.action.copyLinesDownAction', '-extension.runCode'])
	assert.equal(plan.duplicates, 1, 'ctrl+k ctrl+t is the same chord, however it is spaced')
	assert.deepEqual(plan.kept.map(k => `${k.key} ${k.command}`), ['ctrl+e workbench.action.quickOpen'])
	const text = m.writeKeybindings(mine, plan.add)
	assert.match(text, /^\/\/ Insilode's own shortcuts/)
	const all = parse(text)
	assert.equal(all.length, 4)
	assert.deepEqual(all[0], { key: 'ctrl+e', command: 'flow.showAtCursor' })
	assert.deepEqual(all[2], { key: 'ctrl+shift+d', command: 'editor.action.copyLinesDownAction', when: 'editorTextFocus' })
})

test('keybindings: no file yet gets a new one', () => {
	const plan = m.planKeybindings(undefined, read(...CODE, 'keybindings.json'))
	assert.equal(plan.add.length, 4)
	assert.equal(parse(m.writeKeybindings(undefined, plan.add)).length, 4)
})

test('snippets: a new file is copied as it is, an existing one gains the snippets it lacks', () => {
	const react = read(...CODE, 'snippets', 'react.code-snippets')
	assert.deepEqual(m.mergeSnippets(undefined, react), { text: react, added: 1, kept: 0 })
	const mine = read(...MINE, 'snippets', 'typescript.json')
	const merged = m.mergeSnippets(mine, read(...CODE, 'snippets', 'typescript.json'))
	assert.equal(merged.added, 1)
	assert.equal(merged.kept, 1)
	const result = parse(merged.text)
	assert.deepEqual(result.Log.body, ['console.info($1);'])
	assert.deepEqual(result.Arrow.prefix, 'af')
	assert.match(merged.text, /Insilode's own log snippet/)
	// Nothing new: nothing to write.
	assert.equal(m.mergeSnippets(mine, mine).text, undefined)
})

test('theme: every old built-in name VS Code migrates is written under the name the theme has now', () => {
	const installed = { color: ['Dark Modern', 'Light Modern', 'Dark+', 'Light+', 'Dark 2026', 'Light 2026'], icon: [], product: [] }
	const names = { 'Default Dark Modern': 'Dark Modern', 'Default Light Modern': 'Light Modern', 'Default Dark+': 'Dark+', 'Default Light+': 'Light+', 'VS Code Dark': 'Dark 2026', 'Experimental Dark': 'Dark 2026', 'VS Code Light': 'Light 2026', 'Experimental Light': 'Light 2026' }
	for (const [old, now] of Object.entries(names)) {
		const { apply, missing } = m.applicableTheme([{ key: 'workbench.colorTheme', value: old }], installed)
		assert.deepEqual(apply, [{ key: 'workbench.colorTheme', value: now }], old)
		assert.deepEqual(missing, [])
	}
})

test('theme: matched exactly as VS Code does, a name in another case rewritten to the one installed id', () => {
	assert.equal(m.resolveTheme(['One Dark Pro'], 'One Dark Pro'), 'One Dark Pro')
	assert.equal(m.resolveTheme(['One Dark Pro'], 'one dark pro'), 'One Dark Pro')
	assert.equal(m.resolveTheme(['One Dark Pro'], 'One Dark'), undefined)
	// Two installed themes that differ only in case: which one was meant is unknown, so neither is written.
	assert.equal(m.resolveTheme(['Nord', 'NORD'], 'nord'), undefined)
	assert.equal(m.resolveTheme(['Nord', 'NORD'], 'NORD'), 'NORD')
	const { apply, missing } = m.applicableTheme([{ key: 'workbench.colorTheme', value: 'one dark pro' }, { key: 'workbench.iconTheme', value: 'Material-Icon-Theme' }, { key: 'workbench.productIconTheme', value: 'fluent' }], { color: ['One Dark Pro'], icon: ['material-icon-theme'], product: [] })
	assert.deepEqual(apply.map(t => t.value), ['One Dark Pro', 'material-icon-theme'])
	assert.deepEqual(missing.map(t => t.value), ['fluent'])
})

test('theme: the id a setting names a theme by is its id, a colour theme\'s label only when it has none', () => {
	assert.equal(m.themeSettingsId('color', { id: 'One Dark Pro', label: 'One Dark Pro (Flat)' }), 'One Dark Pro')
	assert.equal(m.themeSettingsId('color', { label: 'Monokai Classic' }), 'Monokai Classic')
	assert.equal(m.themeSettingsId('color', { label: '%themeLabel%' }), undefined)
	assert.equal(m.themeSettingsId('icon', { label: 'Seti' }), undefined)
	assert.equal(m.themeSettingsId('icon', { id: 'vs-seti', label: 'Seti' }), 'vs-seti')
})

test('a missing file is told apart from one that is there but cannot be read', () => {
	assert.equal(m.isFileNotFound({ code: 'FileNotFound', name: 'EntryNotFound (FileSystemError)' }), true)
	assert.equal(m.isFileNotFound(Object.assign(new Error('nope'), { code: 'ENOENT' })), true)
	// A file OneDrive or a virus scanner holds (EBUSY maps to Unknown), or one without permission.
	assert.equal(m.isFileNotFound({ code: 'Unknown', message: 'EBUSY: resource busy or locked' }), false)
	assert.equal(m.isFileNotFound({ code: 'NoPermissions', message: 'EPERM: operation not permitted' }), false)
	assert.equal(m.isFileNotFound(new Error('File not found')), false, 'the message is not looked at')
	assert.equal(m.isFileNotFound(undefined), false)
})

test('the install command\'s "not found" error is recognised by its name, not its (translated) text', () => {
	// ExtensionManagementError names itself after its code (extensionManagement.ts); name and code survive the command's
	// round trip to the extension host (errors.ts, transformErrorForSerialization).
	const notFound = (message, extra) => Object.assign(new Error(message), extra)
	assert.equal(m.isNotFound(notFound("The extension 'ms-vscode-remote.remote-ssh' cannot be installed because it was not found.", { name: 'NotFound' })), true)
	assert.equal(m.isNotFound(notFound("Die Erweiterung 'ms-vscode-remote.remote-ssh' wurde nicht gefunden.", { name: 'NotFound' })), true)
	assert.equal(m.isNotFound(notFound("'ms-vscode-remote.remote-ssh' uzantısı bulunamadı.", { code: 'NotFound' })), true)
	assert.equal(m.isNotFound(new Error('Download failed: 404 not found')), false)
	assert.equal(m.isNotFound(new Error('Network error: ECONNRESET')), false)
	assert.equal(m.isNotFound(undefined), false)
	// What it throws when the editor has no gallery at all (extensionGalleryService.ts), as `npm run web` has none.
	assert.equal(m.isNoGallery('No extension gallery service configured.'), true)
	assert.equal(m.isNoGallery("Extension 'a.b' not found."), false)
})
