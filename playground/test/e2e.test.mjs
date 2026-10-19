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
/** The page inside the iframe that is in `selector` (a tile's canvas, the dock, the overlay). */
const inside = async (page, selector) => {
	const handle = await until(() => page.$(selector), `${selector} to exist`)
	return until(() => handle.contentFrame(), `${selector} to load`)
}
const flowCanvas = page => inside(page, '#flow-tile iframe.canvas')
const changesCanvas = page => inside(page, '#changes-tile iframe.canvas')
const textOf = async frame => frame.evaluate(() => document.body.innerText)
const drawn = async frame => until(() => frame.evaluate(() => !!document.querySelector('.react-flow__node')), 'the canvas to draw a card')
const dockText = async page => textOf(await inside(page, 'iframe.dock'))
const islandText = async page => textOf(await inside(page, 'iframe.island'))
const foot = (page, tile) => page.evaluate(t => document.querySelector(`#${t} .foot p`)?.textContent ?? '', tile)
const footHas = (page, tile, needle) => until(async () => (await foot(page, tile)).includes(needle), `the ${tile} to say "${needle}"`)
/** Clicks the button with this label inside the iframe, once it is there. */
const clickIn = (frame, label) => until(() => frame.evaluate(l => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === l); b?.click(); return !!b }, label), `the "${label}" button`)
const steps = page => page.evaluate(() => [...document.querySelectorAll('.steps li')].map(li => li.children[1].textContent))
const dockSays = (page, pattern, what) => until(async () => pattern.test(await dockText(page)), what)

/** Starts the agent from the page's first button and answers its question: the turn is then over. */
async function playThrough(page) {
	await page.click('#try')
	await until(() => page.$('#allow'), 'the permission question')
	await page.click('#allow')
	await until(() => page.$('#review'), 'the end of the turn')
}

test('the page opens on the order flow, with the menu, the languages and no agent', { skip }, async () => {
	const { page, problems } = await open()
	const canvas = await flowCanvas(page)
	await drawn(canvas)
	assert.match(await textOf(canvas), /OrderController\.place/)
	assert.equal(await canvas.evaluate(() => getComputedStyle(document.querySelector('.react-flow__minimap')).display), 'none', 'the overview map is left out')
	assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.pill .links a')].map(a => a.textContent)), ['Agents', 'Changes', 'Harness', 'What is real'])
	assert.ok((await page.evaluate(() => document.querySelector('.langs')?.textContent ?? '')).includes('Rust'))
	await page.evaluate(() => document.getElementById('agents-tile').scrollIntoView())
	await dockSays(page, /No agents running/, 'the dock to say no agent runs')
	assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.island')).opacity), '0', 'no agent, no overlay')
	assert.deepEqual(problems, [])
	await page.close()
})

test('another endpoint opens on the canvas', { skip }, async () => {
	const { page, problems } = await open()
	const canvas = await flowCanvas(page)
	await drawn(canvas)
	const id = await page.evaluate(() => [...document.querySelectorAll('#flow-tile option')].find(o => o.textContent.startsWith('GET /orders  (')).value)
	await page.select('#flow-tile select', id)
	await until(async () => /OrderController\.list/.test(await textOf(canvas)), 'the canvas to show GET /orders')
	assert.deepEqual(problems, [])
	await page.close()
})

test('the agent: it asks, the dock and the overlay say it waits, you allow, and they say what it touched', { skip }, async () => {
	const { page, problems } = await open()
	await page.click('#try')
	await until(() => page.$('#allow'), 'the permission question')
	assert.deepEqual((await steps(page)).slice(0, 3), ['Asked axle which endpoints there are', 'Read OrderService.java', 'Asked axle who else reads the orders table'])
	await until(async () => /Wants to: Editing Order\.java and OrderService\.java/.test(await dockText(page)) && /approval/i.test(await dockText(page)), 'the dock to show the approval')
	await until(async () => /Needs approval/.test(await islandText(page)), 'the overlay to say "Needs approval"')
	assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.island')).opacity), '1')
	await page.click('#allow')
	await until(() => page.$('#review'), 'the end of the turn')
	assert.ok((await steps(page)).at(-1).startsWith('Done. It touched 4 flows and the orders table, which 4 endpoints use'))
	await until(async () => /This turn touched 4 flows and table orders \(4 endpoints\)/.test(await dockText(page)), 'the dock to list what the turn touched')
	await until(async () => /Done/.test(await islandText(page)), 'the overlay to say Done')
	assert.deepEqual(problems, [])
	await page.close()
})

test('a flow of the dock opens on the change tile (before and after the tile has loaded)', { skip }, async () => {
	const { page, problems } = await open()
	// The tile is far below the first screen: the canvas has not loaded when the chip is clicked.
	assert.equal(await page.evaluate(() => !document.querySelector('#changes-tile iframe')), true, 'the change tile has not loaded yet')
	await playThrough(page)
	const dock = await inside(page, 'iframe.dock')
	await until(() => dock.evaluate(() => document.querySelector('.flow')), 'the dock chips')
	await dock.evaluate(() => [...document.querySelectorAll('.flow')].find(c => c.textContent === 'GET /orders').click())
	const canvas = await changesCanvas(page)
	await until(async () => /OrderController\.list/.test(await textOf(canvas)), 'the change tile to show GET /orders')
	assert.equal(await page.evaluate(() => document.querySelector('#changes-tile select').selectedOptions[0].textContent.startsWith('GET /orders  (')), true)
	// Now that the tile is loaded, another chip is a `show` message to the running canvas.
	await dock.evaluate(() => [...document.querySelectorAll('.flow')].find(c => c.textContent === 'GET /orders/{id}').click())
	await until(async () => /OrderController.show/.test(await textOf(canvas)), 'the loaded canvas to show GET /orders/{id}')
	assert.deepEqual(problems, [])
	await page.close()
})

test('the change tile: the order flow with its green and red, Keep, Undo, and the replay', { skip }, async () => {
	const { page, problems } = await open()
	await page.evaluate(() => document.getElementById('changes-tile').scrollIntoView())
	const canvas = await changesCanvas(page)
	await drawn(canvas)
	// The tile has stepped to the first changed card by itself: the canvas's own review tour is running.
	await until(() => canvas.evaluate(() => /1 \/ 2/.test(document.querySelector('.tour')?.textContent ?? '')), 'the review tour to start')
	assert.ok(await canvas.evaluate(() => [...document.querySelectorAll('.react-flow__node')].some(n => /applyDiscount/.test(n.textContent) && /Agent edit/.test(n.textContent))), 'the new method is on the canvas, marked as an agent edit')
	assert.ok(await until(() => canvas.evaluate(() => { const r = document.querySelector('.react-flow__viewport')?.style.transform ?? ''; return Number(/scale\(([\d.]+)\)/.exec(r)?.[1]) >= 1.2 }), 'the canvas to be zoomed in on that card'))
	await clickIn(canvas, 'Keep')
	await footHas(page, 'changes-tile', 'Kept.')
	await until(() => canvas.evaluate(() => !document.querySelector('.tour')), 'the canvas to stop marking the change')
	await page.click('#changes-tile .replay')
	const again = await changesCanvas(page)
	await until(() => again.evaluate(() => /1 \/ 2/.test(document.querySelector('.tour')?.textContent ?? '')), 'the change to be back, with its tour')
	await clickIn(again, 'Undo')
	await footHas(page, 'changes-tile', 'Undone.')
	await until(() => again.evaluate(() => !document.querySelector('.tour')), 'the canvas to forget the change')
	assert.deepEqual(problems, [])
	await page.close()
})

test('saying no changes nothing, and Start over plays it again', { skip }, async () => {
	const { page, problems } = await open()
	await page.click('#try')
	await until(() => page.$('#deny'), 'the permission question')
	await page.click('#deny')
	await until(() => page.$('#again'), 'the end of the story')
	assert.ok((await steps(page)).at(-1).startsWith('Wants to edit'))
	assert.equal(await page.evaluate(() => document.querySelector('.steps li:last-child').className), 'no')
	await page.click('#again')
	await until(() => page.$('#play'), 'the agent to be ready to start again')
	await dockSays(page, /No agents running/, 'the dock to forget the agent')
	assert.deepEqual(await steps(page), [], 'the list of steps is empty again')
	// And it plays again, to the end.
	await page.click('#play')
	await until(() => page.$('#allow'), 'the permission question, the second time')
	await page.click('#allow')
	await until(() => page.$('#review'), 'the end of the second turn')
	assert.deepEqual(problems, [])
	await page.close()
})

test('the buttons of the agents tile keep keyboard focus as the story moves on', { skip }, async () => {
	const { page, problems } = await open()
	await page.evaluate(() => document.getElementById('agents-tile').scrollIntoView())
	await until(() => page.$('#play'), 'the start button')
	await page.focus('#play')
	await page.keyboard.press('Enter')
	await until(() => page.$('#allow'), 'the permission question')
	assert.equal(await page.evaluate(() => document.activeElement?.id), 'allow', 'focus moved to the next button')
	await page.keyboard.press('Enter')
	await until(() => page.$('#review'), 'the end of the turn')
	assert.equal(await page.evaluate(() => document.activeElement?.id), 'review', 'focus moved to the next button')
	assert.deepEqual(problems, [])
	await page.close()
})

test('a keyboard user can skip the canvas and the dock', { skip }, async () => {
	const { page, problems } = await open()
	const canvas = await flowCanvas(page)
	await drawn(canvas)
	const links = await page.evaluate(() => [...document.querySelectorAll('.tile .skip')].map(a => `${a.textContent}>${a.getAttribute('href')}`))
	assert.deepEqual(links, ['Skip the canvas>#flow-tile-controls', 'Skip the dock>#agents-tile-controls', 'Skip the canvas>#changes-tile-controls'])
	await page.focus('#flow-tile .skip')
	await page.keyboard.press('Enter')
	assert.equal(await page.evaluate(() => document.activeElement?.id), 'flow-tile-controls', 'focus is at the tile controls, past the canvas')
	assert.deepEqual(problems, [])
	await page.close()
})

test('the harness map is the real scan of the demo project, with its one warning', { skip }, async () => {
	const { page, problems } = await open()
	const text = await page.evaluate(() => document.querySelector('#harness-root')?.innerText ?? '')
	for (const word of ['Instructions', 'Rules', 'Skills', 'Subagents', 'Hooks', 'MCP servers', 'CLAUDE.md', 'graphql-schema.md']) assert.ok(text.includes(word), `the map has ${word}`)
	assert.match(text, /matches no file in the project/, 'the rule that matches nothing is flagged')
	assert.ok(!/Batuhan|\/Users\/|\/home\/|[A-Za-z]:\\/.test(text), 'nothing of the machine that built it is in the map')
	assert.deepEqual(problems, [])
	await page.close()
})

test('what the demo cannot do is said where a visitor reaches for it', { skip }, async () => {
	const { page, problems } = await open()
	const canvas = await flowCanvas(page)
	await drawn(canvas)
	// Handing the flow to an agent is the app's; here the tile says so.
	await clickIn(canvas, 'Ask about this flow')
	await footHas(page, 'flow-tile', 'hands the flow to the agent')
	assert.deepEqual(problems, [])
	await page.close()
})

test('below desktop width the page shows the video and the harness map, and loads no canvas', { skip }, async () => {
	const { page, problems } = await open({ width: 390, height: 844, isMobile: true, hasTouch: true })
	assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.fallback')).display), 'block')
	assert.equal(await page.evaluate(() => !!document.querySelector('.tile')), false, 'no tile was mounted')
	assert.equal(page.frames().filter(f => f.parentFrame()).length, 0, 'no iframe was loaded')
	assert.ok((await page.evaluate(() => document.querySelector('#harness-root')?.innerText ?? '')).includes('Instructions'), 'the harness map is there')
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll')
	assert.deepEqual(problems, [])
	await page.close()
})
