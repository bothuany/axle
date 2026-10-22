// Takes the stills the site shows before its canvas loads and in its problem sections, from the built site itself, in headless
// Chrome: `npm run build`, `npm run preview` in another terminal, then `node scripts/capture-media.mjs [base url]`. The stills are
// committed (public/media/); run this again after a change to the canvas or the demo that they should show.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const base = (process.argv[2] ?? 'http://127.0.0.1:4173/insilode/').replace(/\/?$/, '/')
const out = fileURLToPath(new URL('../public/media/', import.meta.url))
const CHROMES = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean)
const chrome = CHROMES.find(p => existsSync(p))
if (!chrome) throw new Error('No Chrome found: set CHROME_PATH.')

const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-first-run', '--disable-gpu', '--no-sandbox'] })

/** A still of canvas.html on one flow, at the size the page shows it. `open`: the folded calls to show first, by the name on their port; `from`: the card the still starts at. */
async function canvas(name, query, width, height, scale = 1, open = [], from = '', jpeg = false) {
	const page = await browser.newPage()
	await page.setViewport({ width, height, deviceScaleFactor: scale })
	await page.goto(`${base}canvas.html${query}`, { waitUntil: 'networkidle0' })
	await page.waitForSelector('.react-flow__node')
	await wait(1000)
	for (const label of open) {
		await page.click(`button.port.folded[title="Show ${label}"]`)
		await wait(900)
	}
	if (open.length) {
		await page.click('.react-flow__controls-button[title="Fit view"]')
		await wait(600)
	}
	await wait(800)
	// A wide flow fits the canvas small: then the still is cut to the cards (at most 5:2), so its code stays readable in the page.
	const clip = open.length
		? await page.evaluate(from => {
				const nodes = [...document.querySelectorAll('.react-flow__node')].filter(n => n.querySelector('.port, pre, code, table, [class*=code]') || n.textContent?.trim())
				const start = nodes.find(n => from && n.textContent?.includes(from))?.getBoundingClientRect().left ?? -Infinity
				const boxes = nodes.map(n => n.getBoundingClientRect()).filter(b => b.width < innerWidth * 0.9 && b.left >= start - 1)
				const left = Math.min(...boxes.map(b => b.left)) - 24
				const top = Math.min(...boxes.map(b => b.top)) - 24
				const width = Math.max(...boxes.map(b => b.right)) + 24 - left
				const height = Math.max(Math.max(...boxes.map(b => b.bottom)) + 24 - top, width / 2.5)
				return { x: Math.max(0, left), y: Math.max(0, top - (height - (Math.max(...boxes.map(b => b.bottom)) + 24 - top)) / 2), width, height }
			}, from)
		: undefined
	await page.screenshot({ path: `${out}${name}.webp`, type: 'webp', quality: 78, clip })
	// The social cards want a JPEG.
	if (jpeg) await page.screenshot({ path: `${out}${name}.jpg`, type: 'jpeg', quality: 78, clip })
	await page.close()
}

const data = await (await fetch(`${base}data/demo.json`)).json()
const invoice = data.before.entries.find(e => e.http === 'GET /orders/{id}/invoice')

await canvas('hero', '', 1600, 940, 1, [], '', true)
await canvas('hero-narrow', '', 420, 560, 2)
await canvas('changes', '?t=changes&mode=changed', 1600, 1000)
await canvas('services', `?t=${encodeURIComponent(invoice.id)}`, 2600, 1300, 1.25, ['get_invoice', 'InvoiceService.find', 'invoices'], 'BillingClient.findInvoice')

// The agents: the Try page's dock and island, as one still.
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 })
await page.goto(`${base}try/`, { waitUntil: 'networkidle0' })
const stage = await page.waitForSelector('.agents-stage')
await stage.scrollIntoView()
const dock = await (await page.$('iframe.dock')).contentFrame()
await dock.waitForSelector('.agent')
await wait(1500)
await stage.screenshot({ path: `${out}agents.webp`, type: 'webp', quality: 78 })
await browser.close()
