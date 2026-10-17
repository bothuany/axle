// What each harness file costs, always-on vs on demand, and before/after an edit (src/cost.ts).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let c
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-cost-'))
	const outfile = join(tmp, 'cost.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'cost.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	c = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const DAY = 86400000

test('the first scan records costs without calling anything a change', () => {
	const s = c.trackCosts(c.emptyCosts(), { 'CLAUDE.md': { always: 1200, onDemand: 0 } }, 0)
	assert.deepEqual(s.changes, {})
	assert.deepEqual(s.files['CLAUDE.md'], { always: 1200, onDemand: 0 })
})

test('an edit shows before and after; a second edit keeps the first "before"; undoing it clears the change', () => {
	let s = c.trackCosts(c.emptyCosts(), { 'CLAUDE.md': { always: 1200, onDemand: 0 }, 'api/CLAUDE.md': { always: 0, onDemand: 300 } }, 0)
	s = c.trackCosts(s, { 'CLAUDE.md': { always: 900, onDemand: 0 }, 'api/CLAUDE.md': { always: 0, onDemand: 300 } }, DAY)
	assert.deepEqual(s.changes['CLAUDE.md'], { before: { always: 1200, onDemand: 0 }, after: { always: 900, onDemand: 0 }, at: DAY })
	assert.equal(s.changes['api/CLAUDE.md'], undefined)
	s = c.trackCosts(s, { 'CLAUDE.md': { always: 710, onDemand: 0 }, 'api/CLAUDE.md': { always: 0, onDemand: 300 } }, 2 * DAY)
	assert.deepEqual(s.changes['CLAUDE.md'].before, { always: 1200, onDemand: 0 }, 'the whole recent trim')
	assert.equal(c.costLabel(s.files['CLAUDE.md'], s.changes['CLAUDE.md']), '710 tok (was 1.2k)')
	assert.deepEqual(c.totalsBefore(s), { always: 1200, onDemand: 300 })
	assert.deepEqual(c.totals(s.files), { always: 710, onDemand: 300 })
	s = c.trackCosts(s, { 'CLAUDE.md': { always: 1200, onDemand: 0 }, 'api/CLAUDE.md': { always: 0, onDemand: 300 } }, 3 * DAY)
	assert.equal(s.changes['CLAUDE.md'], undefined, 'back where it was: no change to show')
})

test('a new or a deleted file is not an edit; old changes expire', () => {
	let s = c.trackCosts(c.emptyCosts(), { a: { always: 100, onDemand: 0 } }, 0)
	s = c.trackCosts(s, { b: { always: 0, onDemand: 50 } }, DAY)
	assert.deepEqual(s.changes, {}, 'b is new (or newly tracked) and a went away: no "was 0"')
	s = c.trackCosts(s, { b: { always: 0, onDemand: 80 } }, 2 * DAY)
	assert.equal(c.costLabel(s.files.b, s.changes.b), '80 on demand (was 50)')
	s = c.trackCosts(s, { b: { always: 0, onDemand: 80 } }, (c.CHANGE_DAYS + 3) * DAY)
	assert.deepEqual(s.changes, {})
})

test('labels: always-on, on demand, both', () => {
	assert.equal(c.costLabel({ always: 710, onDemand: 0 }), '710 tok')
	assert.equal(c.costLabel({ always: 0, onDemand: 1200 }), '1.2k on demand')
	assert.equal(c.costLabel({ always: 40, onDemand: 1200 }), '40 tok +1.2k on demand')
	assert.equal(c.costLabel({ always: 0, onDemand: 0 }), '')
	assert.equal(c.delta(-400), '−400')
	assert.equal(c.delta(1200), '+1.2k')
	assert.deepEqual(c.loadCosts({ version: 2 }), c.emptyCosts())
})
