// What Claude Code's status line and the transcripts of both CLIs say about the context window and the plan's limits (src/usage.ts).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let u
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-usage-'))
	const outfile = join(tmp, 'usage.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'usage.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	u = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

// The shape Claude Code 2.1.302 builds for its status-line command (field names read from the CLI itself).
const status = {
	session_id: 'abc',
	transcript_path: '/home/me/.claude/projects/x/abc.jsonl',
	model: { id: 'claude-sonnet-5-5[1m]', display_name: 'Sonnet 5.5' },
	context_window: {
		total_input_tokens: 66_700,
		total_output_tokens: 1200,
		context_window_size: 1_000_000,
		current_usage: { input_tokens: 700, cache_creation_input_tokens: 1000, cache_read_input_tokens: 65_000, output_tokens: 1200 },
		used_percentage: 7,
		remaining_percentage: 93,
	},
	exceeds_200k_tokens: false,
	rate_limits: {
		five_hour: { used_percentage: 32.4, resets_at: 1_760_000_000 },
		seven_day: { used_percentage: 61, resets_at: 1_760_400_000 },
	},
}

test('the status line gives the real window: a 1M session is not taken for 200k', () => {
	const r = u.parseClaudeStatus(status)
	assert.equal(r.sessionId, 'abc')
	assert.equal(r.transcript, status.transcript_path)
	assert.deepEqual(r.usage, { used: 66_700, size: 1_000_000, model: 'Sonnet 5.5' })
})

test('the 5-hour and weekly limits come through with their reset times in ms', () => {
	const r = u.parseClaudeStatus(status)
	assert.deepEqual(r.limits, {
		harness: 'Claude Code',
		windows: [
			{ label: '5h', usedPercent: 32.4, resetsAt: 1_760_000_000_000 },
			{ label: 'wk', usedPercent: 61, resetsAt: 1_760_400_000_000 },
		],
	})
})

test('before the first request (no current_usage) the window still shows, with nothing used', () => {
	const r = u.parseClaudeStatus({ ...status, context_window: { total_input_tokens: 0, total_output_tokens: 0, context_window_size: 200_000, current_usage: null, used_percentage: null, remaining_percentage: null } })
	assert.deepEqual(r.usage, { used: 0, size: 200_000, model: 'Sonnet 5.5' })
})

test('an API-key session has no rate_limits: no limits, nothing invented', () => {
	const { rate_limits, ...rest } = status
	assert.equal(u.parseClaudeStatus(rest).limits, undefined)
	assert.equal(u.parseClaudeStatus({ ...rest, rate_limits: {} }).limits, undefined)
	// Only one window known: only that one.
	assert.deepEqual(u.parseClaudeStatus({ ...rest, rate_limits: { seven_day: { used_percentage: 5 } } }).limits, { harness: 'Claude Code', windows: [{ label: 'wk', usedPercent: 5 }] })
})

test('without a context_window there is no usage, and a missing size stays missing', () => {
	assert.equal(u.parseClaudeStatus({ session_id: 'x', model: { id: 'm' } }).usage, undefined)
	assert.deepEqual(u.parseClaudeStatus({ context_window: { total_input_tokens: 10 } }).usage, { used: 10 })
	assert.deepEqual(u.parseClaudeStatus(null), { sessionId: undefined, transcript: undefined, usage: undefined, limits: undefined })
})

test('reset times: epoch seconds, ms and ISO strings all land in ms', () => {
	assert.equal(u.resetTime(1_760_000_000), 1_760_000_000_000)
	assert.equal(u.resetTime(1_760_000_000_000), 1_760_000_000_000)
	assert.equal(u.resetTime('2025-10-09T08:53:20.000Z'), Date.parse('2025-10-09T08:53:20.000Z'))
	assert.equal(u.resetTime('soon'), undefined)
	assert.equal(u.resetTime(undefined), undefined)
})

test('a Claude transcript gives the tokens and never a window', () => {
	const lines = [
		JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5-5', usage: { input_tokens: 10, cache_read_input_tokens: 300_000, cache_creation_input_tokens: 5 } } }),
		JSON.stringify({ type: 'user', message: {} }),
		'{"partial',
	]
	assert.deepEqual(u.claudeTranscriptUsage(lines), { used: 300_015, model: 'claude-sonnet-5-5' })
	assert.equal(u.claudeTranscriptUsage(['{}', 'nope']), undefined)
})

test('a merge keeps the window the status line gave when the transcript reports without one', () => {
	const before = { used: 1000, size: 1_000_000, model: 'Sonnet 5.5' }
	assert.deepEqual(u.mergeUsage(before, { used: 2000 }), { used: 2000, size: 1_000_000, model: 'Sonnet 5.5' })
	assert.deepEqual(u.mergeUsage(undefined, { used: 5 }), { used: 5 })
})

// The rollout lines Codex writes (TokenCountEvent: info + rate_limits; field names read from codex 0.162).
const codex = [
	JSON.stringify({ timestamp: 't0', type: 'turn_context', payload: { cwd: '/p', model: 'gpt-5.5-codex' } }),
	JSON.stringify({ timestamp: 't1', type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: { primary: { used_percent: 12, window_minutes: 300, resets_at: 1_760_000_000 }, secondary: { used_percent: 40, window_minutes: 10080, resets_at: 1_760_500_000 } } } }),
	JSON.stringify({ timestamp: 't2', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 90_000, output_tokens: 9000, total_tokens: 99_000 }, last_token_usage: { input_tokens: 30_000, cached_input_tokens: 20_000, output_tokens: 1000, total_tokens: 31_000 }, model_context_window: 272_000 }, rate_limits: null } }),
	JSON.stringify({ timestamp: 't3', type: 'response_item', payload: { type: 'message' } }),
]

test('Codex: context from the last request, window from model_context_window, limits from the newest event that has them', () => {
	const r = u.codexRolloutUsage(codex)
	assert.deepEqual(r.usage, { used: 31_000, size: 272_000, model: 'gpt-5.5-codex' })
	assert.deepEqual(r.limits, {
		harness: 'Codex',
		windows: [
			{ label: '5h', usedPercent: 12, resetsAt: 1_760_000_000_000 },
			{ label: 'wk', usedPercent: 40, resetsAt: 1_760_500_000_000 },
		],
	})
})

test('Codex: nothing reported means nothing shown', () => {
	assert.deepEqual(u.codexRolloutUsage([codex[0], codex[3]]), { usage: undefined, limits: undefined })
	const noWindow = JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { total_tokens: 50 } } } })
	assert.deepEqual(u.codexRolloutUsage([noWindow]).usage, { used: 50 })
})

test('window labels', () => {
	assert.equal(u.windowLabel(300), '5h')
	assert.equal(u.windowLabel(10080), 'wk')
	assert.equal(u.windowLabel(1440), '1d')
	assert.equal(u.windowLabel(45), '45m')
	assert.equal(u.windowLabel(undefined), '')
})
