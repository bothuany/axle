// What the index worker keeps after an edit: nothing a deleted or changed file used to add. Go methods and Rust impls declared in
// another file of the package, and the bean methods a JSF page names, leave with the code that added them.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Index, ROOT } from './helpers.mjs'
import { cleanup, temp } from './bundle.mjs'

after(cleanup)

// The long name of a temp folder: a Windows runner's temp path may be an 8.3 short name, and the index reports the names it walks.
const tempDir = prefix => realpathSync.native(temp(prefix))

const typeOf = (facts, file, name) => facts.files.find(f => f.file === file)?.types.find(t => t.name === name)

test('a Go method in another file of the package leaves its type when it is deleted there', async () => {
	const dir = tempDir('flow-stub-go-')
	writeFileSync(join(dir, 'handler.go'), 'package api\n\ntype Handler struct {\n\tName string\n}\n\nfunc (h *Handler) Get() string { return h.Name }\n')
	const routes = join(dir, 'routes.go')
	writeFileSync(routes, 'package api\n\nfunc (h *Handler) List() []string { return nil }\n')
	const index = new Index(dir)
	try {
		await index.ready
		const handler = join(dir, 'handler.go')
		assert.deepEqual(typeOf(await index.request('typeFacts'), handler, 'Handler').methods.sort(), ['Get', 'List'])
		writeFileSync(routes, 'package api\n\nfunc helper() {}\n')
		await index.request('changed', routes)
		assert.deepEqual(typeOf(await index.request('typeFacts'), handler, 'Handler').methods, ['Get'], 'List went with routes.go, though handler.go was not parsed again')
	} finally {
		await index.close()
	}
})

test('a Rust impl in another file adds the trait to the struct only while it is there', async () => {
	const dir = tempDir('flow-stub-rust-')
	writeFileSync(join(dir, 'store.rs'), 'pub trait Repo {\n    fn load(&self) -> u32;\n}\n\npub struct PgStore {\n    pub url: String,\n}\n')
	const impls = join(dir, 'impls.rs')
	writeFileSync(impls, 'impl Repo for PgStore {\n    fn load(&self) -> u32 { 1 }\n}\n')
	const index = new Index(dir)
	try {
		await index.ready
		const store = join(dir, 'store.rs')
		assert.ok(typeOf(await index.request('typeFacts'), store, 'PgStore').supers.includes('Repo'))
		writeFileSync(impls, 'pub fn nothing() {}\n')
		await index.request('changed', impls)
		assert.equal(typeOf(await index.request('typeFacts'), store, 'PgStore').supers.includes('Repo'), false)
	} finally {
		await index.close()
	}
})

test('a deleted JSF page takes its bean methods out of the entry points', async () => {
	const dir = tempDir('flow-jsf-')
	cpSync(join(ROOT, 'test', 'fixtures', 'jsf'), dir, { recursive: true })
	const page = join(dir, 'src', 'main', 'webapp', 'users.xhtml')
	const index = new Index(dir)
	try {
		await index.ready
		const jsf = async () => (await index.request('entries')).filter(e => e.http.startsWith('JSF')).map(e => e.http).sort()
		assert.deepEqual(await jsf(), ['JSF #{userBean.remove}', 'JSF #{userBean.save}'])
		rmSync(page)
		await index.request('changed', page)
		assert.deepEqual(await jsf(), [])
	} finally {
		await index.close()
	}
})
