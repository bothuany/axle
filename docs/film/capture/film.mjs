// Captures everything the film shows from the playground (the app's own canvas, tour, dock and island
// pages, fed the film's demo data), headless:  node film.mjs <base url> <out dir>
// Stills are 2x (3840 px wide); the tour is a screencast (real cursor motion) written as numbered JPEGs
// plus a concat list with each frame's real duration.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [base, out] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const ORDER = 'poly:/demo/orders-service/src/main/java/com/harborgoods/orders/OrderController.java#OrderController.place@20'
const canvas = (t, changed = true) => new URL(`canvas.html?t=${encodeURIComponent(t)}${changed ? '&mode=changed' : ''}`, base).href
const b = await chromium.launch({ headless: true })
const page = async (w, h, dsf = 2) => b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, colorScheme: 'dark' })
// The canvas sometimes misses the host's first message on a cold load; one reload settles it.
const ready = async p => {
	if (!(await p.waitForSelector('.react-flow__node', { timeout: 15000 }).catch(() => null))) { await p.reload(); await p.waitForSelector('.react-flow__node', { timeout: 30000 }) }
	await p.waitForTimeout(2500)
}

// The change set, tall enough to pan down through it.
{
	const p = await page(1920, 2400)
	await p.goto(canvas('changes')); await ready(p)
	await p.screenshot({ path: join(out, 'changes-tall.png') })
	await p.close()
}
// The order flow after the change.
{
	const p = await page(1920, 1200)
	await p.goto(canvas(ORDER)); await ready(p)
	await p.screenshot({ path: join(out, 'order-after.png') })
	await p.close()
}
// The tour: a screencast of the canvas's own "Review N changes" tour on the order flow.
{
	const p = await page(1920, 1080)
	await p.goto(canvas(ORDER)); await ready(p)
	const dir = join(out, 'tour'); mkdirSync(dir, { recursive: true })
	const cdp = await p.context().newCDPSession(p)
	const frames = []
	cdp.on('Page.screencastFrame', async f => {
		frames.push(f.metadata.timestamp)
		writeFileSync(join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64'))
		await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
	})
	await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 3840, maxHeight: 2160, everyNthFrame: 1 })
	await p.waitForTimeout(800)
	await p.getByText(/Review \d+ changes/).click()
	// Headless, the tour holds on its first step; step it on a fixed beat with its own "next" control.
	for (let i = 0; i < 2; i++) {
		await p.waitForTimeout(3800)
		await p.locator('[aria-label*="Next" i], button[title*="Next" i]').first().click({ timeout: 3000 }).catch(() => p.getByText('›').first().click())
	}
	await p.waitForTimeout(4500)
	await cdp.send('Page.stopScreencast')
	const list = frames.map((t, i) => `file 'f${String(i + 1).padStart(5, '0')}.jpg'\nduration ${((frames[i + 1] ?? t + 0.04) - t).toFixed(4)}`).join('\n')
	writeFileSync(join(dir, 'frames.txt'), list + `\nfile 'f${String(frames.length).padStart(5, '0')}.jpg'\n`)
	console.log('tour frames', frames.length, 'over', (frames.at(-1) - frames[0]).toFixed(1), 's')
	await p.close()
}
// The agents tile: the dock page and the island page, sampled through the scripted session.
{
	const p = await page(1920, 1080, 3)
	await p.goto(base)
	await p.locator('#agents-tile').scrollIntoViewIfNeeded()
	await p.waitForTimeout(2500)
	const dir = join(out, 'agents'); mkdirSync(dir, { recursive: true })
	const snap = async tag => {
		await p.locator('iframe.dock').screenshot({ path: join(dir, `dock-${tag}.png`) })
		await p.locator('iframe.island').screenshot({ path: join(dir, `island-${tag}.png`) })
	}
	await snap('0-idle')
	await p.click('#play')
	for (let i = 1; i <= 4; i++) { await p.waitForTimeout(900); await snap(`1-working-${i}`) }
	await p.waitForSelector('#allow', { timeout: 60000 }); await p.waitForTimeout(1200)
	await snap('2-needs-you')
	await p.click('#allow')
	for (let i = 1; i <= 6; i++) { await p.waitForTimeout(1200); await snap(`3-after-${i}`) }
	await p.close()
}
await b.close()
