// Calls the app's own MCP server (flow-view's out/axle-mcp.js) the way an agent does: it finds the window that has
// the working directory open through the bridge files that window writes, so a board it draws appears in that window.
//   node mcp-call.mjs <axle-mcp.js> <folder> <tool> '<json arguments>' [<tool> '<json>' ...]
import { spawn } from 'node:child_process'

const [server, folder, ...pairs] = process.argv.slice(2)
const child = spawn(process.execPath, [server], { cwd: folder, stdio: ['pipe', 'pipe', 'inherit'] })
let buf = ''
const waiting = new Map()
child.stdout.on('data', d => {
	buf += d
	let i
	while ((i = buf.indexOf('\n')) >= 0) {
		const line = buf.slice(0, i).trim()
		buf = buf.slice(i + 1)
		if (!line) continue
		const msg = JSON.parse(line)
		waiting.get(msg.id)?.(msg)
	}
})
let id = 0
const rpc = (method, params) => new Promise(resolve => {
	const n = ++id
	waiting.set(n, resolve)
	child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n')
})
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'film-capture', version: '1' } })
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
for (let k = 0; k < pairs.length; k += 2) {
	const res = await rpc('tools/call', { name: pairs[k], arguments: JSON.parse(pairs[k + 1]) })
	const text = res.result?.content?.map(c => c.text).join('\n') ?? JSON.stringify(res.error)
	console.log(`--- ${pairs[k]}\n${text}`)
}
child.kill()
