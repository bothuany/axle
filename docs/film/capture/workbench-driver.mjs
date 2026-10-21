// A headless page that stays open; GET /?js=<code> runs code with `p` (the page) in scope and returns its result.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { join } from 'node:path'
const [url, out, port = '7311'] = process.argv.slice(2)
const ctx = await chromium.launchPersistentContext(join(out, '..', 'wb-profile'), { headless: true, channel: 'chromium', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: 'dark' })
const p = ctx.pages()[0] ?? await ctx.newPage()
console.log('ua', await p.evaluate(() => navigator.userAgent))
const log = []
p.on('pageerror', e => log.push('pageerror ' + e.message.slice(0, 200)))
await p.goto(url)
await p.waitForSelector('.monaco-workbench', { timeout: 120000 })
const shot = async name => { await p.screenshot({ path: join(out, name + '.png') }); return 'shot ' + name }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const palette = async (title, wait = 800) => { await p.keyboard.press('Control+Shift+P'); await sleep(600); await p.keyboard.type(title, { delay: 8 }); await sleep(wait); await p.keyboard.press('Enter') }
createServer(async (req, res) => {
	const code = new URL(req.url, 'http://x').searchParams.get('js') ?? ''
	try {
		const fn = new Function('p', 'shot', 'sleep', 'palette', 'ctx', 'log', `return (async () => { ${code} })()`)
		const r = await fn(p, shot, sleep, palette, ctx, log)
		res.end(JSON.stringify(r ?? null, null, 1) + '\n' + log.splice(0).join('\n'))
	} catch (e) { res.end('ERR ' + e.message) }
}).listen(Number(port), '127.0.0.1')
console.log('ready', port)
