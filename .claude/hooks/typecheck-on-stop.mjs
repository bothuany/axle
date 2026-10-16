// Stop: type-check each package whose TypeScript changed (an extension, or the canvas) before Claude finishes.
// It runs at Stop rather than after every edit because a refactor spread over several edits is not expected to
// type-check halfway. Errors are sent back once (exit 2); on the stop right after that they are only shown (no loop).
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { launchSync } from '../../scripts/lib.mjs'

let input = ''
process.stdin.on('data', d => input += d)
process.stdin.on('end', () => {
	const retry = Boolean(JSON.parse(input || '{}').stop_hook_active)
	const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()

	const status = execFileSync('git', ['status', '--porcelain', '-z', '--untracked-files=all', '--', 'editor/extensions', 'ui/src'], { cwd: root, encoding: 'utf8' })
	const packages = new Set()
	for (const entry of status.split('\0')) {
		const path = entry.slice(3)
		if (!/\.tsx?$/.test(path)) {
			continue
		}
		const ext = /^editor\/extensions\/(flow-[^/]+)\//.exec(path)
		if (ext) {
			packages.add(`editor/extensions/${ext[1]}`)
		} else if (path.startsWith('ui/src/')) {
			packages.add('ui')
		}
	}
	if (packages.size === 0) {
		return
	}

	// The extensions compile against the generated VS Code checkout's TypeScript and vscode.d.ts (their own
	// `npm run typecheck`); the canvas has its own TypeScript. A missing install is reported, not treated as an error.
	const extensionTsc = join(root, 'editor', 'vscode', 'node_modules', 'typescript', 'bin', 'tsc6')
	const canvasTsc = join(root, 'ui', 'node_modules', 'typescript', 'bin', 'tsc')
	const failures = []
	const skipped = []
	for (const pkg of packages) {
		const tsc = pkg === 'ui' ? canvasTsc : extensionTsc
		if (!existsSync(tsc) || !existsSync(join(root, pkg, 'tsconfig.json'))) {
			skipped.push(pkg)
			continue
		}
		const run = launchSync('node', [tsc, '--noEmit', '-p', '.'], { cwd: join(root, pkg), encoding: 'utf8', windowsHide: true })
		if (run.status !== 0) {
			failures.push(`${pkg}:\n${`${run.stdout ?? ''}${run.stderr ?? ''}${run.error ? String(run.error) : ''}`.slice(-3000)}`)
		}
	}

	const note = skipped.length ? `Type check skipped for ${skipped.join(', ')}: run \`npm run setup\` to install their TypeScript.` : ''
	if (failures.length === 0) {
		if (note) {
			console.log(JSON.stringify({ systemMessage: note }))
		}
		return
	}
	const output = failures.join('\n\n')
	if (retry) {
		console.log(JSON.stringify({ systemMessage: `Type errors are still left:\n${output}${note ? `\n${note}` : ''}` }))
		return
	}
	process.stderr.write(`Type check failed after your changes:\n${output}\n`)
	process.exit(2)
})
