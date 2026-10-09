// Bundles the extension (and the ESM-only ACP SDK) into one CommonJS file the extension host can load.
// The agent adapters are NOT bundled: they run as their own node processes from node_modules.
import { build } from 'esbuild'
await build({
	entryPoints: ['src/extension.ts'],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node22',
	outfile: 'out/extension.js',
	external: ['vscode'],
	sourcemap: true,
	logLevel: 'info',
})
