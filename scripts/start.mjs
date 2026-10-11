#!/usr/bin/env node
// Starts Axle: the patched VS Code, in its own Electron window.
//   npm start [-- <folder>]      Axle window, optionally opening a folder
//   npm run web [-- <folder>]    same editor served at http://127.0.0.1:8765 for a browser

import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { VSCODE, isWin, launch } from './lib.mjs'

const argv = process.argv.slice(2)
const web = argv.includes('--web')
// `npm start -- dir` runs here from the repo root, but the folder is relative to where the user typed the command.
const folderArg = argv.find(a => !a.startsWith('--'))
const folder = folderArg && resolve(process.env.INIT_CWD ?? process.cwd(), folderArg)

if (!existsSync(join(VSCODE, 'scripts', 'code-server.js'))) {
	console.error('Axle is not set up yet: run `npm run setup` first.')
	process.exit(1)
}
if (folder && !(existsSync(folder) && statSync(folder).isDirectory())) {
	console.error(`No such folder: ${folderArg}`)
	process.exit(1)
}

/** VS Code's own Node (downloaded by setup), else the one running this script. */
function serverNode() {
	const exe = isWin ? 'node.exe' : 'node'
	const base = join(VSCODE, '.build', 'node')
	const dirs = dir => {
		try {
			return readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
		} catch {
			return []
		}
	}
	for (const v of dirs(base)) {
		for (const plat of dirs(join(base, v))) {
			const p = join(base, v, plat, exe)
			if (existsSync(p)) {
				return p
			}
		}
	}
	return process.execPath
}

/** Follows a child process: its exit code is ours, and a failure to start it is said out loud. */
function follow(start, what) {
	let child
	try {
		child = start()
	} catch (e) {
		console.error(`Could not start ${what}: ${e.message}`)
		process.exit(1)
	}
	child.on('error', e => {
		console.error(`Could not start ${what}: ${e.message}`)
		process.exit(1)
	})
	child.on('exit', code => process.exit(code ?? 0))
}

if (web) {
	const token = randomBytes(16).toString('hex')
	const port = process.env.FLOW_PORT ?? '8765'
	const url = `http://127.0.0.1:${port}/?tkn=${token}${folder ? `&folder=${encodeURIComponent((isWin ? '/' : '') + folder.replace(/\\/g, '/'))}` : ''}`
	console.log(`Axle → ${url}`)
	// The token goes to the server in a private file, not on its command line, where any local user could read it in the process list.
	const tokenDir = mkdtempSync(join(tmpdir(), 'flow-'))
	const tokenFile = join(tokenDir, 'token')
	writeFileSync(tokenFile, token, { mode: 0o600 })
	process.on('exit', () => rmSync(tokenDir, { recursive: true, force: true }))
	follow(() => launch(serverNode(), [join(VSCODE, 'scripts', 'code-server.js'), '--host', '127.0.0.1', '--port', port, '--connection-token-file', tokenFile, '--accept-server-license-terms', '--reconnection-grace-time', '60'], {
		cwd: VSCODE, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development', VSCODE_DEV: '1' },
	}), 'the editor server')
} else {
	// setup already compiled the editor and fetched Electron: skip VS Code's per-launch check when both are there.
	const ready = existsSync(join(VSCODE, 'out', 'main.js')) && existsSync(join(VSCODE, '.build', 'electron'))
	const env = { ...process.env, ...(ready ? { VSCODE_SKIP_PRELAUNCH: '1' } : {}) }
	const script = join(VSCODE, 'scripts', isWin ? 'code.bat' : 'code.sh')
	follow(() => launch(script, folder ? [folder] : [], { cwd: VSCODE, stdio: 'inherit', env }), 'Axle')
}
