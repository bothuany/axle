// Renders storyboard.html headless: the whole sheet, and each #frame-NN cell as a 1920x1080 PNG.
//   node snap-storyboard.mjs [outDir]   (default: storyboard/ next to the page, which git ignores)
// Needs playwright; run it where that resolves. Stills stay out of the repo.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = process.argv[2] ?? join(root, 'storyboard')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const url = pathToFileURL(join(root, 'storyboard.html')).href

const sheet = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
await sheet.goto(url)
await sheet.evaluate(() => document.fonts.ready)
await sheet.screenshot({ path: join(out, 'sheet.png'), fullPage: true })

// Each cell is ~600 css px wide at this viewport; scale so the cell comes out 1920 px wide.
const width = await sheet.$eval('#frame-01', el => el.getBoundingClientRect().width)
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1920 / width })
await page.goto(url)
await page.evaluate(() => document.fonts.ready)
for (const el of await page.$$('[id^="frame-"]')) {
	const id = await el.getAttribute('id')
	await el.screenshot({ path: join(out, `${id}.png`) })
}
await browser.close()
console.log('wrote', out)
