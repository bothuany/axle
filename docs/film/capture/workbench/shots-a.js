// The editor beats (A, B1): the window as a developer meets it, the Extensions view on Open VSX, themes, keyboard
// shortcuts, then the endpoint picker. Runs in workbench-driver.mjs (p, shot, sleep in scope).
const rows = () => p.evaluate(() => [...document.querySelectorAll('.quick-input-list .monaco-list-row')].map(r => r.getAttribute('aria-label') ?? ''))
const run = async (title, wait = 1500) => {
	await p.keyboard.press('Escape'); await sleep(200)
	await p.keyboard.press('F1'); await sleep(600)
	await p.keyboard.insertText(title); await sleep(1000)
	const i = (await rows()).findIndex(r => r.startsWith(title))
	for (let k = 0; k < i; k++) await p.keyboard.press('ArrowDown')
	await p.keyboard.press('Enter'); await sleep(wait)
}
// Every still is in Insilode Dark: a reload can come up in the default dark theme before the theme extension loads.
const themed = () => p.evaluate(() => document.querySelector('.monaco-workbench').classList.contains('flow-flow-theme-themes-flow-dark-json'))
const snap = async name => { if (!(await themed())) throw new Error('not Insilode Dark at ' + name); await p.mouse.move(1000, 1060); await sleep(500); await shot(name) }
const open = async file => { await p.keyboard.press('F1'); await sleep(600); await p.keyboard.press('Backspace'); await p.keyboard.insertText(file); await sleep(1500); await p.keyboard.press('Enter'); await sleep(2500) }
await run('View: Close All Editors')
await run('View: Show Explorer')
await open('OrderController.java')
await run('File: Reveal Active File in Explorer View')
await run('View: Toggle Panel Visibility', 800)
if (!(await p.evaluate(() => !!document.querySelector('.part.panel:not(.hidden)')?.offsetHeight))) await run('View: Toggle Panel Visibility', 800)
await run('Terminal: Kill All Terminals', 800)
await run('Terminal: Create New Terminal', 4000)
await p.keyboard.insertText('git status\r'); await sleep(1500)
await run('View: Focus Active Editor Group', 800)
await snap('A1-editor')
await run('View: Show Extensions', 1500)
await p.locator('.extensions-viewlet .suggest-input-container').first().click()
await p.keyboard.press('Control+A'); await p.keyboard.insertText('@popular'); await sleep(7000)
await snap('A2-extensions')
await p.locator('.extensions-viewlet .suggest-input-container').first().click()
await p.keyboard.press('Control+A'); await p.keyboard.insertText('category:themes'); await sleep(7000)
await snap('A3-themes')
await run('Preferences: Open Keyboard Shortcuts,', 3000)
await snap('A4-keys')
await p.keyboard.press('Escape'); await sleep(300)
await run('View: Show Explorer', 800)
await run('View: Hide Panel', 800)
await run('Insilode: Open Endpoint Flow', 2500)
for (let i = 0; i < 3; i++) { await p.keyboard.press('ArrowDown'); await sleep(150) }
await snap('B1-endpoints')
const title = await p.evaluate(() => document.querySelector('.quick-input-title')?.innerText)
await p.keyboard.press('Escape')
return title
