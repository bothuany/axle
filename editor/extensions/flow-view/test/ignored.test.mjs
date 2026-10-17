// What git ignores stays out of the index (src/poly/ignored.ts): build output, generated code, vendored checkouts.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Index, ROOT } from './helpers.mjs'

let g
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-ignored-'))
	const outfile = join(tmp, 'ignored.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'poly', 'ignored.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	g = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

test('git output: directories and files become absolute paths; anything below an ignored folder is ignored', () => {
	const root = join(tmpdir(), 'repo')
	const set = g.parseIgnored(root, 'gen/\nnotes.local.js\r\nvendor/sdk/\n\n')
	assert.equal(set.size, 3)
	assert.equal(g.isIgnored(join(root, 'gen', 'a', 'b.ts'), set), true)
	assert.equal(g.isIgnored(join(root, 'gen'), set), true)
	assert.equal(g.isIgnored(join(root, 'notes.local.js'), set), true)
	assert.equal(g.isIgnored(join(root, 'vendor', 'sdk', 'x.go'), set), true)
	assert.equal(g.isIgnored(join(root, 'vendor', 'own.go'), set), false)
	assert.equal(g.isIgnored(join(root, 'generated.ts'), set), false, 'a name that only starts like an ignored folder')
	assert.equal(g.isIgnored(join(root, 'src', 'x.ts'), new Set()), false)
})

test('on Windows the drive letter and case do not matter', { skip: process.platform !== 'win32' }, () => {
	const set = g.parseIgnored('C:\\Repo', 'Gen/\n')
	assert.equal(g.isIgnored('c:\\repo\\gen\\x.ts', set), true)
})

test('outside a git repository nothing is ignored', () => {
	const plain = mkdtempSync(join(tmpdir(), 'flow-noGit-'))
	try {
		assert.equal(g.gitIgnored(plain).size, 0)
	} finally {
		rmSync(plain, { recursive: true, force: true })
	}
})

// End to end: an ignored folder's routes never reach the endpoint list; a tracked file matching the pattern still does.
let index
let dir
test('the index skips what .gitignore names, the way git status does', async t => {
	dir = mkdtempSync(join(tmpdir(), 'flow-ignored-e2e-'))
	const files = {
		'.gitignore': 'gen/\n*.local.js\n',
		'app.js': "const app = require('express')();\nfunction list(req, res) {}\napp.get('/orders', list);\n",
		'gen/routes.js': "const app = require('express')();\nfunction gen(req, res) {}\napp.get('/generated', gen);\n",
		'dev.local.js': "const app = require('express')();\nfunction dev(req, res) {}\napp.get('/dev', dev);\n",
		'nested/.gitignore': 'scratch/\n',
		'nested/scratch/try.js': "const app = require('express')();\nfunction tryIt(req, res) {}\napp.get('/try', tryIt);\n",
		'kept.local.js': "const app = require('express')();\nfunction kept(req, res) {}\napp.get('/kept', kept);\n",
	}
	for (const [f, text] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, f)), { recursive: true })
		writeFileSync(join(dir, f), text)
	}
	const git = (...a) => assert.equal(spawnSync('git', a, { cwd: dir }).status, 0, `git ${a.join(' ')}`)
	git('init', '-q')
	git('add', '.gitignore', 'app.js', 'nested/.gitignore')
	git('add', '-f', 'kept.local.js') // tracked although it matches *.local.js: git does not ignore it
	git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x')

	index = new Index(dir)
	t.after(async () => { await index.close(); rmSync(dir, { recursive: true, force: true }) })
	await index.ready
	const routes = (await index.request('entries')).map(e => e.http).sort()
	assert.deepEqual(routes, ['GET /kept', 'GET /orders'])

	// A change to an ignored file does not bring it in.
	writeFileSync(join(dir, 'gen', 'routes.js'), files['gen/routes.js'] + "app.get('/more', gen);\n")
	await index.request('changed', join(dir, 'gen', 'routes.js'))
	assert.deepEqual((await index.request('entries')).map(e => e.http).sort(), ['GET /kept', 'GET /orders'])
})
