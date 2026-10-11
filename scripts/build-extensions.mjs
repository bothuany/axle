#!/usr/bin/env node
// Rebuilds the Axle extensions after a change (the editor picks them up on window reload).
import { join } from 'node:path'
import { EXTENSIONS, buildableExtensions, launchSync } from './lib.mjs'

for (const name of buildableExtensions()) {
	const r = launchSync('node', ['esbuild.mjs'], { cwd: join(EXTENSIONS, name), stdio: 'inherit' })
	if (r.status !== 0) {
		process.exit(r.status ?? 1)
	}
}
