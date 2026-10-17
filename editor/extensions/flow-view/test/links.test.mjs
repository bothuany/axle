// HTTP client calls matched to the endpoints they may reach (src/poly/links.ts), and the flow going on into them.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Index, ROOT } from './helpers.mjs'

let l
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-links-'))
	const outfile = join(tmp, 'links.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'poly', 'links.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	l = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const call = (name, recv, strings, chain) => ({ name, recv, line: 1, strings, ...(chain ? { chain } : {}) })

test('path segments: every parameter spelling is one wildcard; scheme, host, query go', () => {
	assert.deepEqual(l.pathSegments('/users/{id}/orders/:orderId'), { segments: ['users', '*', 'orders', '*'], openStart: false })
	assert.deepEqual(l.pathSegments('/a/<int:id>/b/[slug]/c/*'), { segments: ['a', '*', 'b', '*', 'c', '*'], openStart: false })
	assert.deepEqual(l.pathSegments('https://orders.svc:8080/api/Orders?x=1#top'), { segments: ['api', 'orders'], openStart: false })
	assert.deepEqual(l.pathSegments('{…}/orders/{…}'), { segments: ['orders', '*'], openStart: true })
	assert.deepEqual(l.pathSegments(' /orders'), { segments: ['orders'], openStart: true })
})

test('path segments: a concatenated variable (a blank) is a parameter, wherever it is', () => {
	// '/api/orders/' + id
	assert.deepEqual(l.pathSegments('/api/orders/ '), { segments: ['api', 'orders', '*'], openStart: false })
	// '/api/orders/' + id + '/items'
	assert.deepEqual(l.pathSegments('/api/orders/ /items'), { segments: ['api', 'orders', '*', 'items'], openStart: false })
	// '/api/orders-' + id: the segment is not all written out
	assert.deepEqual(l.pathSegments('/api/orders- '), { segments: ['api', '*'], openStart: false })
	assert.deepEqual(l.pathSegments('/api/orders/'), { segments: ['api', 'orders'], openStart: false })
	// '/api/orders?page=' + n: the query goes, with its variable
	assert.deepEqual(l.pathSegments('/api/orders?page= '), { segments: ['api', 'orders'], openStart: false })
})

test('match: a concatenated id reaches the item route, not the list', () => {
	const entries = [{ id: 'list', http: 'GET /api/orders' }, { id: 'one', http: 'GET /api/orders/:id' }, { id: 'items', http: 'GET /api/orders/:id/items' }]
	const reach = s => l.matchEndpoints(l.httpCallOf('js', call('get', 'axios', [s])), entries).map(e => e.id)
	assert.deepEqual(reach('/api/orders/ '), ['one'])
	assert.deepEqual(reach('/api/orders/ /items'), ['items'])
	assert.deepEqual(reach('/api/orders'), ['list'])
})

test('js: fetch, axios and an Angular-style this.http are HTTP calls; app.get is not', () => {
	assert.deepEqual(l.httpCallOf('js', call('fetch', undefined, ['/api/orders'])), { verb: null, segments: ['api', 'orders'], openStart: false, url: '/api/orders' })
	assert.equal(l.httpCallOf('js', call('post', 'axios', ['{…}/refunds'])).verb, 'POST')
	assert.equal(l.httpCallOf('js', call('get', 'this.http', ['/api/users/{…}'])).verb, 'GET')
	assert.equal(l.httpCallOf('js', call('get', 'app', ['/orders'])), undefined)
	assert.equal(l.httpCallOf('js', call('get', 'client', ['user:1'])), undefined, 'a cache key is not a URL')
	assert.equal(l.httpCallOf('js', call('fetch', undefined, [])), undefined)
	assert.equal(l.httpCallOf('js', call('fetch', undefined, ['/{…}'])), undefined, 'nothing written')
})

test('python: requests, httpx and a session are HTTP calls', () => {
	assert.equal(l.httpCallOf('python', call('get', 'requests', ['http://billing/api/invoices/{…}'])).verb, 'GET')
	assert.equal(l.httpCallOf('python', call('post', 'self.session', ['/charge'])).verb, 'POST')
	assert.equal(l.httpCallOf('python', call('get', 'cache', ['/x'])), undefined)
})

test('java: RestTemplate verbs and a WebClient chain', () => {
	assert.equal(l.httpCallOf('java', call('postForObject', 'restTemplate', ['http://orders/api/orders'])).verb, 'POST')
	assert.equal(l.httpCallOf('java', call('exchange', 'this.restTemplate', ['/api/orders/{id}'])).verb, null)
	assert.equal(l.httpCallOf('java', call('get', 'webClient', ['/api/orders'], ['uri', 'retrieve', 'bodyToMono'])).verb, 'GET')
	assert.equal(l.httpCallOf('java', call('get', 'webClient', ['/api/orders'])), undefined, 'no uri() in the chain')
	assert.equal(l.httpCallOf('go', call('Get', 'http', ['/x'])), undefined, 'not read for Go yet')
})

const ENTRIES = [
	{ id: 'list', http: 'GET /api/orders' },
	{ id: 'one', http: 'GET /api/orders/:id' },
	{ id: 'make', http: 'POST /api/orders' },
	{ id: 'refund', http: 'POST /api/orders/{id}/refund' },
	{ id: 'any', http: '* /api/health' },
]
const match = (verb, url) => {
	const { segments, openStart } = l.pathSegments(url)
	return l.matchEndpoints({ verb, segments, openStart, url }, ENTRIES).map(e => e.id)
}

test('match: verb and path must agree; a parameter takes one segment', () => {
	assert.deepEqual(match('GET', '/api/orders'), ['list'])
	assert.deepEqual(match('POST', '/api/orders'), ['make'])
	assert.deepEqual(match('GET', '/api/orders/{…}'), ['one'])
	assert.deepEqual(match('POST', '/api/orders/{…}/refund'), ['refund'])
	assert.deepEqual(match('DELETE', '/api/orders'), [])
	assert.deepEqual(match('GET', '/api/orders/1/2'), [])
})

test('match: an unknown verb keeps every verb of the route; an endpoint for all verbs answers any', () => {
	assert.deepEqual(match(null, '/api/orders').sort(), ['list', 'make'])
	assert.deepEqual(match('PUT', '/api/health'), ['any'])
})

test('match: a base URL that is not written matches the route tail', () => {
	assert.deepEqual(match('POST', '{…}/orders/{…}/refund'), ['refund'])
	assert.deepEqual(match('GET', ' /orders'), ['list'])
})

test('match: more written segments win over parameters', () => {
	const entries = [{ id: 'param', http: 'GET /users/:id' }, { id: 'me', http: 'GET /users/me' }]
	const { segments, openStart } = l.pathSegments('/users/me')
	assert.deepEqual(l.matchEndpoints({ verb: 'GET', segments, openStart, url: '/users/me' }, entries).map(e => e.id), ['me'])
})

test('routeOf reads the index http text', () => {
	assert.deepEqual(l.routeOf('GET /a/{id}'), { verb: 'GET', segments: ['a', '*'] })
	assert.equal(l.routeOf('not a route'), undefined)
})

// End to end on a real index: a frontend call and a Python client reach their backends' handlers.
let index
let dir
const FRONT = `export async function refund(id) {
  return fetch(\`\${API}/orders/\${id}/refund\`, { method: 'POST' });
}
export async function list() {
  return axios.get('/api/orders');
}
export async function create(body) {
  return axios.post('/api/orders', body);
}
`
const BACK = `const express = require('express');
const app = express();
function listOrders(req, res) { res.json([]); }
function refundOrder(req, res) { res.json({ ok: true }); }
function createOrder(req, res) { res.json({}); }
app.get('/api/orders', listOrders);
app.post('/api/orders', createOrder);
app.post('/api/orders/:id/refund', refundOrder);
`
// The only function named post in the workspace: a name guess for axios.post would land here.
const VIEWS = `class OrderView:
    def post(self, request):
        return None
`
const BILLING = `from fastapi import FastAPI
import requests
app = FastAPI()

@app.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: int):
    return {}

def remind(invoice_id):
    return requests.get(f"{BILLING}/invoices/{invoice_id}")
`

test('the flow goes on through HTTP into the handler, marked as a guess', async t => {
	dir = mkdtempSync(join(tmpdir(), 'flow-links-e2e-'))
	for (const [f, text] of [['web/api.js', FRONT], ['server/app.js', BACK], ['billing/main.py', BILLING], ['legacy/views.py', VIEWS]]) {
		mkdirSync(join(dir, f, '..'), { recursive: true })
		writeFileSync(join(dir, f), text)
	}
	index = new Index(dir)
	t.after(async () => { await index.close(); rmSync(dir, { recursive: true, force: true }) })
	await index.ready
	const fns = async file => index.request('methods', join(dir, file))
	const flowOf = async (file, name) => index.request('graph', (await fns(file)).find(m => m.name.endsWith(name)).id)
	const http = n => n.children.filter(c => c.edgeKind === 'http')

	const refund = http(await flowOf('web/api.js', 'refund'))
	assert.equal(refund.length, 1, 'fetch with a template URL reaches one handler')
	assert.equal(refund[0].guess, true)
	assert.match(refund[0].node.label, /refundOrder/)

	const list = http(await flowOf('web/api.js', 'list'))
	assert.match(list[0]?.node.label ?? '', /listOrders/)

	const remind = http(await flowOf('billing/main.py', 'remind'))
	assert.match(remind[0]?.node.label ?? '', /get_invoice/)

	// A client request is not a route: axios.post('/api/orders', body) adds no endpoint in the frontend.
	const entries = await index.request('entries')
	assert.deepEqual(entries.filter(e => e.file === join(dir, 'web', 'api.js')), [])

	// An HTTP match wins over a guess by name (`post` → OrderView.post).
	const create = await flowOf('web/api.js', 'create')
	assert.deepEqual(create.children.map(c => [c.edgeKind, c.node.label.replace(/^.*\./, '')]), [['http', 'createOrder']])

	// And back: the handler's callers include the client function in the other folder, as an HTTP guess.
	const back = await index.request('callers', (await fns('server/app.js')).find(m => m.name.endsWith('refundOrder')).id)
	assert.deepEqual(back.children.map(c => [c.node.file, c.edgeKind, c.guess]), [[join(dir, 'web', 'api.js'), 'http', true]])
})

test('java: a RestTemplate is found by its declared type or a method only it has, whatever the field is called', () => {
	assert.equal(l.httpCallOf('java', call('postForObject', 'rest', ['/invoices'])).verb, 'POST', 'postForObject is RestTemplate-only')
	assert.equal(l.httpCallOf('java', call('put', 'rest', ['/invoices/{id}'])), undefined, 'put alone is too common a name')
	assert.equal(l.httpCallOf('java', call('put', 'rest', ['/invoices/{id}']), 'RestTemplate').verb, 'PUT', 'but the type says so')
	assert.equal(l.httpCallOf('java', call('exchange', 'ops', ['/x']), 'RestOperations').verb, null)
	assert.equal(l.httpCallOf('java', call('get', 'billing', ['/invoices'], ['uri', 'retrieve'])).verb, 'GET', 'a request chain ends in retrieve')
	assert.equal(l.httpCallOf('java', call('get', 'billing', ['/invoices'], ['uri']), 'WebClient').verb, 'GET')
	assert.equal(l.httpCallOf('java', call('get', 'map', ['/invoices'])), undefined, 'map.get("/x") is not a request')
	assert.equal(l.httpCallOf('java', call('toString', 'restTemplate', ['/x'])), undefined, 'inherited names are not client methods')
})

test('java end to end: rest.postForObject(base + "/invoices") reaches the FastAPI handler', async t => {
	const root = mkdtempSync(join(tmpdir(), 'flow-links-java-'))
	const files = {
		'orders/src/main/java/com/acme/orders/BillingClient.java': `package com.acme.orders;
import org.springframework.web.client.RestTemplate;
public class BillingClient {
    private final RestTemplate rest = new RestTemplate();
    private final String billingBaseUrl = System.getenv("BILLING_URL");
    public void charge(String orderId) {
        rest.postForObject(billingBaseUrl + "/invoices", orderId, String.class);
    }
}
`,
		'billing/main.py': `from fastapi import FastAPI
app = FastAPI()

@app.post("/invoices")
def create_invoice():
    return {}
`,
	}
	for (const [f, text] of Object.entries(files)) {
		mkdirSync(join(root, f, '..'), { recursive: true })
		writeFileSync(join(root, f), text)
	}
	const idx = new Index(root)
	t.after(async () => { await idx.close(); rmSync(root, { recursive: true, force: true }) })
	await idx.ready
	const methods = await idx.request('methods', join(root, 'orders', 'src', 'main', 'java', 'com', 'acme', 'orders', 'BillingClient.java'))
	const flow = await idx.request('graph', methods.find(m => m.name.endsWith('charge')).id)
	const http = flow.children.filter(c => c.edgeKind === 'http')
	assert.equal(http.length, 1, JSON.stringify(flow.children.map(c => [c.edgeKind, c.node.label])))
	assert.match(http[0].node.label, /create_invoice/)
})
