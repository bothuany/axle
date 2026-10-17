// How the context rows and the usage-limit status bar items read, and what a report from flow-agent must hold (src/budget.ts).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let b
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-budget-'))
	const outfile = join(tmp, 'budget.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'budget.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	b = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

test('a 1M session reads as 1M, with a bar and a percentage', () => {
	const u = b.toUsage({ agent: 'Claude 1', harness: 'Claude Code', model: 'Sonnet 5.5', used: 66_700, size: 1_000_000 })
	assert.equal(b.usageLine(u), 'Sonnet 5.5 · 66.7k / 1M ▰▱▱▱▱▱▱▱▱▱ 7%')
})

test('an unknown window shows the tokens and no percentage, never a 200k guess', () => {
	assert.equal(b.usageLine(b.toUsage({ agent: 'a', used: 66_700 })), '66.7k tokens')
	assert.equal(b.usageLine(b.toUsage({ agent: 'a', used: 66_700, size: 0 })), '66.7k tokens')
	assert.equal(b.share(b.toUsage({ agent: 'a', used: 5 })), undefined)
})

test('reports that are not reports are dropped', () => {
	assert.equal(b.toUsage(undefined), undefined)
	assert.equal(b.toUsage({ agent: '', used: 1 }), undefined)
	assert.equal(b.toUsage({ agent: 'a', used: -1 }), undefined)
	assert.equal(b.toUsage({ agent: 'a', used: '5' }), undefined)
	assert.equal(b.toLimits({ harness: 'Claude Code', windows: [] }), undefined)
	assert.equal(b.toLimits({ harness: 'Claude Code', windows: [{ label: '5h' }] }), undefined)
	assert.equal(b.toLimits({ windows: [{ label: '5h', usedPercent: 3 }] }), undefined)
})

test('the status bar text: one compact item per harness', () => {
	const l = b.toLimits({ harness: 'Claude Code', windows: [{ label: '5h', usedPercent: 32.4, resetsAt: 1 }, { label: 'wk', usedPercent: 61 }] })
	assert.equal(b.limitsText(l), 'Claude 5h 32% · wk 61%')
	assert.equal(b.limitsText(b.toLimits({ harness: 'Codex', windows: [{ label: '5h', usedPercent: 140 }] })), 'Codex 5h 100%')
})

test('the tooltip says what is used, what is left and when it resets', () => {
	const now = Date.UTC(2026, 9, 17, 12, 0)
	const l = b.toLimits({ harness: 'Claude Code', windows: [{ label: '5h', usedPercent: 32, resetsAt: now + 95 * 60_000 }, { label: 'wk', usedPercent: 61, resetsAt: now + 3 * 24 * 3_600_000 + 2 * 3_600_000 }, { label: '1d', usedPercent: 1 }] })
	assert.deepEqual(b.limitLines(l, now, () => 'T'), [
		'5-hour limit: 32% used, 68% left, resets T (in 1 h 35 min)',
		'Weekly limit: 61% used, 39% left, resets T (in 3 days 2 h)',
		'1d limit: 1% used, 99% left',
	])
})

test('the colour follows the fullest window', () => {
	assert.equal(b.limitLevel({ harness: 'x', windows: [{ label: '5h', usedPercent: 10 }, { label: 'wk', usedPercent: 92 }] }), 'high')
	assert.equal(b.limitLevel({ harness: 'x', windows: [{ label: '5h', usedPercent: 80 }] }), 'warn')
	assert.equal(b.limitLevel({ harness: 'x', windows: [{ label: '5h', usedPercent: 10 }] }), 'ok')
})

test('token amounts', () => {
	assert.equal(b.fmtTokens(950), '950')
	assert.equal(b.fmtTokens(66_700), '66.7k')
	assert.equal(b.fmtTokens(272_000), '272k')
	assert.equal(b.fmtTokens(1_000_000), '1M')
	assert.equal(b.fmtTokens(1_500_000), '1.5M')
})
