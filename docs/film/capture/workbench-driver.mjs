// A headless page that stays open; GET /?js=<code> runs code with `p` (the page) in scope and returns its result.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { join } from 'node:path'
const [url, out, port = '7311'] = process.argv.slice(2)
const ctx = await chromium.launchPersistentContext(join(out, '..', 'wb-profile'), { headless: true, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: 'dark' })
// The dev web client asks for extension files under /oss-dev/ while the server serves them under /insilode-dev/
// (the client is not told the product quality), so the theme and other extension files 404 in a fresh
// profile. Route them to where the server has them.
await ctx.route(/\/oss-dev\/vscode-remote-resource/, r => r.continue({ url: r.request().url().replace('/oss-dev/', '/insilode-dev/') }))
const p = ctx.pages()[0] ?? await ctx.newPage()
const log = []
p.on('pageerror', e => log.push('pageerror ' + e.message.slice(0, 200)))
await p.goto(url)
await p.waitForSelector('.monaco-workbench', { timeout: 120000 })
const shot = async name => { await p.screenshot({ path: join(out, name + '.png') }); return 'shot ' + name }
const sleep = ms => new Promise(r => setTimeout(r, ms))
// Chords do not reach the workbench headless, and the keyboard layout is detected as Turkish, so the palette is
// opened from the command center and the text is inserted, not typed. `pick` names the row to run.
const palette = async (title, wait = 1200) => {
	await p.locator('.command-center-center').first().click({ force: true }).catch(() => p.mouse.click(960, 18))
	await sleep(700)
	await p.keyboard.insertText('>' + title)
	await sleep(wait)
	const rows = await p.evaluate(() => [...document.querySelectorAll('.quick-input-list .monaco-list-row')].map(r => r.getAttribute('aria-label') ?? ''))
	const i = Math.max(0, rows.findIndex(r => r.startsWith(title)))
	for (let k = 0; k < i; k++) await p.keyboard.press('ArrowDown')
	await p.keyboard.press('Enter')
	return rows
}
createServer(async (req, res) => {
	const code = new URL(req.url, 'http://x').searchParams.get('js') ?? ''
	try {
		const fn = new Function('p', 'shot', 'sleep', 'palette', 'ctx', 'log', `return (async () => { ${code} })()`)
		const r = await fn(p, shot, sleep, palette, ctx, log)
		res.end(JSON.stringify(r ?? null, null, 1) + '\n' + log.splice(0).join('\n'))
	} catch (e) { res.end('ERR ' + e.message) }
}).listen(Number(port), '127.0.0.1')
console.log('ready', port)
