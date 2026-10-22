// Expands the cross-service hops on the flow (the HTTP call into billing, the Kafka topic into shipping), then fits.
const canvas = p.frames().find(f => f.url().includes('webview') && f.childFrames().length === 0 && f.parentFrame()?.url().includes('webview'))
const fr = p.frames().filter(f => f.url().includes('webview')).at(-1)
const res = []
for (const label of ['create_invoice', 'onOrderPlaced']) {
	const chip = fr.getByText(label, { exact: false }).first()
	try { await chip.click({ timeout: 3000 }); res.push('clicked ' + label); await sleep(2500) } catch (e) { res.push('miss ' + label + ' ' + e.message.slice(0, 80)) }
}
await fr.locator('.react-flow__controls-fitview').click().catch(e => res.push('nofit'))
await sleep(1500)
await p.mouse.move(1750, 800)
await shot('B3-sidebar')
return res
