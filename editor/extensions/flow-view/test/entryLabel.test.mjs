// How an endpoint is shown in a list (src/entryLabel.ts): the route first, then the service and the handler.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT } from './helpers.mjs'

let l
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-entrylabel-'))
	const outfile = join(tmp, 'entryLabel.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'entryLabel.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	l = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

test('a class-based handler keeps its class name, after the service folder', () => {
	assert.deepEqual(
		l.entryDisplay({ http: 'POST /api/orders', controller: 'OrderController', action: 'place', file: 'x' }, 'orders-service/src/main/java/com/acme/OrderController.java'),
		{ title: 'POST /api/orders', detail: 'orders-service · OrderController.place' })
})

test('a module-level function is named by itself, not by its module (every service has a main)', () => {
	assert.deepEqual(
		l.entryDisplay({ http: 'POST /invoices', controller: 'main', action: 'create_invoice', file: 'x' }, 'billing-service/app/main.py'),
		{ title: 'POST /invoices', detail: 'billing-service · create_invoice' })
})

test('an inline handler is named by its file', () => {
	assert.deepEqual(
		l.entryDisplay({ http: 'POST /bff/checkout', controller: 'server', action: '/bff/checkout', file: 'x' }, 'bff/src/server.ts'),
		{ title: 'POST /bff/checkout', detail: 'bff · server.ts' })
})

test('no service folder for a single project at the root', () => {
	assert.equal(l.entryDisplay({ http: 'GET /orders', controller: 'orders', action: 'listOrders', file: 'x' }, 'server/orders.js').detail, 'listOrders')
	assert.equal(l.entryDisplay({ http: 'GET /orders', controller: 'orders', action: 'listOrders', file: 'x' }, 'app.js').detail, 'listOrders')
})
