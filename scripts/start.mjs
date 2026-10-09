#!/usr/bin/env node
// Starts Flow. Desktop window (Tauri) by default; `--web` serves it to your browser instead.
//   npm start [-- <folder>]      desktop window, optionally opening a folder
//   npm run web [-- <folder>]    http://127.0.0.1:8765 in the browser

import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VSCODE = join(ROOT, 'editor', 'vscode')
const isWin = process.platform === 'win32'
const argv = process.argv.slice(2)
const web = argv.includes('--web')
const folder = argv.find(a => !a.startsWith('--'))

if (!existsSync(join(VSCODE, 'scripts', 'code-server.js'))) {
	console.error('Flow is not set up yet: run `npm run setup` first.')
	process.exit(1)
}

/** VS Code's own Node (downloaded by setup), else the one running this script. */
function serverNode() {
	const exe = isWin ? 'node.exe' : 'node'
	const base = join(VSCODE, '.build', 'node')
	if (existsSync(base)) {
		for (const v of readdirSync(base)) {
			for (const plat of readdirSync(join(base, v))) {
				const p = join(base, v, plat, exe)
				if (existsSync(p)) {
					return p
				}
			}
		}
	}
	return process.execPath
}

if (web) {
	const token = randomBytes(16).toString('hex')
	const port = process.env.FLOW_PORT ?? '8765'
	const url = `http://127.0.0.1:${port}/?tkn=${token}${folder ? `&folder=${encodeURIComponent((isWin ? '/' : '') + resolve(folder).replace(/\\/g, '/'))}` : ''}`
	console.log(`Flow → ${url}`)
	const child = spawn(serverNode(), [join(VSCODE, 'scripts', 'code-server.js'), '--host', '127.0.0.1', '--port', port, '--connection-token', token, '--accept-server-license-terms', '--reconnection-grace-time', '60'], {
		cwd: VSCODE, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development', VSCODE_DEV: '1' },
	})
	child.on('exit', code => process.exit(code ?? 0))
} else {
	if (spawnSync('cargo', ['--version'], { stdio: 'ignore', shell: isWin }).status !== 0) {
		console.error('The desktop window needs Rust (https://rustup.rs). Without it, use `npm run web`.')
		process.exit(1)
	}
	const env = { ...process.env, FLOW_EDITOR: VSCODE, ...(folder ? { FLOW_FOLDER: resolve(folder) } : {}) }
	const child = spawn('npm', ['start'], { cwd: join(ROOT, 'desktop'), stdio: 'inherit', env, shell: isWin })
	child.on('exit', code => process.exit(code ?? 0))
}
