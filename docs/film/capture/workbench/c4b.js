// Brings the POST /orders flow of the change set into view: zoom out, zoom back in on OrderController.place, then
// drag the empty pane (never a card, which would select its text) until the card sits near the top left.
const fr = p.frames().filter(f => f.url().includes('webview')).at(-1)
const off = await p.evaluate(() => { const r = [...document.querySelectorAll('iframe.webview')].map(f => f.getBoundingClientRect()).find(r => r.width > 500); return { x: r.left, y: r.top } })
const inner = await fr.evaluate(() => ({ w: innerWidth, h: innerHeight }))
// The canvas frame may sit below a toolbar inside the webview: measure the pane's offset in the outer frame.
const where = () => fr.evaluate(() => { const el = [...document.querySelectorAll('.react-flow__node')].find(e => e.innerText.startsWith('OrderController.place')); const r = el?.getBoundingClientRect(); return r && { x: r.left, y: r.top } })
await fr.evaluate(() => getSelection()?.removeAllRanges())
await p.mouse.move(off.x + 600, off.y + 500); await p.mouse.wheel(0, 3000); await sleep(1200)
let at = await where()
await p.mouse.move(off.x + at.x + 20, off.y + at.y + 10); await p.mouse.wheel(0, -3000); await sleep(1200)
const paneAt = (x, y) => fr.evaluate(([x, y]) => (document.elementFromPoint(x, y)?.className?.baseVal ?? document.elementFromPoint(x, y)?.className ?? '').includes('react-flow__pane'), [x, y])
const log = []
for (let n = 0; n < 8; n++) {
	at = await where()
	log.push([Math.round(at.x), Math.round(at.y)])
	const dx = at.x - 130, dy = at.y - 110
	if (Math.abs(dx) < 30 && Math.abs(dy) < 30) break
	// A start point on the empty pane, and room to move by (dx, dy).
	let s = null
	for (const [x, y] of [[700, 700], [900, 500], [400, 800], [1100, 800], [600, 300], [1200, 300], [300, 600]]) if (await paneAt(x, y)) { s = [x, y]; break }
	if (!s) { log.push('no pane'); break }
	const mx = Math.max(-500, Math.min(500, dx)), my = Math.max(-500, Math.min(500, dy))
	await p.mouse.move(off.x + s[0], off.y + s[1]); await p.mouse.down(); await p.mouse.move(off.x + s[0] - mx, off.y + s[1] - my, { steps: 15 }); await p.mouse.up(); await sleep(400)
}
await fr.evaluate(() => getSelection()?.removeAllRanges())
await p.mouse.move(1000, 1060); await sleep(500)
await shot('C4-place')
return { off, inner, log }
