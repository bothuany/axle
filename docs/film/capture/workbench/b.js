const rows = () => p.evaluate(() => [...document.querySelectorAll('.quick-input-list .monaco-list-row')].map(r => r.getAttribute('aria-label') ?? ''))
const run = async (title, wait = 1500) => {
	await p.keyboard.press('Escape'); await sleep(200)
	await p.keyboard.press('F1'); await sleep(600)
	await p.keyboard.insertText(title); await sleep(1000)
	const i = (await rows()).findIndex(r => r.startsWith(title))
	for (let k = 0; k < i; k++) await p.keyboard.press('ArrowDown')
	await p.keyboard.press('Enter'); await sleep(wait)
}
const away = () => p.mouse.move(1100, 20)
await run('View: Close All Editors')
await p.keyboard.press('F1'); await sleep(600); await p.keyboard.press('Backspace')
await p.keyboard.insertText('OrderController.java'); await sleep(1500); await p.keyboard.press('Enter'); await sleep(2000)
await run('View: Hide Panel', 800)
await run('Insilode: Open Endpoint Flow', 2500)
for (let i = 0; i < 3; i++) { await p.keyboard.press('ArrowDown'); await sleep(150) }
await away(); await sleep(500)
await shot('B1-endpoints')
await p.keyboard.press('Enter'); await sleep(9000)
await away(); await shot('B2-flow')
return 'ok'
