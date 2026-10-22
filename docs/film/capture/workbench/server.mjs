// Starts the editor server in web mode for the film, like `npm run web`, but with its own extensions and server data
// folders under <work>, so the film runs this checkout's built extensions (copied by exts.mjs, Insilode Dark included)
// and a clean profile. Headless: it only serves http://127.0.0.1:8771; capture with ../workbench-driver.mjs.
//   node server.mjs <work dir> <demo repo>
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [work, demo] = process.argv.slice(2).map(p => resolve(p))
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
// The main checkout holds the generated VS Code (a worktree has none): the first editor/vscode up from here.
let VSCODE = join(repo, 'editor', 'vscode')
for (let d = repo; d !== dirname(d); d = dirname(d)) {
	try { readdirSync(join(d, 'editor', 'vscode', 'scripts')); VSCODE = join(d, 'editor', 'vscode'); break } catch { /* keep looking */ }
}
const nodeDir = join(VSCODE, '.build', 'node')
const version = readdirSync(nodeDir)[0]
const node = join(nodeDir, version, readdirSync(join(nodeDir, version))[0], process.platform === 'win32' ? 'node.exe' : 'node')
const token = randomBytes(16).toString('hex')
writeFileSync(join(work, 'token'), token, { mode: 0o600 })
const folder = (process.platform === 'win32' ? '/' : '') + demo.replace(/\\/g, '/')
console.log(`URL http://127.0.0.1:8771/?tkn=${token}&folder=${encodeURIComponent(folder)}`)
const c = spawn(node, [join(VSCODE, 'scripts', 'code-server.js'), '--host', '127.0.0.1', '--port', '8771', '--connection-token-file', join(work, 'token'), '--accept-server-license-terms', '--reconnection-grace-time', '60', '--extensions-dir', join(work, 'ext'), '--server-data-dir', join(work, 'srvdata')], {
	cwd: VSCODE, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development', VSCODE_DEV: '1', FLOW_ROOT: repo },
})
c.on('exit', code => process.exit(code ?? 0))
