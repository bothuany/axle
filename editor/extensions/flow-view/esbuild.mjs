// Bundles the extension, the polyglot index worker and the `insilode` MCP server (a plain Node script, no `vscode`). The tree-sitter runtime and grammars are
// copied next to them (never fetched at runtime): Java, Python, JavaScript, TypeScript, TSX, Go, PHP, Ruby, Rust.
import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, statSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode', 'bufferutil', 'utf-8-validate'], sourcemap: true, logLevel: 'info' }
await build({ ...common, entryPoints: ['src/extension.ts'], outfile: 'out/extension.js' })
await build({ ...common, entryPoints: ['src/poly/worker.ts'], outfile: 'out/polyWorker.js' })
await build({ ...common, entryPoints: ['mcp/insilode-mcp.ts'], outfile: 'out/insilode-mcp.js' })

const wasm = join(dirname(createRequire(import.meta.url).resolve('@vscode/tree-sitter-wasm/package.json')), 'wasm')
mkdirSync('out/wasm', { recursive: true })
// A build that changed no grammar copies nothing: the wasm files are several MB each.
const unchanged = (from, to) => existsSync(to) && statSync(to).size === statSync(from).size && statSync(to).mtimeMs >= statSync(from).mtimeMs
for (const f of ['tree-sitter.js', 'tree-sitter.wasm', 'tree-sitter-java.wasm', 'tree-sitter-python.wasm', 'tree-sitter-javascript.wasm', 'tree-sitter-typescript.wasm', 'tree-sitter-tsx.wasm', 'tree-sitter-go.wasm', 'tree-sitter-php.wasm', 'tree-sitter-ruby.wasm', 'tree-sitter-rust.wasm']) {
	if (!unchanged(join(wasm, f), join('out/wasm', f))) {
		cpSync(join(wasm, f), join('out/wasm', f))
	}
}
