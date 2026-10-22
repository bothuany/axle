// The endpoint beat from Insilode's own side bar (run "Insilode: Focus on Endpoints View" first, OrderController.java
// open, panel hidden): expands the Endpoints view's groups, hovers POST /orders (OrderController.place) so the view
// highlights it (B1-sidebar), and clicks it, which opens the flow tab (B2-sidebar). Then b3.js expands the hops (B3-sidebar).
let view = null
for (const f of p.frames()) { try { if (/9 endpoints/.test(await f.evaluate(() => document.body?.innerText ?? ''))) view = f } catch { } }
const off = await p.evaluate(() => { const r = [...document.querySelectorAll('iframe.webview')].map(f => f.getBoundingClientRect()).find(r => r.width > 100 && r.left < 100); return r && { x: r.left, y: r.top } })
const rect = () => view.evaluate(() => { const e = [...document.querySelectorAll('[title]')].find(e => e.getAttribute('title').startsWith('POST /orders' + String.fromCharCode(10)));const r = e?.getBoundingClientRect(); return r && r.height > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null })
let b = await rect()
if (!b) {
	for (const g of ['main', 'Order', 'OrderEvents', 'tasks']) {
		const el = view.getByText(g, { exact: true }).first()
		await el.click({ timeout: 3000 }).catch(() => {}); await sleep(300)
	}
	await sleep(600)
	b = await rect()
}
await p.mouse.move(off.x + b.x + 60, off.y + b.y + b.height / 2, { steps: 12 }); await sleep(800)
await shot('B1-sidebar')
const at = { x: off.x + b.x + 60, y: off.y + b.y + b.height / 2 }
await p.mouse.click(at.x, at.y); await sleep(9000)
// The pointer stays where the click was, as a person's would.
await shot('B2-sidebar')
return { off, b, at }
