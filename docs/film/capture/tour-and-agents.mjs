import { chromium } from 'playwright'
import { join } from 'node:path'
const [base, out] = process.argv.slice(2)
const ORDER = 'poly:/demo/orders-service/src/main/java/com/harborgoods/orders/OrderController.java#OrderController.place@20'
const b = await chromium.launch({ headless: true })
// The tour: the canvas's own "Review N changes" tour on the order flow.
{
	const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: 'dark' })
	await p.goto(new URL(`canvas.html?t=${encodeURIComponent(ORDER)}&mode=changed`, base).href)
	await p.waitForSelector('.react-flow__node')
	await p.waitForTimeout(2000)
	await p.getByText(/Review \d+ changes/).click()
	for (const t of [1500, 3500, 6000, 9000]) {
		await p.waitForTimeout(t === 1500 ? 1500 : t - [1500, 3500, 6000, 9000][[1500, 3500, 6000, 9000].indexOf(t) - 1])
		await p.screenshot({ path: join(out, `tour-${t}.png`) })
	}
	await p.close()
}
// The agents tile: the real dock and island pages, fed the playground's scripted session.
{
	const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: 'dark' })
	await p.goto(base)
	await p.locator('#agents-tile').scrollIntoViewIfNeeded()
	await p.waitForTimeout(2500)
	await p.click('#play')
	await p.waitForSelector('#allow', { timeout: 60000 })
	await p.waitForTimeout(1500)
	await p.locator('#agents-tile').screenshot({ path: join(out, 'agents-tile.png') })
	await p.locator('iframe.dock').screenshot({ path: join(out, 'dock.png') })
	const frames = await p.locator('iframe').all()
	for (const [i, f] of frames.entries()) console.log(i, await f.getAttribute('class'), await f.getAttribute('src'), await f.getAttribute('title'))
	await p.close()
}
await b.close()
