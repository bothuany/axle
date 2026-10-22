// Records the app's Agents dock page and status island page live (their avatars animate), headless, on the site's Try
// page: three agents at work on the demo (Codex waiting for an approval, two Claude Code agents). The page's own
// switch for the `flow.agents.avatar` setting goes from "gyro" to "pixel" (pixel pets), then its "Allow" answers Codex.
//   node agents-live.mjs <site base url> <out dir> [close]
// `close` zooms the dock 7x for a close-up of the first row (pixel pets are pixel art: zoom, do not upscale).
// Writes frames/ (screencast JPEGs and frames.txt, an ffmpeg concat list with real durations) and marks.json (when each
// step happened, in seconds from the first frame).
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [base, out, mode] = process.argv.slice(2)
const zoom = mode === 'close' ? 7 : 1.9
const dir = join(out, 'frames')
mkdirSync(dir, { recursive: true })
const b = await chromium.launch({ headless: true })
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: 'dark' })
await p.goto(new URL('try/', base).href)
await p.locator('iframe.dock').scrollIntoViewIfNeeded()
await p.waitForTimeout(3000)
// Lay the two real pages out large for the recording: the dock on the left, the island on the right.
await p.addStyleTag({ content: `
	body * { visibility: hidden !important; }
	iframe.dock, iframe.island { visibility: visible !important; position: fixed !important; z-index: 99999; transform: none !important; margin: 0 !important; }
	iframe.dock { left: 0 !important; top: 0 !important; width: 400px !important; height: 560px !important; zoom: ${zoom}; }
	iframe.island { left: 560px !important; top: 24px !important; zoom: 1.8; opacity: 1 !important; }
	html, body { background: #0f0f0f !important; }` })
const cdp = await p.context().newCDPSession(p)
const stamps = []
cdp.on('Page.screencastFrame', async f => {
	stamps.push(f.metadata.timestamp)
	writeFileSync(join(dir, `f${String(stamps.length).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64'))
	await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
})
const marks = {}
const mark = name => { marks[name] = stamps.length ? stamps.at(-1) : null }
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })
await p.waitForTimeout(500)
mark('gyro')
await p.waitForTimeout(9000)
// The page's own control for the setting.
await p.evaluate(() => { const r = document.querySelector('input[name="avatar"][value="pixel"]'); r.checked = true; r.dispatchEvent(new Event('change')) })
mark('pixel')
await p.waitForTimeout(4000)
await p.evaluate(() => document.querySelector('[data-allow]').click())
mark('allowed')
await p.waitForTimeout(6000)
mark('end')
await cdp.send('Page.stopScreencast')
const t0 = stamps[0]
const list = stamps.map((t, i) => `file 'f${String(i + 1).padStart(5, '0')}.jpg'\nduration ${((stamps[i + 1] ?? t + 0.04) - t).toFixed(4)}`).join('\n')
writeFileSync(join(dir, 'frames.txt'), list + `\nfile 'f${String(stamps.length).padStart(5, '0')}.jpg'\n`)
writeFileSync(join(out, 'marks.json'), JSON.stringify(Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, v == null ? 0 : +(v - t0).toFixed(3)])), null, 1))
console.log('frames', stamps.length, 'over', (stamps.at(-1) - t0).toFixed(1), 's')
await b.close()
