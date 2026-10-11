// Which paths the index leaves out: the walk, the file watcher and the language server share isExcludedPath.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT } from './helpers.mjs'

const BS = String.fromCharCode(92)
let isExcludedPath
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-exclude-'))
	const outfile = join(tmp, 'model.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'poly', 'model.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	;({ isExcludedPath } = await import(pathToFileURL(outfile).href))
})
after(() => rmSync(tmp, { recursive: true, force: true }))

/** A folder with the given files (a trailing slash makes a directory). */
function project(name, ...entries) {
	const root = join(tmp, name)
	for (const e of entries) {
		if (e.endsWith('/')) {
			mkdirSync(join(root, e), { recursive: true })
		} else {
			mkdirSync(join(root, e, '..'), { recursive: true })
			writeFileSync(join(root, e), '')
		}
	}
	return root
}

test('dependency and cache directories are excluded, with either path separator', () => {
	const root = project('deps', 'node_modules/lib/a.js', 'src/pkg/__pycache__/b.py', 'src/c.py')
	for (const rel of ['node_modules/lib/a.js', 'src/pkg/__pycache__/b.py']) {
		assert.equal(isExcludedPath(join(root, ...rel.split('/')), root), true, rel)
		assert.equal(isExcludedPath(`${root}/${rel}`, root), true, `${rel} with forward slashes`)
		if (process.platform === 'win32') {
			assert.equal(isExcludedPath(`${root}${BS}${rel.replaceAll('/', BS)}`, root), true, `${rel} with backslashes`)
		}
	}
	assert.equal(isExcludedPath(join(root, 'src', 'c.py'), root), false)
	assert.equal(isExcludedPath(join(root, 'top.py'), root), false)
})

test('build, out and target are excluded only beside the file that produces them', () => {
	const maven = project('maven', 'pom.xml', 'target/classes/A.java', 'src/main/java/com/acme/build/B.java', 'src/main/java/com/acme/out/C.java')
	assert.equal(isExcludedPath(join(maven, 'target', 'classes', 'A.java'), maven), true)
	assert.equal(isExcludedPath(join(maven, 'src', 'main', 'java', 'com', 'acme', 'build', 'B.java'), maven), false, 'a package called build')
	assert.equal(isExcludedPath(join(maven, 'src', 'main', 'java', 'com', 'acme', 'out', 'C.java'), maven), false, 'a package called out')
	const plain = project('plain', 'target/D.java', 'build/E.java')
	assert.equal(isExcludedPath(join(plain, 'target', 'D.java'), plain), false)
	assert.equal(isExcludedPath(join(plain, 'build', 'E.java'), plain), false)
	const node = project('node', 'package.json', 'build/F.js', 'out/G.js')
	assert.equal(isExcludedPath(join(node, 'build', 'F.js'), node), true)
	assert.equal(isExcludedPath(join(node, 'out', 'G.js'), node), true)
})

test('vendor, bin and env need their own markers; public, static and assets are never excluded', () => {
	const go = project('go', 'go.mod', 'vendor/x/x.go', 'public/p.js', 'static/s.js', 'assets/a.js')
	assert.equal(isExcludedPath(join(go, 'vendor', 'x', 'x.go'), go), true)
	for (const d of ['public', 'static', 'assets']) {
		assert.equal(isExcludedPath(join(go, d, `${d[0]}.js`), go), false, d)
	}
	const dotnet = project('dotnet', 'App.csproj', 'bin/x.js', 'obj/y.js')
	assert.equal(isExcludedPath(join(dotnet, 'bin', 'x.js'), dotnet), true)
	assert.equal(isExcludedPath(join(dotnet, 'obj', 'y.js'), dotnet), true)
	const py = project('py', 'env/pyvenv.cfg', 'env/lib/z.py', 'app/env/w.py')
	assert.equal(isExcludedPath(join(py, 'env', 'lib', 'z.py'), py), true, 'a virtualenv')
	assert.equal(isExcludedPath(join(py, 'app', 'env', 'w.py'), py), false, 'a package called env')
})

test('only the path below the workspace folder counts, not the folders above it', () => {
	const root = join(project('above', 'build/', 'package.json'), 'build', 'app')
	mkdirSync(join(root, 'src'), { recursive: true })
	assert.equal(isExcludedPath(join(root, 'src', 'x.py'), root), false)
	assert.equal(isExcludedPath(join(tmp, 'elsewhere', 'node_modules', 'y.js'), root), false, 'a file outside the folder is not this filter\'s business')
})
