// Records the app's Agents dock page and status island page live (their avatars animate), headless, while the
// playground's scripted session runs: working, needs you, then the avatar style switched from "gyro" to "pixel"
// (the flow.agents.avatar setting's two values), allowed, working, done.
//   node agents-live.mjs <playground base url> <out dir> [close]
// `close` zooms the dock 7x for a close-up of the avatar (the pixel pets are pixel art: zoom, do not upscale).
// Writes frames/ (screencast JPEGs), frames.txt (ffmpeg concat list with real durations) and marks.json (when each
// state began, in seconds from the first frame).
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [base, out, mode] = process.argv.slice(2)
const zoom = mode === 'close' ? 7 : 2.4
const dir = join(out, 'frames')
mkdirSync(dir, { recursive: true })
const b = await chromium.launch({ headless: true })
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: 'dark' })
// In both pages, the avatar style comes in each data message; while the parent says so, ask for pixel pets
// instead, as the setting would. Same origin, so a frame can read the flag on its parent.
await ctx.addInitScript(() => {
	if (window === window.top) return
	const pixel = () => window.parent.__filmAvatar === 'pixel'
	const swap = v => (Array.isArray(v) ? v.map(swap) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'avatar' && x === 'gyro' ? 'pixel' : swap(x)])) : v)
	const repaints = []
	window.__filmRepaint = () => repaints.forEach(r => r())
	// The dock page: data comes as a message.
	const add = window.addEventListener.bind(window)
	window.addEventListener = (type, fn, opts) => {
		if (type !== 'message') return add(type, fn, opts)
		let last
		const wrapped = e => { last = e; fn(pixel() ? new MessageEvent('message', { data: swap(e.data), origin: e.origin, source: e.source }) : e) }
		repaints.push(() => last && wrapped(last))
		return add(type, wrapped, opts)
	}
	// The island page: the parent calls window.axleRender(model).
	let render
	let lastModel
	Object.defineProperty(window, 'axleRender', {
		configurable: true,
		get: () => (render ? m => { lastModel = m; render(pixel() ? swap(m) : m) } : undefined),
		set: fn => { render = fn },
	})
	repaints.push(() => lastModel && render && render(pixel() ? swap(lastModel) : lastModel))
})
const p = await ctx.newPage()
await p.goto(base)
await p.locator('#agents-tile').scrollIntoViewIfNeeded()
await p.waitForTimeout(2500)
// Lay the two real pages out large for the recording: the dock on the left, the island on the right.
await p.addStyleTag({ content: `
	body > * { visibility: hidden !important; }
	iframe.dock, iframe.island { visibility: visible !important; position: fixed !important; z-index: 99999; transform: none !important; }
	iframe.dock { left: 0 !important; top: 0 !important; width: 400px !important; height: 420px !important; zoom: ${zoom}; }
	iframe.island { left: 560px !important; top: 24px !important; zoom: 1.8; opacity: 1 !important; }
	html, body { background: #0f0f0f !important; }` })
const cdp = await ctx.newCDPSession(p)
const stamps = []
cdp.on('Page.screencastFrame', async f => {
	stamps.push(f.metadata.timestamp)
	writeFileSync(join(dir, `f${String(stamps.length).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64'))
	await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
})
const marks = {}
const mark = name => { marks[name] = stamps.length ? stamps.at(-1) : null }
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })
await p.waitForTimeout(600)
mark('idle')
await p.evaluate(() => document.querySelector('#play').click())
mark('play')
await p.waitForSelector('#allow', { state: 'attached', timeout: 60000 })
mark('needs')
await p.waitForTimeout(3500)
await p.evaluate(() => { window.__filmAvatar = 'pixel'; for (const f of document.querySelectorAll('iframe')) f.contentWindow.__filmRepaint?.() })
// Both pages repaint at once with pixel pets, as a change of the setting does in the app.
mark('pixel')
await p.waitForTimeout(3500)
await p.evaluate(() => document.querySelector('#allow').click())
mark('allowed')
await p.waitForTimeout(9000)
mark('end')
await cdp.send('Page.stopScreencast')
const t0 = stamps[0]
const list = stamps.map((t, i) => `file 'f${String(i + 1).padStart(5, '0')}.jpg'\nduration ${((stamps[i + 1] ?? t + 0.04) - t).toFixed(4)}`).join('\n')
writeFileSync(join(dir, 'frames.txt'), list + `\nfile 'f${String(stamps.length).padStart(5, '0')}.jpg'\n`)
writeFileSync(join(out, 'marks.json'), JSON.stringify(Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, v == null ? 0 : +(v - t0).toFixed(3)])), null, 1))
console.log('frames', stamps.length, 'over', (stamps.at(-1) - t0).toFixed(1), 's', JSON.stringify(marks && Object.keys(marks)))
await b.close()
