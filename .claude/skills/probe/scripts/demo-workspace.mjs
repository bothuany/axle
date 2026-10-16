// Writes a small multi-service project to probe Axle against: an Express backend, a frontend that
// calls it with axios and fetch, and a FastAPI service that calls it with requests. Each client call
// is a different URL shape (plain, template, concatenation, f-string with a host), so one flow and one
// callers view show whether cross-service links, routes and the index work end to end.
//
//   node .claude/skills/probe/scripts/demo-workspace.mjs <dir>
//
// The folder is created (or emptied) and committed to a fresh git repo, so "Show Git Changes in Flow"
// and agent turns have a HEAD to compare with.

import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const dir = process.argv[2] && resolve(process.argv[2])
if (!dir) {
	console.error('usage: demo-workspace.mjs <dir>')
	process.exit(2)
}
// Only replace a folder this script made: anything else might be someone's work.
if (existsSync(dir) && readdirSync(dir).length && !existsSync(join(dir, '.axle-probe'))) {
	console.error(`${dir} is not empty and was not made by this script; pick another folder`)
	process.exit(1)
}
rmSync(dir, { recursive: true, force: true })

const files = {
	'.axle-probe': 'Made by .claude/skills/probe/scripts/demo-workspace.mjs; safe to delete.\n',
	'package.json': '{ "name": "demo-shop", "private": true, "dependencies": { "express": "^4.19.0", "axios": "^1.7.0" } }\n',
	'server/app.js': `const express = require('express');
const orders = require('./orders');
const app = express();
app.use(express.json());

app.get('/api/orders', orders.listOrders);
app.get('/api/orders/:id', orders.getOrder);
app.post('/api/orders', orders.createOrder);
app.post('/api/orders/:id/refund', orders.refundOrder);

module.exports = app;
`,
	'server/orders.js': `const repo = require('./repo');

function listOrders(req, res) {
  res.json(repo.all());
}

function getOrder(req, res) {
  res.json(repo.find(req.params.id));
}

function createOrder(req, res) {
  const order = repo.insert(req.body);
  res.status(201).json(order);
}

function refundOrder(req, res) {
  const order = repo.find(req.params.id);
  order.status = 'refunded';
  res.json(repo.save(order));
}

module.exports = { listOrders, getOrder, createOrder, refundOrder };
`,
	'server/repo.js': `const rows = new Map();
function all() { return [...rows.values()]; }
function find(id) { return rows.get(id); }
function insert(o) { const id = String(rows.size + 1); rows.set(id, { id, ...o }); return rows.get(id); }
function save(o) { rows.set(o.id, o); return o; }
module.exports = { all, find, insert, save };
`,
	'web/src/api.js': `import axios from 'axios';
const API = import.meta.env.VITE_API;

export async function loadOrders() {
  return axios.get('/api/orders');
}

export async function placeOrder(cart) {
  return axios.post('/api/orders', cart);
}

export async function refund(id) {
  return fetch(\`\${API}/orders/\${id}/refund\`, { method: 'POST' });
}

export async function orderDetails(id) {
  return axios.get('/api/orders/' + id);
}
`,
	'billing/main.py': `from fastapi import FastAPI
import requests

app = FastAPI()
ORDERS = "http://orders.internal"


@app.post("/invoices/{order_id}")
def create_invoice(order_id: str):
    order = requests.get(f"{ORDERS}/api/orders/{order_id}")
    return {"order": order.json()}
`,
}
for (const [rel, text] of Object.entries(files)) {
	const file = join(dir, rel)
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, text)
}

const git = (...args) => spawnSync('git', args, { cwd: dir, stdio: 'ignore' }).status === 0
const committed = git('init', '-q') && git('add', '-A') && git('-c', 'user.email=probe@local', '-c', 'user.name=probe', 'commit', '-qm', 'demo')
console.log(dir)
if (!committed) {
	console.error('git commit failed: the folder works, but Git-change views have no HEAD')
}
