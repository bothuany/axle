// Headless captures of Insilode's real canvas from the playground (canvas.html on its fake host, fed the film's demo data).
//   node shoot.mjs <baseUrl> <outDir> [name...]
// Every shot is 1920x1080 CSS px at 2x. Nothing opens a window.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const [base, out, ...only] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const ORDER = id => 'poly:/demo/orders-service/src/main/java/com/harborgoods/orders/OrderController.java#OrderController.place@' + id
const shots = {
	'changes': { url: `canvas.html?t=changes&mode=changed` },
	'order-before': { url: `canvas.html?t=${encodeURIComponent(ORDER(18))}` },
	'order-after': { url: `canvas.html?t=${encodeURIComponent(ORDER(20))}&mode=changed` },
}
const browser = await chromium.launch({ headless: true })
for (const [name, s] of Object.entries(shots)) {
	if (only.length && !only.includes(name)) continue
	const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: 'dark' })
	page.on('console', m => m.type() === 'error' && console.log(name, 'console:', m.text()))
	await page.goto(new URL(s.url, base).href)
	await page.waitForSelector('.react-flow__node', { timeout: 30000 })
	await page.waitForTimeout(2500)
	await page.screenshot({ path: join(out, `${name}.png`) })
	console.log('shot', name)
	await page.close()
}
await browser.close()
