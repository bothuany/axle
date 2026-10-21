// Waits for `npm run web` to print its URL into a log and prints that URL, so the caller can open it
// in the browser pane. Exits non-zero, with the log's tail, when the server fails or says nothing in time.
//
//   node .claude/skills/probe/scripts/wait-url.mjs <log> [timeoutSeconds=120]

import { existsSync, readFileSync } from 'node:fs'

const [log, timeoutArg] = process.argv.slice(2)
if (!log) {
	console.error('usage: wait-url.mjs <log> [timeoutSeconds]')
	process.exit(2)
}
const deadline = Date.now() + Number(timeoutArg ?? 120) * 1000
const tail = text => text.split(/\r?\n/).slice(-20).join('\n')

for (;;) {
	const text = existsSync(log) ? readFileSync(log, 'utf8') : ''
	// The server is up once the extension host agent listens; the token URL is printed before that.
	const url = /Insilode → (http:\/\/\S+\?tkn=\S+)/.exec(text)?.[1]
	if (url && /Extension host agent (listening|started)/.test(text)) {
		console.log(url)
		process.exit(0)
	}
	// Only failures that stop the server: the workbench logs harmless "Error:" lines while it starts.
	if (/EADDRINUSE|address already in use|Cannot find module|No such folder|exited with code [1-9]/i.test(text)) {
		console.error(`the web server failed:\n${tail(text)}`)
		process.exit(1)
	}
	if (Date.now() > deadline) {
		console.error(`no URL after ${timeoutArg ?? 120}s:\n${tail(text)}`)
		process.exit(1)
	}
	await new Promise(r => setTimeout(r, 500))
}
