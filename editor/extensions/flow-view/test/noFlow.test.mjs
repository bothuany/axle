// Why there is no flow at the cursor (src/noFlow.ts): a reason a developer can act on, not "no language server".
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT } from './helpers.mjs'

let n
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-noflow-'))
	const outfile = join(tmp, 'noFlow.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'noFlow.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	n = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

test('a file with errors says where, whatever the language', () => {
	assert.match(n.noFlowReason('typescript', [7]), /errors \(line 7\).*Fix them/)
	assert.match(n.noFlowReason('lua', [3, 1, 3]), /errors \(lines 1, 3\)/)
	assert.match(n.noFlowReason('python', [1, 2, 3, 4, 5]), /lines 1, 2, 3…/)
})

test('a traced language without errors: the cursor is outside a function', () => {
	for (const id of ['java', 'python', 'typescriptreact', 'go', 'csharp']) {
		assert.match(n.noFlowReason(id, []), /no function at the cursor/, id)
	}
})

test('another language: say it is not traced, by its name, and what would make it work', () => {
	assert.match(n.noFlowReason('lua', []), /does not trace Lua yet.*call hierarchy/)
	assert.match(n.noFlowReason('zig', []), /does not trace zig yet/)
	assert.doesNotMatch(n.noFlowReason('lua', []), /Is the language extension installed/)
})
