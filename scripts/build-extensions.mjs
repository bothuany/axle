#!/usr/bin/env node
// Rebuilds the Flow extensions after a change (the editor picks them up on window reload).
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const name of ['flow-view', 'flow-agent', 'flow-harness']) {
	const r = spawnSync('node', ['esbuild.mjs'], { cwd: join(ROOT, 'editor', 'extensions', name), stdio: 'inherit' })
	if (r.status !== 0) {
		process.exit(r.status ?? 1)
	}
}
