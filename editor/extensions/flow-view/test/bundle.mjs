// Bundles one TypeScript module of the extension into a temp folder and imports it, so tests can run the real code.
// `vscode` is replaced by an empty stub: only modules that do not call it at import time are testable this way.
import { build } from 'esbuild'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT } from './helpers.mjs'

const dirs = []

export async function load(entry) {
	const tmp = mkdtempSync(join(tmpdir(), 'flow-test-bundle-'))
	dirs.push(tmp)
	const stub = join(tmp, 'vscode-stub.cjs')
	writeFileSync(stub, 'module.exports = {}')
	const outfile = join(tmp, 'mod.mjs')
	await build({ entryPoints: [join(ROOT, entry)], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent', alias: { vscode: stub }, external: ['bufferutil', 'utf-8-validate'] })
	return import(pathToFileURL(outfile).href)
}

export function cleanup() {
	for (const d of dirs.splice(0)) {
		rmSync(d, { recursive: true, force: true })
	}
}

export const temp = prefix => {
	const d = mkdtempSync(join(tmpdir(), prefix))
	dirs.push(d)
	return d
}
