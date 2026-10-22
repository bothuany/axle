// After c4b.js: C4 and the dock base with the Explorer and no CLAUDE.md tab, then E (the Harness map beside CLAUDE.md).
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
const tab = t => p.locator('.tab', { hasText: t }).first()
if (await tab('CLAUDE.md').count()) { await tab('CLAUDE.md').click(); await sleep(500); await run('View: Close Editor', 800) }
await run('View: Show Explorer', 800)
await tab('Flow: Changes').click(); await sleep(1500)
await snap('C4-place')
await snap('D-base')
await p.keyboard.press('F1'); await sleep(600); await p.keyboard.press('Backspace'); await p.keyboard.insertText('CLAUDE.md'); await sleep(1500); await p.keyboard.press('Enter'); await sleep(2500)
await run('Harness: Focus on Map View', 4000)
await snap('E-harness')
return 'ok'
