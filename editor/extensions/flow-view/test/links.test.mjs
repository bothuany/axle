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
})

test('go: net/http, NewRequest with the method as a string or a constant, resty', () => {
	assert.equal(l.httpCallOf('go', call('Get', 'http', [' /api/orders/ '])).verb, 'GET')
	assert.equal(l.httpCallOf('go', call('Post', 'self.client', ['/api/orders', 'application/json'])).verb, 'POST')
	assert.equal(l.httpCallOf('go', call('NewRequestWithContext', 'http', ['POST', '{…}/api/orders'])).verb, 'POST')
	assert.equal(l.httpCallOf('go', call('NewRequest', 'http', ['/api/orders'])).verb, null, 'the method is not written')
	assert.equal(l.httpCallOf('go', call('R', 'client', ['id', '/api/orders/{id}'], ['SetPathParam', 'Get'])).verb, 'GET')
	assert.equal(l.httpCallOf('go', call('New', 'resty', ['/api/orders'], ['R', 'Post'])).verb, 'POST')
	assert.equal(l.httpCallOf('go', call('Get', 'cache', ['/x'])), undefined, 'not a client')
	assert.equal(l.httpCallOf('go', call('Get', 'client', ['user:1'])), undefined, 'a key is not a URL')
})

test('php: the Laravel Http facade, also chained and fully qualified; Guzzle', () => {
	assert.equal(l.httpCallOf('php', call('get', 'Http', ['/api/orders/{…}'])).verb, 'GET')
	assert.equal(l.httpCallOf('php', call('withToken', 'Http', [' /api/orders'], ['post'])).verb, 'POST')
	assert.equal(l.httpCallOf('php', call('get', String.raw`\Illuminate\Support\Facades\Http`, ['/b'])).verb, 'GET')
	assert.equal(l.httpCallOf('php', call('request', 'this.client', ['POST', '/x/{…}/y'])).verb, 'POST')
	assert.equal(l.httpCallOf('php', call('getAsync', 'client', ['/api/a'])).verb, 'GET')
	assert.equal(l.httpCallOf('php', call('fake', 'Http', ['/api/a'])), undefined)
	assert.equal(l.httpCallOf('php', call('get', 'Route', ['/users'])), undefined, 'a route is not a request')
})

test('ruby: HTTParty, RestClient, Faraday, Net::HTTP', () => {
	assert.equal(l.httpCallOf('ruby', call('get', 'HTTParty', ['{…}/api/orders/{…}'])).verb, 'GET')
	assert.equal(l.httpCallOf('ruby', call('post', 'RestClient', [' /api/orders'])).verb, 'POST')
	assert.equal(l.httpCallOf('ruby', call('put', '@conn', ['/api/orders/{…}'])).verb, 'PUT')
	assert.equal(l.httpCallOf('ruby', call('new', 'Faraday', ['/z'], ['get'])).verb, 'GET')
	assert.equal(l.httpCallOf('ruby', call('get', 'Net.HTTP', ['http://h/api/x'])).verb, 'GET')
	assert.equal(l.httpCallOf('ruby', call('post_form', 'Net.HTTP', ['http://h/api/x'])).verb, 'POST')
	assert.equal(l.httpCallOf('ruby', call('new', 'Net.HTTP.Delete', ['http://h/api/x/{…}'])).verb, 'DELETE')
	assert.equal(l.httpCallOf('ruby', call('get', undefined, ['/hello'])), undefined, 'a Sinatra route is not a request')
})

test('rust: reqwest::get, a client and its request(Method::X)', () => {
	assert.equal(l.httpCallOf('rust', call('get', 'reqwest', ['{…}/api/orders/{…}'])).verb, 'GET')
	assert.equal(l.httpCallOf('rust', call('post', 'self.client', ['http://x/api/orders'], ['json', 'send'])).verb, 'POST')
	assert.equal(l.httpCallOf('rust', call('request', 'client', ['PATCH', '/api/orders'])).verb, 'PATCH')
	assert.equal(l.httpCallOf('rust', call('get', 'map', ['/x'])), undefined)
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

// End to end for Go, PHP, Ruby and Rust: each workspace has a server with routes and a client that calls them.
async function workspace(t, files) {
	const root = mkdtempSync(join(tmpdir(), 'flow-links-lang-'))
	for (const [f, text] of Object.entries(files)) {
		mkdirSync(join(root, f, '..'), { recursive: true })
		writeFileSync(join(root, f), text)
	}
	const ix = new Index(root)
	t.after(async () => { await ix.close(); rmSync(root, { recursive: true, force: true }) })
	await ix.ready
	const fns = async file => ix.request('methods', join(root, file))
	return {
		root, ix,
		/** The handlers an HTTP edge of `name` in `file` reaches, by label, as [label, guess]. */
		reach: async (file, name) => {
			const fn = (await fns(file)).find(m => m.name === name || m.name.endsWith('.' + name))
			assert.ok(fn, `${name} in ${file}`)
			const g = await ix.request('graph', fn.id)
			return g.children.filter(c => c.edgeKind === 'http').map(c => [c.node.label.replace(/^.*\./, ''), c.guess])
		},
	}
}

test('go: net/http, NewRequest and resty reach Gin handlers; http.Post is not a route', async t => {
	const w = await workspace(t, {
		'server/main.go': `package main

import "github.com/gin-gonic/gin"

func getOrder(c *gin.Context)    { c.JSON(200, nil) }
func createOrder(c *gin.Context) { c.JSON(201, nil) }

func main() {
	r := gin.Default()
	api := r.Group("/api")
	api.GET("/orders/:id", getOrder)
	api.POST("/orders", createOrder)
}
`,
		'client/client.go': `package client

import (
	"context"
	"fmt"
	"io"
	"net/http"

	"github.com/go-resty/resty/v2"
)

var baseURL = "http://orders"

func FetchOrder(id string) { http.Get(baseURL + "/api/orders/" + id) }

func PlaceOrder() { http.Post("/api/orders", "application/json", nil) }

func PlaceWithClient(body io.Reader) { http.DefaultClient.Post("/api/orders", "application/json", body) }

func PlaceWithContext(ctx context.Context) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("%s/api/orders", baseURL), nil)
	http.DefaultClient.Do(req)
}

func FetchWithResty(client *resty.Client, id string) {
	client.R().SetPathParam("id", id).Get("/api/orders/{id}")
}
`,
	})
	assert.deepEqual(await w.reach('client/client.go', 'FetchOrder'), [['getOrder', true]])
	assert.deepEqual(await w.reach('client/client.go', 'PlaceOrder'), [['createOrder', true]])
	assert.deepEqual(await w.reach('client/client.go', 'PlaceWithContext'), [['createOrder', true]])
	assert.deepEqual(await w.reach('client/client.go', 'PlaceWithClient'), [['createOrder', true]])
	assert.deepEqual(await w.reach('client/client.go', 'FetchWithResty'), [['getOrder', true]])
	const entries = await w.ix.request('entries')
	assert.deepEqual(entries.filter(e => e.file === join(w.root, 'client', 'client.go')), [], 'a request registers no route')
})

test('php: the Http facade and Guzzle reach Laravel controller actions', async t => {
	const w = await workspace(t, {
		'routes/web.php': String.raw`<?php
use App\Http\Controllers\OrderController;
Route::get('/api/orders/{id}', [OrderController::class, 'show']);
Route::post('/api/orders', [OrderController::class, 'store']);
`,
		'app/OrderController.php': `<?php
class OrderController {
    public function show($id) { return $id; }
    public function store() { return 1; }
}
`,
		'app/OrdersClient.php': String.raw`<?php
use Illuminate\Support\Facades\Http;
class OrdersClient {
    public function __construct(private \GuzzleHttp\Client $client) {}
    public function find($id) { return Http::get("/api/orders/{$id}"); }
    public function create($body) { return Http::withToken($this->token)->post(config('svc.orders') . '/api/orders', $body); }
    public function viaGuzzle($id) { return $this->client->request('GET', "/api/orders/$id"); }
    public function qualified() { return \Illuminate\Support\Facades\Http::post('/api/orders'); }
}
`,
	})
	assert.deepEqual(await w.reach('app/OrdersClient.php', 'find'), [['show', true]])
	assert.deepEqual(await w.reach('app/OrdersClient.php', 'create'), [['store', true]])
	assert.deepEqual(await w.reach('app/OrdersClient.php', 'viaGuzzle'), [['show', true]])
	assert.deepEqual(await w.reach('app/OrdersClient.php', 'qualified'), [['store', true]])
})

test('ruby: HTTParty, RestClient, Faraday and Net::HTTP reach Sinatra routes', async t => {
	const w = await workspace(t, {
		'server/app.rb': `get '/api/orders/:id' do
  load_order
end

post '/api/orders' do
  save_order
end
`,
		'client/orders_client.rb': `class OrdersClient
  def find(id)
    HTTParty.get("#{BASE}/api/orders/#{id}")
  end

  def create(body)
    RestClient.post(BASE + "/api/orders", body)
  end

  def via_faraday(id)
    @conn.get("/api/orders/#{id}")
  end

  def via_net_http(id)
    Net::HTTP.get(URI("http://orders/api/orders/#{id}"))
  end
end
`,
	})
	assert.deepEqual(await w.reach('client/orders_client.rb', 'find'), [['GET /api/orders/:id', true]])
	assert.deepEqual(await w.reach('client/orders_client.rb', 'create'), [['POST /api/orders', true]])
	assert.deepEqual(await w.reach('client/orders_client.rb', 'via_faraday'), [['GET /api/orders/:id', true]])
	assert.deepEqual(await w.reach('client/orders_client.rb', 'via_net_http'), [['GET /api/orders/:id', true]])
})

test('rust: reqwest reaches axum handlers', async t => {
	const w = await workspace(t, {
		'server/main.rs': `use axum::{routing::{get, post}, Router};
async fn get_order() -> String { String::new() }
async fn create_order() -> String { String::new() }
fn app() -> Router {
    Router::new().route("/api/orders/:id", get(get_order)).route("/api/orders", post(create_order))
}
`,
		'client/lib.rs': `pub async fn fetch_order(base: &str, id: u64) {
    let _ = reqwest::get(format!("{}/api/orders/{}", base, id)).await;
}
pub async fn place_order(client: &reqwest::Client, base: &str) {
    let _ = client.post(format!("{base}/api/orders")).json(&1).send().await;
}
pub async fn fetch_raw(client: &Client) {
    let _ = client.get(r#"http://orders/api/orders/7"#).send().await?;
}
`,
	})
	assert.deepEqual(await w.reach('client/lib.rs', 'fetch_order'), [['get_order', true]])
	assert.deepEqual(await w.reach('client/lib.rs', 'place_order'), [['create_order', true]])
	assert.deepEqual(await w.reach('client/lib.rs', 'fetch_raw'), [['get_order', true]])
})
