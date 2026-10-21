// Settings written before the rename (src/legacySettings.ts): what is moved to the new names, in which scope. Pure, so it is
// bundled with esbuild and run under plain Node, like tour-file.test.mjs.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT } from './helpers.mjs'

let legacy
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-legacy-settings-'))
	const outfile = join(tmp, 'legacySettings.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'legacySettings.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	legacy = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

/** `inspect` as the editor answers it: only the keys the test sets, per scope. */
const reader = table => key => table[key]

test('skeleton first moves to the new key in the scope it was set in, unless the new key is set there', () => {
	const read = reader({
		'axle.skeletonFirst.enabled': { globalValue: true, workspaceValue: false },
		'insilode.skeletonFirst.enabled': { workspaceValue: true },
	})
	assert.deepEqual(legacy.legacySettingUpdates(read), [{ key: 'insilode.skeletonFirst.enabled', scope: 'global', value: true }])
})

test('the overlay screen "axle" is now "insilode"; other values are left alone', () => {
	assert.deepEqual(legacy.legacySettingUpdates(reader({ 'flow.agents.desktop.overlay.display': { globalValue: 'axle' } })), [{ key: 'flow.agents.desktop.overlay.display', scope: 'global', value: 'insilode' }])
	assert.deepEqual(legacy.legacySettingUpdates(reader({ 'flow.agents.desktop.overlay.display': { globalValue: 'primary' } })), [])
})

test('the auto-hide flag keeps its value under the new key, and the rest of the object', () => {
	const key = 'flow.agents.desktop.overlay.autoHide'
	assert.deepEqual(legacy.legacySettingUpdates(reader({ [key]: { globalValue: { noAgents: false, axleFocused: false } } })), [{ key, scope: 'global', value: { noAgents: false, insilodeFocused: false } }])
	assert.deepEqual(legacy.legacySettingUpdates(reader({ [key]: { workspaceValue: { axleFocused: true, insilodeFocused: false } } })), [{ key, scope: 'workspace', value: { insilodeFocused: false } }])
	assert.deepEqual(legacy.legacySettingUpdates(reader({ [key]: { globalValue: { noAgents: true } } })), [])
})

test('the colour themes of the old name are renamed, whichever setting holds them', () => {
	const read = reader({
		'workbench.colorTheme': { globalValue: 'Axle Dark' },
		'workbench.preferredDarkColorTheme': { workspaceValue: 'Axle Dark' },
		'workbench.preferredLightColorTheme': { globalValue: 'Axle Light' },
	})
	assert.deepEqual(legacy.legacySettingUpdates(read), [
		{ key: 'workbench.colorTheme', scope: 'global', value: 'Insilode Dark' },
		{ key: 'workbench.preferredLightColorTheme', scope: 'global', value: 'Insilode Light' },
		{ key: 'workbench.preferredDarkColorTheme', scope: 'workspace', value: 'Insilode Dark' },
	])
	assert.deepEqual(legacy.legacySettingUpdates(reader({ 'workbench.colorTheme': { globalValue: 'Default Dark Modern' } })), [])
})

test('nothing set, nothing to do', () => {
	assert.deepEqual(legacy.legacySettingUpdates(() => undefined), [])
})
