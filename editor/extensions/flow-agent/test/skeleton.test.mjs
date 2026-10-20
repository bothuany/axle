// Skeleton first in the dock (src/skeleton.ts): the row flow-view sends is checked for its shape, the buttons follow the stage
// and whether the agent can be typed into, every prompt is one line, and the page's messages become one action each.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let k
let d
let page
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-skeleton-'))
	const mods = {}
	for (const name of ['skeleton', 'dockMessage', 'dockPage']) {
		const outfile = join(tmp, `${name}.mjs`)
		await build({ entryPoints: [join(ROOT, 'src', `${name}.ts`)], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
		mods[name] = await import(pathToFileURL(outfile).href)
	}
	k = mods.skeleton
	d = mods.dockMessage
	page = mods.dockPage.dockHtml()
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const VIEW = { stage: 'handover', title: 'Checkout', drawn: true, summary: 'Plan vs code: 3 match · 0 missing · 1 differs', counts: { matches: 3, missing: 0, differs: 1 }, warnings: [{ id: 4, text: 'The agent changed Order.total: total(): Money → total(tax: boolean): Money', revert: true }] }

test('the row from flow-view is taken only in its own shape', () => {
	assert.deepEqual(k.readView(VIEW), VIEW)
	assert.equal(k.readView(undefined), undefined, 'no view clears the row')
	assert.equal(k.readView({ stage: 'nope' }), undefined)
	const odd = k.readView({ stage: 'design', summary: 'x'.repeat(999), warnings: [{ text: 1, id: 1 }, { text: 'no id' }, { id: 2, text: 'ok', revert: 'yes' }], counts: { matches: -3, missing: 1.5, differs: 2 }, file: '/etc/passwd' })
	assert.equal(odd.summary.length, 300)
	assert.deepEqual(odd.warnings, [{ id: 2, text: 'ok', revert: false }])
	assert.deepEqual(odd.counts, { matches: 0, missing: 0, differs: 2 })
	assert.equal('file' in odd, false)
})

test('buttons: Write and Just do it side by side once the design is drawn; Check and Hand over only at the prompt', () => {
	assert.deepEqual(k.rowActions({ ...VIEW, stage: 'design', drawn: false }, true), [], 'no design, no offer: a plan that adds no types is implemented as usual')
	assert.deepEqual(k.rowActions({ ...VIEW, stage: 'design' }, true), ['write', 'just', 'board'])
	assert.deepEqual(k.rowActions({ ...VIEW, stage: 'skeleton' }, true), ['check', 'handover', 'just', 'board'])
	assert.deepEqual(k.rowActions({ ...VIEW, stage: 'skeleton' }, false), ['just', 'board'])
	assert.deepEqual(k.rowActions(VIEW, true), ['tour', 'finish', 'board'])
})

test('prompts: one line each; Check never asks for a fix, the hand-over asks to keep the signatures and close with a tour', () => {
	for (const a of k.SKELETON_ACTIONS) {
		const p = k.skeletonPrompt(a)
		if (p !== undefined) {
			assert.equal(/[\r\n]/.test(p), false, a)
		}
	}
	assert.equal(k.skeletonPrompt('write'), undefined, 'choosing to write types nothing into the agent')
	assert.match(k.skeletonPrompt('check'), /check_skeleton/)
	assert.match(k.skeletonPrompt('check'), /Do not create or edit any file/)
	assert.match(k.skeletonPrompt('check'), /mine is better/)
	assert.match(k.skeletonPrompt('handover'), /Keep every type, signature, name and relation/)
	assert.match(k.skeletonPrompt('handover'), /tour.*"changes": true/)
	assert.match(k.skeletonPrompt('just'), /implement the approved plan now/)
})

test('the page asks for the switch, a row action or a warning by its number, and nothing else', () => {
	assert.deepEqual(d.dockAction({ type: 'skeletonFirst', on: true }), { type: 'skeletonFirst', on: true })
	assert.equal(d.dockAction({ type: 'skeletonFirst', on: 'yes' }), undefined)
	assert.deepEqual(d.dockAction({ type: 'sk', id: 'a1', action: 'handover' }), { type: 'sk', id: 'a1', action: 'handover' })
	assert.equal(d.dockAction({ type: 'sk', id: 'a1', action: 'rm' }), undefined)
	assert.equal(d.dockAction({ type: 'sk', action: 'check' }), undefined)
	assert.deepEqual(d.dockAction({ type: 'skw', id: 'a1', warning: 7, action: 'revert' }), { type: 'skw', id: 'a1', warning: 7, action: 'revert' })
	assert.equal(d.dockAction({ type: 'skw', id: 'a1', warning: -1, action: 'accept' }), undefined)
	assert.equal(d.dockAction({ type: 'skw', id: 'a1', warning: 1.5, action: 'accept' }), undefined)
	assert.equal(d.dockAction({ type: 'skw', id: 'a1', index: 0, action: 'accept' }), undefined, 'a position is not accepted')
	assert.equal(d.dockAction({ type: 'skw', id: 'a1', warning: 0, action: 'delete', file: '/x' }), undefined)
})

test('the dock draws the switch and the row: steps, counts, the warning with Accept / Revert / Open, equal actions, escaped text', () => {
	assert.match(page, /<button class="skf" id="skf" role="switch" aria-checked="false"/)
	const script = /<script>([\s\S]*)<\/script>/.exec(page)[1]
	const list = { innerHTML: '', querySelectorAll: () => [], attrs: {}, setAttribute(k, v) { this.attrs[k] = v } }
	const document = { getElementById: () => list, querySelectorAll: () => [] }
	let onMessage
	const window = { addEventListener: (_type, f) => { onMessage = f } }
	vm.runInNewContext(script, { window, document, acquireVsCodeApi: () => ({ postMessage() { } }), setInterval() { }, Math, Object, isFinite, Date, String, Number, Map })
	const row = { id: 'a1', cli: 'claude', name: 'Claude', state: 'done', since: Date.now(), todos: [], unread: false, done: 0 }
	const skeleton = { ...VIEW, warnings: [{ id: 9, text: 'The agent changed <b>x</b>: f(a) → f(a, b)', revert: true }], actions: k.rowActions(VIEW, true) }
	onMessage({ data: { type: 'data', list: [{ ...row, skeleton }], now: Date.now(), avatar: 'pixel', skeletonFirst: true } })
	assert.equal(list.attrs['aria-checked'], 'true', 'the switch shows the setting')
	assert.match(list.textContent, /^On: /)
	assert.match(list.innerHTML, /<div class="sk handover" role="group"/)
	assert.match(list.innerHTML, /<li class="now" aria-current="step">Fill<\/li>/)
	assert.match(list.innerHTML, /<span class="ok">3 match<\/span>/)
	assert.match(list.innerHTML, /<b>The agent changed &lt;b&gt;x&lt;\/b&gt;<\/b><code>f\(a\) → f\(a, b\)<\/code>/)
	assert.match(list.innerHTML, /data-skw="9" data-wa="revert"/)
	assert.match(list.innerHTML, /class="act main"[^>]*data-sk="tour"[^>]*>Closing tour/)
	assert.match(list.innerHTML, /class="sk-board"[^>]*data-sk="board"/)
	onMessage({ data: { type: 'data', list: [{ ...row, skeleton: { ...VIEW, stage: 'design', warnings: [], counts: undefined, actions: ['write', 'just', 'board'] } }], now: Date.now(), avatar: 'pixel', skeletonFirst: false } })
	assert.equal(list.attrs['aria-checked'], 'false')
	assert.match(list.innerHTML, /<div class="sk-acts"><span class="act main"[^>]*data-sk="write"[^>]*>Write the skeleton<\/span><span class="act"[^>]*data-sk="just"[^>]*>Just do it<\/span><\/div>/, 'Write and Just do it share one group, equal width')
})

test('the reminder Claude reads when a plan is approved names the tool and never asks for a lock', () => {
	assert.match(k.SKELETON_GATE, /check_skeleton/)
	assert.match(k.SKELETON_GATE, /Before you create or edit any file/)
	assert.match(k.SKELETON_GATE, /go ahead as usual/)
	assert.equal(/[\r\n]/.test(k.SKELETON_GATE), false)
})
