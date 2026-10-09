// Bundles the extension into one CommonJS file the extension host can load.
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
