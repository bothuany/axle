// The playground in a real browser (headless Chrome): the whole story a visitor goes through, and the paths around it. Run after
// `npm run build` (and `node scripts/playground-data.mjs` before that): `npm run test:e2e`. It serves dist/ the way GitHub Pages does,
// under /axle/, and fails on any console error, 4xx/5xx response or page error.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { preview } from 'vite'
import puppeteer from 'puppeteer-core'

const CHROMES = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean)
const chrome = CHROMES.find(p => existsSync(p))
const skip = chrome ? false : 'no Chrome or Edge found (set CHROME_PATH)'
if (!chrome && process.env.CI) throw new Error('The end-to-end test needs Chrome in CI: none was found.')

let server
let browser
let url
const wait = ms => new Promise(r => setTimeout(r, ms))

before(async () => {
	if (skip) return
	server = await preview({ base: '/axle/', preview: { port: 0, host: '127.0.0.1', strictPort: false } })
	url = `${server.resolvedUrls.local[0].replace(/\/$/, '')}/`
	browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-first-run', '--disable-gpu', '--no-sandbox'] })
})
after(async () => {
	await browser?.close()
	await server?.close()
})

/** A page that remembers what went wrong in it: console errors, page errors, failed requests. */
async function open(viewport = { width: 1700, height: 1000 }) {
	const page = await browser.newPage()
	const problems = []
	page.on('console', m => m.type() === 'error' && problems.push(`console: ${m.text()}`))
	page.on('pageerror', e => problems.push(`pageerror: ${e.message}`))
	page.on('response', r => r.status() >= 400 && problems.push(`${r.status()}: ${r.url()}`))
	await page.setViewport(viewport)
	await page.goto(url, { waitUntil: 'networkidle0', timeout: 120_000 })
	return { page, problems }
}
const frame = (page, part) => page.frames().find(f => f.parentFrame() && f.url().includes(part))
const until = async (probe, what, ms = 60_000) => {
	const t0 = Date.now()
	while (Date.now() - t0 < ms) {
		try {
			const v = await probe()
			if (v) return v
		} catch { /* the page is changing */ }
		await wait(150)
	}
	assert.fail(`timed out waiting for ${what}`)
}
const canvas = page => frame(page, 'canvas.html')
const canvasText = page => canvas(page).evaluate(() => document.body.innerText)
const caption = page => page.evaluate(() => document.querySelector('.caption p')?.textContent ?? '')
const captionHas = (page, needle) => until(async () => (await caption(page)).includes(needle), `the caption to say "${needle}"`)
const drawn = page => until(() => canvas(page)?.evaluate(() => !!document.querySelector('.react-flow__node')), 'the canvas to draw a card')
const dockText = page => frame(page, 'dock.html').evaluate(() => document.body.innerText)
const islandText = page => frame(page, 'island.html').evaluate(() => document.body.innerText)
const clickInCanvas = (page, label) => canvas(page).evaluate(l => [...document.querySelectorAll('button')].find(b => b.textContent === l).click(), label)

/** Starts the story, allows the edit and opens the change on the canvas. */
async function playThrough(page) {
	await page.click('#try')
	await captionHas(page, 'wants to edit')
	await page.click('#allow')
	await captionHas(page, 'Done.')
	await page.click('#review')
	await until(async () => /Review 2 changes/.test(await canvasText(page)), 'the canvas to offer "Review 2 changes"')
}

test('the page opens on the order flow, with no agent running', { skip }, async () => {
	const { page, problems } = await open()
	await drawn(page)
	assert.match(await canvasText(page), /OrderController\.place/)
	assert.match(await dockText(page), /No agents running/)
	assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.island')).opacity), '0', 'no agent, no overlay')
	assert.equal(await canvas(page).evaluate(() => getComputedStyle(document.querySelector('.react-flow__minimap')).display), 'none', 'the overview map is left out')
	assert.deepEqual(problems, [])
	await page.close()
})

test('the whole story: Claude asks, you allow, the dock and the overlay say what it touched, the canvas shows the change', { skip }, async () => {
	const { page, problems } = await open()
	await drawn(page)
	await page.click('#try')
	await captionHas(page, 'wants to edit Order.java and OrderService.java')
	// The dock, the overlay and the caption all say the agent waits for you.
	await until(async () => /Wants to: Editing Order\.java and OrderService\.java/.test(await dockText(page)) && /approval/i.test(await dockText(page)), 'the dock to show the approval')
	await until(async () => /Needs approval/.test(await islandText(page)), 'the overlay to say "Needs approval"')
	assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.island')).opacity), '1')
	await page.click('#allow')
	await captionHas(page, 'Done. The change touched 4 flows and the orders table')
	await until(async () => /This turn touched 4 flows and table orders \(4 endpoints\)/.test(await dockText(page)), 'the dock to list what the turn touched')
	await until(async () => /Done/.test(await islandText(page)), 'the overlay to say Done')
	// The change on the canvas: the order flow, with the green and red on its cards.
	await page.click('#review')
	await until(async () => /Review 2 changes/.test(await canvasText(page)), 'the canvas to offer "Review 2 changes"')
	assert.ok(await canvas(page).evaluate(() => [...document.querySelectorAll('.react-flow__node')].some(n => /applyDiscount/.test(n.textContent))), 'the new method is on the canvas')
	assert.deepEqual(problems, [])
	await page.close()
})

test('a flow chip of the dock opens that flow with the change on its cards', { skip }, async () => {
	const { page, problems } = await open()
	await page.click('#try')
	await captionHas(page, 'wants to edit')
	await page.click('#allow')
	await captionHas(page, 'Done.')
	const dock = frame(page, 'dock.html')
	await until(() => dock.evaluate(() => document.querySelector('.flow')), 'the dock chips')
	await dock.evaluate(() => [...document.querySelectorAll('.flow')].find(c => c.textContent === 'GET /orders').click())
	await captionHas(page, 'GET /orders with Claude')
	await until(async () => /OrderController\.list/.test(await canvasText(page)), 'the canvas to show GET /orders')
	assert.deepEqual(problems, [])
	await page.close()
})

test('Keep clears the marks; Undo puts the code back and starts the story again', { skip }, async () => {
	const { page, problems } = await open()
	await drawn(page)
	await playThrough(page)
	await clickInCanvas(page, 'Keep')
	await captionHas(page, 'Kept.')
	await until(async () => !/Review 2 changes/.test(await canvasText(page)), 'the canvas to stop marking the change')
	await page.click('#again')
	await captionHas(page, 'This is the flow of POST /orders')
	await playThrough(page)
	await clickInCanvas(page, 'Undo')
	await captionHas(page, 'This is the flow of POST /orders')
	await until(async () => !/Review 2 changes/.test(await canvasText(page)), 'the canvas to forget the change')
	await until(async () => /No agents running/.test(await dockText(page)), 'the dock to forget the agent')
	assert.equal(await page.evaluate(() => !!document.querySelector('#play')), true, 'the story can be played again')
	assert.deepEqual(problems, [])
	await page.close()
})

test('saying no changes nothing', { skip }, async () => {
	const { page, problems } = await open()
	await drawn(page)
	await page.click('#try')
	await captionHas(page, 'wants to edit')
	await page.click('#deny')
	await captionHas(page, 'Nothing was changed')
	assert.doesNotMatch(await canvasText(page), /Review \d+ changes/)
	assert.deepEqual(problems, [])
	await page.close()
})

test('another endpoint opens on the canvas', { skip }, async () => {
	const { page, problems } = await open()
	await drawn(page)
	const id = await page.evaluate(() => [...document.querySelectorAll('.picks option')].find(o => o.textContent.startsWith('GET /orders  (')).value)
	await page.select('.picks select', id)
	await until(async () => /OrderController\.list/.test(await canvasText(page)), 'the canvas to show GET /orders')
	assert.deepEqual(problems, [])
	await page.close()
})

test('the harness map is the real scan of the demo project, with its one warning', { skip }, async () => {
	const { page, problems } = await open()
	const text = await page.evaluate(() => document.querySelector('#harness-root')?.innerText ?? '')
	for (const word of ['Instructions', 'Rules', 'Skills', 'Subagents', 'Hooks', 'MCP servers', 'CLAUDE.md', 'graphql-schema.md']) assert.ok(text.includes(word), `the map has ${word}`)
	assert.match(text, /matches no file in the project/, 'the rule that matches nothing is flagged')
	assert.ok(!/Batuhan|\/Users\/|C:\\/.test(text), 'nothing of the machine that built it is in the map')
	assert.deepEqual(problems, [])
	await page.close()
})

test('what the demo cannot do is said where a visitor reaches for it', { skip }, async () => {
	const { page, problems } = await open()
	await drawn(page)
	// Handing the flow to an agent is the app's; here the page says so.
	await clickInCanvas(page, 'Ask about this flow')
	await until(() => page.evaluate(() => /hands the flow to the agent/.test(document.querySelector('.caption .note')?.textContent ?? '')), 'the note')
	assert.deepEqual(problems, [])
	await page.close()
})

test('below desktop width the page shows the video and loads no canvas', { skip }, async () => {
	const { page, problems } = await open({ width: 390, height: 844, isMobile: true, hasTouch: true })
	assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.stagewrap')).display), 'none')
	assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.fallback')).display), 'block')
	assert.equal(page.frames().filter(f => f.parentFrame() && f.url().includes('canvas.html')).length, 0, 'no canvas was loaded')
	assert.ok((await page.evaluate(() => document.querySelector('#harness-root')?.innerText ?? '')).includes('Instructions'), 'the harness map is there')
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll')
	assert.deepEqual(problems, [])
	await page.close()
})
