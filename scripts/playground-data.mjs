// Builds the playground's demo data from the real index: runs the polyglot worker (the built flow-view out/polyWorker.js, no
// `vscode`) headlessly on the fictional demo project in playground/demo and writes what the canvas would have asked the editor
// for: the endpoints, each one's flow, callers and impact, and one "an agent changed this" change set.
//   node scripts/playground-data.mjs      writes playground/public/data/demo.json
// Needs `npm run build` in editor/extensions/flow-view first (the worker and the tree-sitter grammars live in its out/).
import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EXTENSIONS, ROOT, launchSync } from './lib.mjs'

const FLOW_VIEW = join(EXTENSIONS, 'flow-view')
const DEMO = join(ROOT, 'playground', 'demo')
const OUT = join(ROOT, 'playground', 'public', 'data', 'demo.json')
/** The same data as a TypeScript literal that must satisfy the playground's types: `npm run typecheck` in playground/ then fails when the data and protocol/flow.ts disagree. */
const CHECK = join(ROOT, 'playground', 'src', 'generated', 'demo-check.ts')
const flowViewDeps = createRequire(join(FLOW_VIEW, 'package.json'))

if (!existsSync(join(FLOW_VIEW, 'out', 'polyWorker.js'))) {
	console.error('The index worker is not built. Run `npm ci && npm run build` in editor/extensions/flow-view first.')
	process.exit(1)
}

/** git with fixed identity and dates, so two runs write the same commits. */
const git = (cwd, ...args) => {
	const env = { ...process.env, GIT_AUTHOR_NAME: 'Claude Code', GIT_AUTHOR_EMAIL: 'agent@example.invalid', GIT_COMMITTER_NAME: 'Claude Code', GIT_COMMITTER_EMAIL: 'agent@example.invalid', GIT_AUTHOR_DATE: '2026-01-15T10:00:00Z', GIT_COMMITTER_DATE: '2026-01-15T10:00:00Z' }
	const r = launchSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, env, encoding: 'utf8', windowsHide: true })
	if (r.status !== 0) {
		throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
	}
	return r.stdout
}

/** The demo project as two commits: the services as they are, then what an agent changed (playground/demo/changed over base). */
function assemble() {
	// The real name of the folder: a Windows runner's temp folder has an 8.3 short name the index would not report back.
	const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'axle-playground-')))
	git(dir, 'init', '-q', '-b', 'main')
	cpSync(join(DEMO, 'base'), dir, { recursive: true })
	git(dir, 'add', '-A')
	git(dir, 'commit', '-q', '-m', 'Orders, billing and shipping services')
	cpSync(join(DEMO, 'changed'), dir, { recursive: true })
	git(dir, 'add', '-A')
	git(dir, 'commit', '-q', '-m', 'Add discount codes to orders')
	return dir
}

/** The extension's own modules that need no `vscode`, bundled the way flow-view's tests do, so the change set is built by the real code. */
async function loadHostModules(tmp) {
	const { build } = flowViewDeps('esbuild')
	const stub = join(tmp, 'vscode-stub.cjs')
	writeFileSync(stub, 'module.exports = {}')
	const load = async (entry, name) => {
		const outfile = join(tmp, `${name}.mjs`)
		await build({ entryPoints: [join(FLOW_VIEW, entry)], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent', alias: { vscode: stub }, external: ['bufferutil', 'utf-8-validate'] })
		return import(pathToFileURL(outfile).href)
	}
	return { changeSet: await load('src/changeSet.ts', 'changeSet'), turnImpact: await load('src/mcp/turnImpact.ts', 'turnImpact'), tableIndex: await load('src/mcp/tableIndex.ts', 'tableIndex'), changed: await load('src/mcp/changedMethods.ts', 'changedMethods') }
}

class Index {
	#worker
	#seq = 0
	ready

	constructor(folder, cacheDir) {
		this.#worker = new Worker(join(FLOW_VIEW, 'out', 'polyWorker.js'), { workerData: { roots: [folder], wasmDir: join(FLOW_VIEW, 'out', 'wasm'), cacheFile: join(cacheDir, 'cache.json') } })
		this.ready = new Promise((ok, fail) => {
			const timer = setTimeout(() => fail(new Error('the index was not ready after 60 s')), 60_000)
			this.#worker.on('message', m => {
				if (m.type === 'ready') {
					clearTimeout(timer)
					ok()
				} else if (m.type === 'log' && /^index failed/.test(m.message)) {
					fail(new Error(m.message))
				}
			})
			this.#worker.on('error', fail)
		})
	}

	request(op, ...args) {
		const id = ++this.#seq
		return new Promise((ok, fail) => {
			const onMessage = m => {
				if (m.id === id) {
					this.#worker.off('message', onMessage)
					m.error ? fail(new Error(m.error)) : ok(m.result)
				}
			}
			this.#worker.on('message', onMessage)
			this.#worker.postMessage({ id, op, args })
		})
	}

	close() {
		return this.#worker.terminate()
	}
}

const norm = s => s.replace(/\r\n/g, '\n')
const hunksOf = (before, after) => flowViewDeps('diff').structuredPatch('a', 'b', norm(before), norm(after), '', '', { context: 0 }).hunks

/** The diff of one card, in the lines of the file as it is now (the same reading as AgentChanges.cardDiff in flow-view's agentDiff.ts). */
function cardDiff(hunks, start, end) {
	const d = { added: [], removed: [], plus: 0, minus: 0 }
	for (const h of hunks) {
		const from = h.newLines ? h.newStart : h.newStart + 1
		const to = h.newLines ? h.newStart + h.newLines - 1 : h.newStart
		if (to < start || from > end) {
			continue
		}
		let line = from
		let pending = []
		for (const l of h.lines) {
			if (l.startsWith('-')) {
				pending.push(l.slice(1))
				d.minus++
			} else if (l.startsWith('+')) {
				if (pending.length) {
					d.removed.push({ after: line - 1, lines: pending })
					pending = []
				}
				if (line >= start && line <= end) {
					d.added.push(line)
				}
				d.plus++
				line++
			}
		}
		if (pending.length) {
			d.removed.push({ after: line - 1, lines: pending })
		}
	}
	return d.plus || d.minus ? d : undefined
}

/** Every string in `value` with the temp folder replaced by `/demo`, so the data names no machine and a card has the same path everywhere (ids and keys hold paths too). */
function relocate(value, dir) {
	const fix = str => {
		const moved = str.split(dir).join('/demo')
		return moved === str ? str : moved.split('\\').join('/')
	}
	const walk = v => {
		if (typeof v === 'string') {
			return fix(v)
		}
		if (Array.isArray(v)) {
			return v.map(walk)
		}
		if (v && typeof v === 'object') {
			return Object.fromEntries(Object.entries(v).map(([k, x]) => [fix(k), walk(x)]))
		}
		return v
	}
	return walk(value)
}

const dir = assemble()
const scratch = mkdtempSync(join(tmpdir(), 'axle-playground-work-'))
const index = new Index(dir, scratch)
try {
	const { changeSet, turnImpact, tableIndex, changed } = await loadHostModules(scratch)
	await index.ready
	const entries = (await index.request('entries')).map(e => ({ ...e, source: 'poly' }))
	const key = e => `${e.http} ${e.file}`
	entries.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))

	const flows = {}
	for (const e of entries) {
		flows[e.id] = { graph: await index.request('graph', e.id, 5), callers: await index.request('callers', e.id), impact: await index.request('impact', e.id) }
	}

	// The change set: what the second commit changed, drawn by the same code the editor uses for "show the changes in flow".
	const files = git(dir, 'diff', '--name-only', 'HEAD~1', 'HEAD').split('\n').filter(Boolean).map(f => join(dir, f))
	const before = new Map(files.map(f => [f, git(dir, 'show', `HEAD~1:${f.slice(dir.length + 1).split(sep).join('/')}`)]))
	const hunks = new Map(files.map(f => [f, hunksOf(before.get(f), readFileSync(f, 'utf8'))]))
	const sameFile = (a, b) => a.split(sep).join('/') === b.split(sep).join('/')
	const annotate = async root => {
		const visit = n => {
			const f = n.file && files.find(x => sameFile(x, n.file))
			const d = f && cardDiff(hunks.get(f), n.startLine, n.endLine)
			if (d) {
				n.diff = d
			}
			n.children.forEach(c => visit(c.node))
		}
		visit(root)
	}
	const tables = new tableIndex.TableIndex({
		entries: () => entries,
		poly: { isReady: true, entities: () => index.request('entities'), tables: ms => index.request('tables', ms) },
		analyzer: { isReady: false, entities: async () => undefined, tables: async () => undefined },
	})
	const providerFor = () => ({ graph: t => index.request('graph', t.id, 5), callers: async () => null, impact: async () => ({ label: 'endpoint', items: [] }) })
	const provider = new changeSet.ChangeSetProvider({
		impactOf: (fs, limits) => turnImpact.turnImpact(fs, {
			analyzer: { isReady: false },
			poly: { isReady: true, refresh: async () => undefined, methods: f => index.request('methods', f) },
			endpoints: { cached: () => entries },
			providerFor,
			rangesOf: async f => (hunks.has(f) ? changed.rangesFromHunks(hunks.get(f)) : undefined),
			tables,
		}, limits),
		providerFor,
		annotate,
	})
	// Each endpoint again with the agent's change on its cards: what the canvas draws once a prompt is picked in the timeline.
	for (const flow of Object.values(flows)) {
		const marked = structuredClone(flow.graph)
		await annotate(marked)
		if (JSON.stringify(marked) !== JSON.stringify(flow.graph)) {
			flow.changed = marked
		}
	}
	provider.use({ label: 'Claude Code: discount codes on orders', files })
	const root = await provider.graph()
	const impact = await provider.impact()
	const plus = f => hunks.get(f).reduce((n, h) => n + h.lines.filter(l => l.startsWith('+')).length, 0)
	const minus = f => hunks.get(f).reduce((n, h) => n + h.lines.filter(l => l.startsWith('-')).length, 0)
	const timeline = [{ id: 1, prompt: 'Add discount codes to orders: a code on the order cuts its total before it is saved and invoiced.', agent: 'Claude Code', at: Date.parse('2026-01-15T10:00:00Z'), files: files.map(file => ({ file, plus: plus(file), minus: minus(file) })) }]

	const data = relocate({ entries, flows, changes: { label: 'Claude Code: discount codes on orders', root, impact, timeline } }, dir)
	mkdirSync(join(OUT, '..'), { recursive: true })
	writeFileSync(OUT, `${JSON.stringify(data)}\n`)
	mkdirSync(join(CHECK, '..'), { recursive: true })
	writeFileSync(CHECK, `// Generated by scripts/playground-data.mjs; checked by tsc, never imported. A field the data lacks or has the wrong type for fails here; an extra one (the index also reports the ORM name) does not.
import type { DemoData } from '../demo'

const checked = <T extends DemoData>(data: T) => data

export const demo = checked(${JSON.stringify(data)})
`)
	console.log(`playground data: ${entries.length} endpoints, change set with ${files.length} files → ${OUT}`)
} finally {
	await index.close()
	rmSync(dir, { recursive: true, force: true })
	rmSync(scratch, { recursive: true, force: true })
}
