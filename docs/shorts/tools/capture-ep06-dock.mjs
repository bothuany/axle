// Stills of the app's own Agents dock page and status island page (headless Chrome, no window, no focus) on the site's Try page:
// three agents at work on the demo project, Codex waiting for an approval on top. Used by episode 06 (the agent that waited).
//   node tools/capture-ep06-dock.mjs <built site base url, e.g. http://127.0.0.1:4181/> <out dir>
// Needs puppeteer-core: it is the site's dev dependency (SITE_MODULES names its node_modules when this clone has none).
// Then pads them onto the 3840 x 2160 window every capture uses (R1-dock-needs, R2-dock-allowed, R3-island-needs, R4-island-allowed; run
// node tools/setup.mjs <out dir> to turn them into the captures the templates read) and cuts the four pets the episode draws with into
// assets/pets (bunny-wait, bunny-work, cat-work, cat-done: the avatars as the dock draws each state, enlarged without smoothing).
// Writes dock-needs.png, island-needs.png (before the answer), dock-allowed.png, island-allowed.png (after "Allow"), each
// as the page draws it at 3x, with the pixel pets switched on (the app's `flow.agents.avatar` setting).
import { existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [base, out] = process.argv.slice(2)
if (!out) throw new Error('usage: node tools/capture-ep06-dock.mjs <site base url> <out dir>')
mkdirSync(out, { recursive: true })
const modules = process.env.SITE_MODULES ?? join(here, '..', '..', 'site', 'node_modules')
const puppeteer = createRequire(join(modules, 'x.js'))('puppeteer-core')
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync)
if (!chrome) throw new Error('No Chrome found: set CHROME_PATH.')
const AGE_MIN = Number(process.env.AGE_MIN ?? 45)
const wait = ms => new Promise(r => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-first-run', '--disable-gpu', '--no-sandbox'] })
const p = await b.newPage()
await p.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 3 })
await p.goto(new URL('try/', base).href, { waitUntil: 'networkidle0' })
await p.waitForSelector('iframe.dock')
await wait(3000)
// Lay the two real pages out on their own, as the dock take of the launch film does.
await p.addStyleTag({ content: `
	body * { visibility: hidden !important; }
	iframe.dock, iframe.island { visibility: visible !important; position: fixed !important; z-index: 99999; transform: none !important; margin: 0 !important; }
	iframe.dock { left: 0 !important; top: 0 !important; width: 400px !important; height: 560px !important; }
	iframe.island { left: 440px !important; top: 24px !important; }
	html, body { background: #0f0f0f !important; }` })
// The demo moment, aged: the page's agents start "2m" into a wait. The story needs the wait to be 47 minutes, so the page's
// clock is moved forward 45 minutes after the sessions exist (every age on the page moves with it: 47m, 49m, 52m). The
// page, the rows and the ranking are the app's own; only the clock is ours, and the episode's description says so.
// The two pages tell their own time, so the page and both frames get it.
await Promise.all(p.frames().map(f => f.evaluate(min => { const real = Date.now.bind(Date); Date.now = () => real() + min * 60000 }, AGE_MIN)))
await p.evaluate(() => { const r = document.querySelector('input[name="avatar"][value="pixel"]'); r.checked = true; r.dispatchEvent(new Event('change')) })
await wait(1500)
const shot = async (sel, name) => (await p.$(sel)).screenshot({ path: join(out, name) })
await shot('iframe.dock', 'dock-needs.png')
await shot('iframe.island', 'island-needs.png')
await p.evaluate(() => document.querySelector('[data-allow]').click())
await wait(2500)
await shot('iframe.dock', 'dock-allowed.png')
await shot('iframe.island', 'island-allowed.png')
await b.close()

const ff = (...a) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...a], { stdio: 'inherit' }); if (r.status) throw new Error('ffmpeg failed: ' + a.join(' ')) }
const pad = (from, name, w, h) => ff('-i', join(out, from), '-vf', `scale=${w}:${h}:flags=lanczos,pad=3840:2160:(ow-iw)/2:(oh-ih)/2:color=0x0f0f0f`, '-frames:v', '1', join(out, name))
pad('dock-needs.png', 'R1-dock-needs.png', 1543, 2160)
pad('dock-allowed.png', 'R2-dock-allowed.png', 1543, 2160)
pad('island-needs.png', 'R3-island-needs.png', 3600, 486)
pad('island-allowed.png', 'R4-island-allowed.png', 3600, 486)
mkdirSync(join(here, 'assets', 'pets'), { recursive: true })
// The avatar of a row is an 84 px square at 3x in the 1200 px dock still (rows at y 154, 556, 1218 before the answer, 820 after it).
const pet = (from, name, x, y) => ff('-i', join(out, from), '-vf', `crop=84:84:${x}:${y},scale=336:336:flags=neighbor`, '-frames:v', '1', join(here, 'assets', 'pets', name + '.png'))
pet('dock-needs.png', 'bunny-wait', 60, 154)
pet('dock-needs.png', 'cat-done', 60, 556)
pet('dock-needs.png', 'cat-work', 60, 1218)
pet('dock-allowed.png', 'bunny-work', 60, 820)
console.log('wrote stills to', out)
