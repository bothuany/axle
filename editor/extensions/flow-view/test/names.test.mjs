// Whether a code name still exists in the polyglot index (src/poly/names.ts), for text outside the code such as an
// agent's memory.
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
	tmp = mkdtempSync(join(tmpdir(), 'flow-names-'))
	const outfile = join(tmp, 'names.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'poly', 'names.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	n = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const files = [{
	types: [{ name: 'Project', fields: [{ name: 'files' }] }, { name: 'UserService', fields: [] }],
	funcs: [{ name: 'callers', owner: 'Project' }, { name: 'buildIndex' }],
}]

test('names split into owner and member, in each language\'s spelling', () => {
	assert.deepEqual(n.splitName('pkg.Project.callers()'), { owner: 'Project', member: 'callers' })
	assert.deepEqual(n.splitName('Project#callers'), { owner: 'Project', member: 'callers' })
	assert.deepEqual(n.splitName('Project::callers'), { owner: 'Project', member: 'callers' })
	assert.deepEqual(n.splitName('List<User>.add'), { owner: 'List', member: 'add' })
	assert.deepEqual(n.splitName('buildIndex()'), { member: 'buildIndex' })
	assert.equal(n.splitName('not a name'), undefined)
})

test('members are found under their owner; plain names as a type or a function', () => {
	const k = n.knownNames(files)
	assert.ok(n.hasName('Project.callers', k))
	assert.ok(n.hasName('Project.files', k), 'a field')
	assert.ok(n.hasName('UserService', k))
	assert.ok(n.hasName('buildIndex()', k))
	assert.ok(!n.hasName('Project.impact', k), 'a member the owner does not have')
	assert.ok(!n.hasName('UserService.callers', k), 'a member of another owner')
	assert.ok(!n.hasName('OrderService', k))
})
