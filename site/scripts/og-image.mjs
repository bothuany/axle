// The social card (og:image and twitter:image, 1200x630): the slogan over the real editor, from the hero loop's poster, on the
// site's dark stage and in its type. Headless Chrome, no window. Run it again when the poster or the slogan changes:
//   node scripts/og-image.mjs        (writes public/media/og.jpg, which is committed)
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { NAME } from '../src/brand.ts'

const at = p => fileURLToPath(new URL(p, import.meta.url))
const out = at('../public/media/og.jpg')
const b64 = p => readFileSync(at(p)).toString('base64')
const CHROMES = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean)
const chrome = CHROMES.find(p => existsSync(p))
if (!chrome) throw new Error('No Chrome found: set CHROME_PATH.')

const html = `<!doctype html><html><head><style>
@font-face { font-family: 'Instrument Sans'; font-weight: 400 700; src: url(data:font/woff2;base64,${b64('../node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2')}) format('woff2'); }
body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #0c1020; color: #e9ecf5; font-family: 'Instrument Sans', sans-serif; }
.text { position: absolute; left: 64px; top: 58px; width: 1080px; }
h1 { margin: 0; font-size: 54px; line-height: 1.06; font-weight: 650; letter-spacing: -0.012em; }
h1 b { color: #9aa8ff; font-weight: inherit; }
p { margin: 18px 0 0; font-size: 24px; color: #a9b1c9; }
.window { position: absolute; left: 64px; right: 64px; top: 262px; height: 420px; border-radius: 12px; overflow: hidden; box-shadow: 0 0 0 1px rgba(255,255,255,.12), 0 30px 70px -20px rgba(0,0,0,.7); }
.window img { display: block; width: 100%; }
</style></head><body>
<div class="text"><h1>Every code editor shows your files.<br><b>${NAME}</b> shows how your code runs.</h1><p>A free, open-source code editor built on VS Code.</p></div>
<div class="window"><img src="data:image/webp;base64,${b64('../public/media/hero-loop-poster.webp')}"></div>
</body></html>`

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-first-run', '--disable-gpu'] })
const page = await browser.newPage()
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 })
await page.setContent(html, { waitUntil: 'load' })
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: out, type: 'jpeg', quality: 86 })
await browser.close()
console.log(out)
