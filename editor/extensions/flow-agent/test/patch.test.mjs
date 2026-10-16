// The files a Codex apply_patch touches, read from the patch headers (src/patch.ts).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let p
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-patch-'))
	const outfile = join(tmp, 'patch.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'patch.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	p = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const PATCH = [
	'*** Begin Patch',
	'*** Update File: src/a.ts',
	'@@ class A',
	' keep',
	'-old',
	'+new',
	'*** Add File: src/new.ts',
	'+export const x = 1',
	'*** Delete File: src/gone.ts',
	'*** End Patch',
].join('\n')

test('reads add, update and delete headers in order', () => {
	assert.deepEqual(p.parsePatch(PATCH), [
		{ op: 'update', file: 'src/a.ts' },
		{ op: 'add', file: 'src/new.ts' },
		{ op: 'delete', file: 'src/gone.ts' },
	])
})

test('a move belongs to the update above it', () => {
	const ops = p.parsePatch('*** Begin Patch\n*** Update File: old/name.py\n*** Move to: new/name.py\n@@\n-a\n+b\n*** End Patch')
	assert.deepEqual(ops, [{ op: 'update', file: 'old/name.py', moveTo: 'new/name.py' }])
})

test('a move line under an add or delete is ignored', () => {
	const ops = p.parsePatch('*** Begin Patch\n*** Delete File: x.go\n*** Move to: y.go\n*** End Patch')
	assert.deepEqual(ops, [{ op: 'delete', file: 'x.go' }])
})

test('CRLF line endings and trailing spaces', () => {
	const ops = p.parsePatch('*** Begin Patch\r\n*** Update File: src\\win.cs  \r\n@@\r\n-a\r\n+b\r\n*** End Patch\r\n')
	assert.deepEqual(ops, [{ op: 'update', file: 'src\\win.cs' }])
})

test('headers inside file content are content, not headers', () => {
	const ops = p.parsePatch([
		'*** Begin Patch',
		'*** Add File: docs/patch-format.md',
		'+*** Update File: not/a/real/file.ts',
		'+*** End Patch',
		'*** Update File: README.md',
		'@@',
		' *** End Patch',
		' *** Delete File: also/not/real.ts',
		'+more',
		'*** End Patch',
	].join('\n'))
	assert.deepEqual(ops, [{ op: 'add', file: 'docs/patch-format.md' }, { op: 'update', file: 'README.md' }])
})

test('nothing outside Begin/End Patch counts', () => {
	assert.deepEqual(p.parsePatch('echo "*** Update File: a.ts"\n*** Delete File: b.ts'), [])
	const ops = p.parsePatch('*** Update File: before.ts\n*** Begin Patch\n*** Add File: in.ts\n+x\n*** End Patch\n*** Delete File: after.ts')
	assert.deepEqual(ops, [{ op: 'add', file: 'in.ts' }])
})

test('a patch without its end marker runs to the end of the text', () => {
	assert.deepEqual(p.parsePatch('*** Begin Patch\n*** Update File: a.rs\n@@\n-x\n+y'), [{ op: 'update', file: 'a.rs' }])
})

test('two patches in one command', () => {
	const two = '*** Begin Patch\n*** Add File: one.ts\n+1\n*** End Patch\n*** Begin Patch\n*** Add File: two.ts\n+2\n*** End Patch'
	assert.deepEqual(p.parsePatch(two).map(o => o.file), ['one.ts', 'two.ts'])
})

test('patch as a heredoc in a shell command', () => {
	const cmd = `apply_patch <<'EOF'\n${PATCH}\nEOF`
	assert.deepEqual(p.parsePatch(cmd).map(o => o.file), ['src/a.ts', 'src/new.ts', 'src/gone.ts'])
})

test('empty and malformed input', () => {
	assert.deepEqual(p.parsePatch(''), [])
	assert.deepEqual(p.parsePatch('*** Begin Patch\n*** End Patch'), [])
	assert.deepEqual(p.parsePatch('*** Begin Patch\n*** Update File:\n*** End Patch'), [])
})

test('patchText takes a string command, an argv command, or input/patch fields', () => {
	assert.equal(p.patchText({ command: 'x' }), 'x')
	assert.equal(p.patchText({ command: ['apply_patch', PATCH] }), `apply_patch\n${PATCH}`)
	assert.equal(p.patchText({ input: 'y' }), 'y')
	assert.equal(p.patchText({ command: 42 }), '')
	assert.equal(p.patchText(undefined), '')
})

test('patchFiles resolves against cwd and lists both ends of a move once each', () => {
	const cwd = resolve(tmpdir(), 'repo')
	const input = { command: ['apply_patch', '*** Begin Patch\n*** Update File: a.ts\n*** Move to: b.ts\n@@\n-x\n+y\n*** Update File: a.ts\n@@\n-y\n+z\n*** End Patch'] }
	assert.deepEqual(p.patchFiles(input, cwd), [join(cwd, 'a.ts'), join(cwd, 'b.ts')])
})

test('patchFiles keeps absolute paths and leaves relative ones as written without cwd', () => {
	const absFile = resolve(tmpdir(), 'abs', 'c.ts')
	const input = { command: `*** Begin Patch\n*** Delete File: ${absFile}\n*** Add File: rel/d.ts\n+1\n*** End Patch` }
	assert.deepEqual(p.patchFiles(input, resolve(tmpdir(), 'elsewhere')), [absFile, resolve(tmpdir(), 'elsewhere', 'rel', 'd.ts')])
	assert.deepEqual(p.patchFiles(input, undefined), [absFile, join('rel', 'd.ts')])
})

test('patchFiles of a call that is not a patch is empty', () => {
	assert.deepEqual(p.patchFiles({ command: 'ls -la' }, '/repo'), [])
	assert.deepEqual(p.patchFiles(undefined, '/repo'), [])
})
