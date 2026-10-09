// Bundles the extension and the polyglot index worker. The tree-sitter runtime and grammars are
// copied next to them (never fetched at runtime): Java, Python, JavaScript, TypeScript, TSX.
import { build } from 'esbuild'
import { cpSync, mkdirSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode', 'bufferutil', 'utf-8-validate'], sourcemap: true, logLevel: 'info' }
await build({ ...common, entryPoints: ['src/extension.ts'], outfile: 'out/extension.js' })
await build({ ...common, entryPoints: ['src/poly/worker.ts'], outfile: 'out/polyWorker.js' })

const wasm = join(dirname(createRequire(import.meta.url).resolve('@vscode/tree-sitter-wasm/package.json')), 'wasm')
mkdirSync('out/wasm', { recursive: true })
for (const f of ['tree-sitter.js', 'tree-sitter.wasm', 'tree-sitter-java.wasm', 'tree-sitter-python.wasm', 'tree-sitter-javascript.wasm', 'tree-sitter-typescript.wasm', 'tree-sitter-tsx.wasm']) {
	cpSync(join(wasm, f), join('out/wasm', f))
}
