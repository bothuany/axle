// Copies this checkout's built Insilode extensions (npm run build:extensions, npm run build:canvas first) into
// <work>/ext with a high version, so the film's server runs them instead of the built-in copies.
//   node exts.mjs <work dir>
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const R = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'editor', 'extensions')
const X = join(resolve(process.argv[2]), 'ext')
mkdirSync(X, { recursive: true })
for (const d of readdirSync(X)) rmSync(join(X, d), { recursive: true, force: true })
for (const name of ['flow-view', 'flow-agent', 'flow-harness', 'flow-theme']) {
	const to = join(X, `flow.${name}-9.0.0`)
	cpSync(join(R, name), to, { recursive: true, filter: s => !/[\\/](node_modules|test|src)$/.test(s) || /media/.test(s) })
	const pj = JSON.parse(readFileSync(join(to, 'package.json'), 'utf8'))
	pj.version = '9.0.0'
	writeFileSync(join(to, 'package.json'), JSON.stringify(pj, null, 2))
	console.log('copied', name)
}
