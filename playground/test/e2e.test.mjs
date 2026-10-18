// The playground in a real browser (headless Chrome): the whole loop a visitor goes through, and the paths around it. Run after
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
const term = page => page.evaluate(() => document.querySelector('.xterm-rows')?.textContent ?? '')
const termHas = (page, needle) => until(async () => (await term(page)).includes(needle), `the terminal to show "${needle}"`)
const canvas = page => frame(page, 'canvas.html')
const canvasText = page => canvas(page).evaluate(() => document.body.innerText)
const activity = (page, label) => page.evaluate(l => [...document.querySelectorAll('.act')].find(a => a.getAttribute('aria-label')?.startsWith(l))?.click(), label)

test('the workbench opens on a flow, with the dock, the editor and the explorer', { skip }, async () => {
	const { page, problems } = await open()
	await until(() => canvas(page)?.evaluate(() => !!document.querySelector('.react-flow__node')), 'the canvas to draw a card')
	assert.match(await canvasText(page), /OrderController\.place/)
	const dock = frame(page, 'dock.html')
	assert.ok(await dock.evaluate(() => /No agents running/.test(document.body.innerText)), 'the dock says no agents run')
	assert.ok(await page.evaluate(() => !!document.querySelector('.tab.on')), 'a code tab is open')
	assert.deepEqual(problems, [])
	await page.close()
})

test('the whole loop: start Claude, answer its question, see what it touched, follow it onto the canvas', { skip }, async () => {
	const { page, problems } = await open()
	await page.click('#try')
	await termHas(page, 'Do you want to make this edit to')
	// The dock, the overlay and the files all say the agent waits for you.
	const dock = frame(page, 'dock.html')
	await until(() => dock.evaluate(() => /APPROVAL|Approval/.test(document.body.innerText) && /Wants to: Editing Order\.java/.test(document.body.innerText)), 'the dock to show the approval')
	const island = frame(page, 'island.html')
	await until(() => island.evaluate(() => /Needs approval/.test(document.body.innerText)), 'the overlay to say "Needs approval"')
	assert.equal(await page.evaluate(() => document.querySelector('.island').style.visibility), 'visible')
	// Answer both edits in the terminal, as a visitor does.
	await page.click('.xterm-helper-textarea')
	await page.keyboard.press('1')
	await termHas(page, 'OrderService.java?')
	await page.keyboard.press('1')
	await termHas(page, 'Done. An order can carry')
	// What it touched: the dock lists the flows and the table, the explorer marks the files, source control counts them.
	await until(() => dock.evaluate(() => /This turn touched 4 flows and table orders \(4 endpoints\)/.test(document.body.innerText)), 'the dock to list what the turn touched')
	await until(() => island.evaluate(() => /Done/.test(document.body.innerText)), 'the overlay to say Done')
	assert.equal(await page.evaluate(() => [...document.querySelectorAll('.row.m')].length > 0), true, 'the explorer marks changed files')
	assert.equal(await page.evaluate(() => document.querySelector('[aria-label^="Source Control"] .badge')?.textContent), '2', 'source control counts the two changed files')
	// Follow a flow chip from the dock: the canvas draws it with the change on its cards.
	await dock.evaluate(() => [...document.querySelectorAll('.flow')].find(c => c.textContent === 'POST /orders').click())
	await until(async () => /Review 2 changes/.test(await canvasText(page)), 'the canvas to offer "Review 2 changes"')
	assert.deepEqual(problems, [])
	await page.close()
})

test('Keep clears the marks on the canvas; Undo puts the files back', { skip }, async () => {
	const { page, problems } = await open()
	await page.click('#try')
	await page.click('.xterm-helper-textarea')
	await termHas(page, 'Do you want to make this edit to')
	await page.keyboard.press('2') // allow all edits for the session
	await termHas(page, 'Done. An order can carry')
	const dock = frame(page, 'dock.html')
	await until(() => dock.evaluate(() => document.querySelector('.flow')), 'the dock chips')
	await dock.evaluate(() => [...document.querySelectorAll('.flow')].find(c => c.textContent === 'POST /orders').click())
	await until(async () => /Review 2 changes/.test(await canvasText(page)), 'the change on the canvas')
	// Undo on a changed card.
	await canvas(page).evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Undo').click())
	await until(async () => !/Review 2 changes/.test(await canvasText(page)), 'the canvas to forget the change')
	assert.equal(await page.evaluate(() => [...document.querySelectorAll('.row.m')].length), 0, 'the explorer no longer marks files')
	assert.equal(await page.evaluate(() => !!document.querySelector('[aria-label^="Source Control"] .badge')), false, 'source control has no changes')
	assert.deepEqual(problems, [])
	await page.close()
})

test('the harness map is the real scan of the demo project, with its one warning', { skip }, async () => {
	const { page, problems } = await open()
	await activity(page, 'Harness')
	const text = await until(async () => {
		const t = await page.evaluate(() => document.querySelector('.sidebar')?.innerText ?? '')
		return /Health \d+/.test(t) ? t : ''
	}, 'the harness map')
	for (const word of ['Instructions', 'Rules', 'Skills', 'Subagents', 'Hooks', 'MCP servers', 'Permission rules', 'Permission requests', 'Friction inbox']) assert.ok(text.includes(word), `the map has ${word}`)
	assert.match(text, /matches no file in the project/, 'the rule that matches nothing is flagged')
	assert.ok(!/Batuhan|\/Users\/|C:\\\\/.test(text), 'nothing of the machine that built it is in the map')
	assert.deepEqual(problems, [])
	await page.close()
})

test('the shell terminal knows a few commands and says so for the rest', { skip }, async () => {
	const { page, problems } = await open()
	await page.click('.xterm-helper-textarea')
	await page.keyboard.type('git status')
	await page.keyboard.press('Enter')
	await termHas(page, 'nothing to commit, working tree clean')
	await page.keyboard.type('whoami')
	await page.keyboard.press('Enter')
	await termHas(page, 'zsh: command not found: whoami')
	assert.deepEqual(problems, [])
	await page.close()
})

test('a card of the canvas opens its editor, as in the app', { skip }, async () => {
	const { page, problems } = await open()
	await until(() => canvas(page)?.evaluate(() => !!document.querySelector('.react-flow__node')), 'the canvas')
	// A line of a card opens its editor; saving says why nothing is written.
	await canvas(page).evaluate(() => document.querySelector('.react-flow__node .ln .src')?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 })))
	await until(() => canvas(page).evaluate(() => !!document.querySelector('.monaco-editor')), 'the card editor')
	assert.deepEqual(problems, [])
	await page.close()
})

test('below desktop width the page shows the video and loads no canvas', { skip }, async () => {
	const { page, problems } = await open({ width: 390, height: 844, isMobile: true, hasTouch: true })
	assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.stagewrap')).display), 'none')
	assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.fallback')).display), 'block')
	assert.equal(page.frames().filter(f => f.parentFrame() && f.url().includes('canvas.html')).length, 0, 'no canvas was loaded')
	assert.deepEqual(problems, [])
	await page.close()
})
