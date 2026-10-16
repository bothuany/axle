// Stop: when the working tree has TypeScript changes, run the architecture rules before Claude finishes.
// A violation is sent back (exit 2) so it gets fixed in the same turn. On the stop right after that, arch runs again
// but no longer blocks (no loop): a violation still left is shown to the user instead.
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { launchSync } from '../../scripts/lib.mjs'

let input = ''
process.stdin.on('data', d => input += d)
process.stdin.on('end', () => {
	const retry = Boolean(JSON.parse(input || '{}').stop_hook_active)
	const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()

	// -z: paths unquoted and NUL-separated; --untracked-files=all: a new folder lists its files, not just `dir/`.
	const status = execFileSync('git', ['status', '--porcelain', '-z', '--untracked-files=all', '--', 'editor/extensions', 'ui/src'], { cwd: root, encoding: 'utf8' })
	if (!status.split('\0').some(entry => /\.tsx?$/.test(entry))) {
		return
	}
	// `npm run setup` installs the extensions and the canvas, not the root tooling: a missing install is not a violation.
	if (!existsSync(join(root, 'node_modules', 'dependency-cruiser'))) {
		console.log(JSON.stringify({ systemMessage: 'Architecture rules skipped: run `npm ci` at the repo root to install dependency-cruiser.' }))
		return
	}

	// npm's own script next to this Node (the Windows layout), run by this Node: npm.cmd started through cmd.exe by
	// a bare name resolves its own folder to the cwd and fails.
	const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
	const run = existsSync(npmCli)
		? launchSync('node', [npmCli, 'run', '--silent', 'arch'], { cwd: root, encoding: 'utf8', windowsHide: true })
		: launchSync('npm', ['run', '--silent', 'arch'], { cwd: root, encoding: 'utf8', windowsHide: true })
	if (run.status === 0) {
		return
	}
	const output = `${run.stdout ?? ''}${run.stderr ?? ''}${run.error ? String(run.error) : ''}`.slice(-4000)
	if (retry) {
		console.log(JSON.stringify({ systemMessage: `npm run arch still fails:\n${output}` }))
		return
	}
	process.stderr.write(`npm run arch failed after your changes:\n${output}\n`)
	process.exit(2)
})
