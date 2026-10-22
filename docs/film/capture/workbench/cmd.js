// Runs a palette command by exact title prefix, then optionally types into the next pick and accepts it.
// Set globalThis.CMD and globalThis.PICK before (this file is prefixed by a line that sets them).
const runCmd = async (title, pick) => {
	await p.keyboard.press('Escape'); await sleep(200)
	await p.keyboard.press('F1'); await sleep(700)
	await p.keyboard.insertText(title); await sleep(1000)
	const r0 = await p.evaluate(() => [...document.querySelectorAll('.quick-input-list .monaco-list-row')].map(r => r.getAttribute('aria-label') ?? ''))
	const i = r0.findIndex(r => r.startsWith(title))
	if (i < 0) return { notFound: title, r0 }
	for (let k = 0; k < i; k++) await p.keyboard.press('ArrowDown')
	await p.keyboard.press('Enter'); await sleep(1200)
	if (pick) {
		await p.keyboard.insertText(pick); await sleep(900)
		const r1 = await p.evaluate(() => [...document.querySelectorAll('.quick-input-list .monaco-list-row')].map(r => r.getAttribute('aria-label') ?? ''))
		const j = r1.findIndex(r => r.startsWith(pick))
		for (let k = 0; k < Math.max(0, j); k++) await p.keyboard.press('ArrowDown')
		await p.keyboard.press('Enter'); await sleep(1500)
		return { ran: title, picked: r1[j] ?? r1 }
	}
	return { ran: title }
}
return await runCmd(CMD, PICK)
