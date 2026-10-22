// The agent beats (C, D, E), after the agent's commit is on main: the commit in the terminal, "Show Git Changes in
// Flow" on the last commit, the change set panned to POST /orders, then the Harness map beside CLAUDE.md.
const rows = () => p.evaluate(() => [...document.querySelectorAll('.quick-input-list .monaco-list-row')].map(r => r.getAttribute('aria-label') ?? ''))
const run = async (title, wait = 1500) => {
	await p.keyboard.press('Escape'); await sleep(200)
	await p.keyboard.press('F1'); await sleep(600)
	await p.keyboard.insertText(title); await sleep(1000)
	const i = (await rows()).findIndex(r => r.startsWith(title))
	for (let k = 0; k < i; k++) await p.keyboard.press('ArrowDown')
	await p.keyboard.press('Enter'); await sleep(wait)
}
const themed = () => p.evaluate(() => document.querySelector('.monaco-workbench').classList.contains('flow-flow-theme-themes-flow-dark-json'))
const snap = async name => { if (!(await themed())) throw new Error('not Insilode Dark at ' + name); await p.mouse.move(1000, 1060); await sleep(500); await shot(name) }
const open = async file => { await p.keyboard.press('F1'); await sleep(600); await p.keyboard.press('Backspace'); await p.keyboard.insertText(file); await sleep(1500); await p.keyboard.press('Enter'); await sleep(2500) }
const panelShown = () => p.evaluate(() => (document.querySelector('.part.panel')?.offsetHeight ?? 0) > 0)
await run('View: Close All Editors')
await run('View: Show Explorer')
await open('OrderService.java')
await run('File: Reveal Active File in Explorer View')
if (!(await panelShown())) await run('View: Toggle Panel Visibility', 800)
await run('Terminal: Kill All Terminals', 800)
await run('Terminal: Create New Terminal', 4000)
await p.keyboard.insertText('git log -1 --shortstat --format="%h %an: %s"\r'); await sleep(1500)
await run('View: Focus Active Editor Group', 800)
await snap('C1-commit')
await run('Insilode: Show Git Changes in Flow', 1500)
const j = (await rows()).findIndex(r => r.startsWith('Last commit'))
for (let k = 0; k < j; k++) { await p.keyboard.press('ArrowDown'); await sleep(120) }
await snap('C2-pick')
await p.keyboard.press('Enter'); await sleep(10000)
if (await panelShown()) await run('View: Toggle Panel Visibility', 1500)
await snap('C3-changes')
// Pan to the POST /orders flow: drag the canvas pane until OrderController.place sits near the top left.
const fr = p.frames().filter(f => f.url().includes('webview')).at(-1)
const where = () => fr.evaluate(() => { const el = [...document.querySelectorAll('.react-flow__node')].find(e => e.innerText.startsWith('OrderController.place')); const r = el?.getBoundingClientRect(); return r && { x: r.left, y: r.top } })
for (let n = 0; n < 8; n++) {
	const at = await where()
	if (!at || (Math.abs(at.y - 120) < 40 && Math.abs(at.x - 150) < 60)) break
	const dy = Math.max(-800, Math.min(800, at.y - 120)), dx = Math.max(-600, Math.min(600, at.x - 150))
	await p.mouse.move(1300, 950); await p.mouse.down(); await p.mouse.move(1300 - dx, 950 - dy, { steps: 20 }); await p.mouse.up(); await sleep(500)
}
await snap('C4-place')
const placed = await where()
await snap('D-base')
await open('CLAUDE.md')
await run('Harness: Focus on Map View', 4000)
await snap('E-harness')
return placed
