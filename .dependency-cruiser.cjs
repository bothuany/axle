// Architecture rules for the TypeScript side (the three extensions and the canvas), checked by `npm run arch`.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		{
			name: 'no-circular',
			severity: 'error',
			comment: 'A module cycle makes load order matter and the pieces impossible to test alone.',
			from: { pathNot: 'node_modules' },
			to: { circular: true },
		},
		{
			name: 'no-cross-extension-imports',
			severity: 'error',
			comment: 'Each extension is bundled and activated on its own. They talk through registered commands, never through each other\'s source.',
			from: { path: '^editor/extensions/([^/]+)/' },
			to: { path: '^editor/extensions/([^/]+)/', pathNot: '^editor/extensions/$1/' },
		},
		{
			name: 'no-canvas-to-extension',
			severity: 'error',
			comment: 'The canvas runs in a webview: it cannot load extension-host code (Node, vscode).',
			from: { path: '^ui/' },
			to: { path: '^editor/' },
		},
		{
			name: 'no-extension-to-canvas',
			severity: 'error',
			comment: 'The extension inlines the built canvas bundle; it never imports the canvas source.',
			from: { path: '^editor/' },
			to: { path: '^ui/' },
		},
		{
			name: 'canvas-no-node-builtins',
			severity: 'error',
			comment: 'The canvas runs in a browser sandbox.',
			from: { path: '^ui/src/' },
			to: { dependencyTypes: ['core'] },
		},
		{
			name: 'headless-entries-stay-off-vscode',
			severity: 'error',
			comment: 'The polyglot worker (a worker thread) and the axle MCP server (a plain Node process) have no `vscode` module: importing it, even transitively, crashes them at load.',
			from: { path: '^editor/extensions/flow-view/(src/poly/worker\\.ts|mcp/axle-mcp\\.ts)$' },
			to: { reachable: true, path: '^vscode$' },
		},
		{
			name: 'pure-layers-stay-off-vscode',
			severity: 'error',
			comment: 'The parsing and graph modules are tested under plain Node (test/*.test.mjs). Only the host-facing files may import `vscode`.',
			from: {
				path: '^editor/extensions/flow-view/src/(poly|board|types|mcp)/',
				pathNot: [
					'/poly/(client|lspHost)\\.ts$',
					'/board/viewer\\.ts$',
					'/types/typeService\\.ts$',
					'/mcp/(bridge|handlers|planHost|register)\\.ts$',
				],
			},
			to: { path: '^vscode$' },
		},
		{
			name: 'no-orphans',
			severity: 'warn',
			comment: 'A module nothing imports is dead code or a missing entry point.',
			from: {
				orphan: true,
				pathNot: ['\\.d\\.ts$', '(^|/)(esbuild|vite\\.[^/]+\\.config)\\.(mjs|ts)$', '/src/extension\\.ts$', '/poly/worker\\.ts$', '/mcp/axle-mcp\\.ts$', '^ui/src/(webview|board/board)\\.tsx$'],
			},
			to: {},
		},
		{
			name: 'not-to-dev-dep',
			severity: 'error',
			comment: 'Bundled code must not import a package that is only a devDependency.',
			from: { path: '^(editor/extensions/[^/]+|ui)/src/' },
			to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'], pathNot: ['node_modules/@types/'] },
		},
	],
	options: {
		doNotFollow: { path: 'node_modules' },
		exclude: { path: ['node_modules', '/out/', '/dist', '/test/', '^editor/vscode/', '^\\.claude/', '^brag-output'] },
		// `vscode` is provided by the host at runtime; keep it as a named, unresolved module so the rules above can see it.
		tsPreCompilationDeps: true,
		combinedDependencies: false,
		enhancedResolveOptions: {
			exportsFields: ['exports'],
			conditionNames: ['import', 'require', 'node', 'default', 'types'],
			extensions: ['.ts', '.tsx', '.mjs', '.js', '.cjs', '.d.ts'],
		},
		reporterOptions: {
			dot: { collapsePattern: 'node_modules/(@[^/]+/[^/]+|[^/]+)' },
		},
	},
};
