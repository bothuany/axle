// Completion and go to definition in a card for the languages without a language server: answered from the polyglot index.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Index, ROOT } from './helpers.mjs'

let a
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-assist-'))
	const outfile = join(tmp, 'assist.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'poly', 'assist.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	a = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

test('the receiver chain before the cursor', () => {
	assert.deepEqual(a.chainBefore('    userService.cr'), { segs: [{ name: 'userService', call: false }], partial: 'cr' })
	assert.deepEqual(a.chainBefore('self.repo.'), { segs: [{ name: 'self', call: false }, { name: 'repo', call: false }], partial: '' })
	assert.deepEqual(a.chainBefore('$this->svc->'), { segs: [{ name: '$this', call: false }, { name: 'svc', call: false }], partial: '' })
	assert.deepEqual(a.chainBefore('Foo::ba'), { segs: [{ name: 'Foo', call: false }], partial: 'ba' })
	assert.deepEqual(a.chainBefore('x = getRepo(1, (2)).fi').segs, [{ name: 'getRepo', call: true }])
	assert.deepEqual(a.chainBefore('new Foo().').segs, [{ name: 'Foo', call: true, isNew: true }])
	assert.deepEqual(a.chainBefore('a?.b!.c').segs.map(s => s.name), ['a', 'b'])
	// not after a separator: a plain identifier, a number, an open string
	assert.equal(a.chainBefore('    userS'), undefined)
	assert.equal(a.chainBefore('x = 1.'), undefined)
	assert.equal(a.chainBefore(''), undefined)
})

test('the call that is open at the cursor', () => {
	assert.deepEqual(a.callBefore('    userService.create('), { name: 'create', segs: [{ name: 'userService', call: false }], active: 0 })
	assert.deepEqual(a.callBefore('    foo(a, g(b, c), '), { name: 'foo', segs: [], active: 2 })
	assert.equal(a.callBefore('    foo(a)'), undefined)
	assert.equal(a.callBefore('    x = [1, '), undefined)
	assert.equal(a.callBefore('    (a + b'), undefined)
})

test('the type a declaration names', () => {
	assert.equal(a.baseType('Optional<User>'), 'User')
	assert.equal(a.baseType('Promise<UserDto>'), 'UserDto')
	assert.equal(a.baseType('ResponseEntity<List<User>>'), undefined)
	assert.equal(a.baseType('*UserRepo'), 'UserRepo')
	assert.equal(a.baseType('app.models.User'), 'User')
	assert.equal(a.baseType('User | None'), 'User')
	assert.equal(a.baseType('List<User>'), undefined)
	assert.equal(a.baseType('User[]'), undefined)
	assert.equal(a.baseType(undefined), undefined)
})

test('the identifier under a column', () => {
	assert.deepEqual(a.wordAt('  foo.bar(1)', 7), { word: 'bar', start: 6, end: 9 })
	assert.deepEqual(a.wordAt('  foo.bar(1)', 9), { word: 'bar', start: 6, end: 9 })
	assert.equal(a.wordAt('  12', 3), undefined)
	assert.equal(a.wordAt('a + b', 3), undefined)
})

const fixture = (...p) => join(ROOT, 'test', 'fixtures', ...p)
const labels = r => r.items.map(i => i.label)

test('java: members after a field, in scope, and definitions', async () => {
	const index = new Index(fixture('jsf'))
	try {
		await index.ready
		const file = fixture('jsf', 'src', 'main', 'java', 'com', 'acme', 'web', 'UserBean.java')
		const lines = readFileSync(file, 'utf8').split('\n')
		const save = lines.findIndex(l => l.includes('public String save()')) + 1
		const member = await index.request('complete', { file, startLine: save, before: '        userService.' })
		assert.ok(labels(member).includes('create') && labels(member).includes('delete'), labels(member).join())
		assert.ok(!labels(member).includes('name'), 'members of UserService, not of the bean')
		const create = member.items.find(i => i.label === 'create')
		assert.equal(create.detail, '(String n)')
		assert.equal(create.kind, 1)
		assert.equal(create.insertText, 'create($1)')
		// a bare identifier: the class's own fields and methods, the parameters, the project's types
		const bare = await index.request('complete', { file, startLine: save, before: '        us' })
		for (const n of ['userService', 'name', 'save', 'remove', 'UserService']) {
			assert.ok(labels(bare).includes(n), `${n} in ${labels(bare).slice(0, 12).join()}`)
		}
		const remove = lines.findIndex(l => l.includes('public void remove')) + 1
		const inRemove = await index.request('complete', { file, startLine: remove, before: '        ' })
		assert.ok(labels(inRemove).includes('u'), 'the parameter u')
		// parameter hints: the open call and the argument the cursor is in
		const sig = await index.request('signature', { file, startLine: save, before: '        userService.create(' })
		assert.deepEqual(sig, { label: 'create(String n)', params: ['String n'], active: 0 })
		assert.equal((await index.request('signature', { file, startLine: save, before: '        userService.create(a, ' })).active, 1)
		assert.equal(await index.request('signature', { file, startLine: save, before: '        mystery.go(' }), undefined)
		// nothing known about the receiver: an answer that says why, not a failure
		const unknown = await index.request('complete', { file, startLine: save, before: '        mystery.' })
		assert.deepEqual(unknown.items, [])
		assert.match(unknown.why, /mystery/)

		// definition: the call reaches UserService.create
		const lineText = lines[save - 1]
		const def = await index.request('definition', { file, startLine: save, lineText, column: lineText.indexOf('create') + 2, cardText: lines[save - 1], cardLine: 1 })
		assert.equal(def.places.length, 1, JSON.stringify(def))
		assert.match(def.places[0].file, /UserService\.java$/)
		assert.equal(def.places[0].label, 'UserService.create')
		// on the receiver: the field that holds it
		const onField = await index.request('definition', { file, startLine: save, lineText, column: lineText.indexOf('userService') + 2, cardText: lines[save - 1], cardLine: 1 })
		assert.match(onField.places[0].file, /UserBean\.java$/)
		assert.equal(onField.places[0].line, lines.findIndex(l => l.includes('private UserService userService')) + 1)
		// on a type name
		const typed = await index.request('definition', { file, startLine: save, lineText: '    UserService s;', column: 8, cardText: lines[save - 1], cardLine: 1 })
		assert.match(typed.places[0].file, /UserService\.java$/)
		// nothing there
		const none = await index.request('definition', { file, startLine: save, lineText: '    return "list";', column: 6, cardText: lines[save - 1], cardLine: 1 })
		assert.deepEqual(none.places, [])
		assert.ok(none.message)
	} finally {
		await index.close()
	}
})

test('python: self and module globals, parameters inside the card', async () => {
	const index = new Index(fixture('fastapi'))
	try {
		await index.ready
		const service = fixture('fastapi', 'service.py')
		const main = fixture('fastapi', 'main.py')
		const find = readFileSync(service, 'utf8').split('\n').findIndex(l => l.includes('def find')) + 1
		const self = await index.request('complete', { file: service, startLine: find, before: '        self.' })
		assert.deepEqual(labels(self).sort(), ['create', 'find', 'load'])
		// `svc = UserService()` at module level: the global has the type
		const mainLines = readFileSync(main, 'utf8').split('\n')
		const get = mainLines.findIndex(l => l.includes('def get_user')) + 1
		const viaGlobal = await index.request('complete', { file: main, startLine: get, before: '    return svc.' })
		assert.ok(labels(viaGlobal).includes('find') && labels(viaGlobal).includes('create'), labels(viaGlobal).join())
		// definition of the call, and of the parameter (inside the card: the card's own line)
		const card = mainLines.slice(get - 1, get + 1).join('\n')
		const call = mainLines[get]
		const def = await index.request('definition', { file: main, startLine: get, lineText: call, column: call.indexOf('find') + 2, cardText: card, cardLine: 2 })
		assert.match(def.places[0].file, /service\.py$/)
		assert.equal(def.places[0].line, find)
		const param = await index.request('definition', { file: main, startLine: get, lineText: call, column: call.indexOf('(id)') + 2, cardText: card, cardLine: 2 })
		assert.equal(param.places[0].cardLine, 1)
		assert.equal(param.places[0].line, get)
	} finally {
		await index.close()
	}
})

test('a file the index does not know answers nothing, with a reason', async () => {
	const index = new Index(fixture('fastapi'))
	try {
		await index.ready
		const r = await index.request('complete', { file: fixture('fastapi', 'nope.py'), startLine: 1, before: 'x.' })
		assert.deepEqual(r.items, [])
		assert.ok(r.why)
	} finally {
		await index.close()
	}
})
