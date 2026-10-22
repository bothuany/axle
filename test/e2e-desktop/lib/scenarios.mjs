// The scenarios that run against a started Insilode (an installed build, or a source checkout). Each returns
// `{ status: 'pass' | 'skip', detail, shots }` or throws; run.mjs records it, retrying a throw once from a fresh app.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { until, sleep } from './app.mjs'
import { movePointer } from './pointer.mjs'
import { dismissWelcome, findCanvas, runCommand, shot, tabTitles, welcomeDialog } from './ui.mjs'

const pass = (detail, shots = []) => ({ status: 'pass', detail, shots })

/** The tour the canvas scenario plays: an endpoint of the demo project, two steps. */
export function tourFile(folder) {
	const file = join(folder, 'e2e.tour.json')
	writeFileSync(file, JSON.stringify({
		insilodeTour: 1,
		id: 'e2e',
		title: 'E2E tour',
		flow: { http: 'POST /api/orders' },
		steps: [
			{ title: 'The route', caption: 'This route creates an order.', file: 'server/app.js', line: 7 },
			{ title: 'The handler', caption: 'The handler validates and stores it.', file: 'server/orders.js', line: 52 },
		],
	}, null, 2))
	return file
}

/** Branding and onboarding: the window says Insilode, nothing says Code - OSS, and no Welcome or Get Started page opened itself. */
export async function branding(ctx) {
	const page = await ctx.app.workbench()
	// flow-theme's default window.title is "${rootName} - ${activeEditorShort}", without the app name: the title says
	// "Insilode" only until that default applies, so it cannot show the branding. The product the window was started with can.
	const product = await until('the product name', () => page.evaluate(() => {
		const p = globalThis.vscode?.context?.configuration?.()?.product
		return p && `${p.nameLong} (${p.nameShort})`
	}), { ms: 30000 })
	if (!/Insilode/.test(product) || /Code - OSS|Visual Studio Code/.test(product)) {
		throw new Error(`The window runs as "${product}", not as Insilode`)
	}
	await until('a window title', async () => (await page.title()).trim(), { ms: 30000 })
	const title = await page.title()
	if (/Code - OSS|Visual Studio Code/.test(title)) {
		throw new Error(`The window title still carries another product's name: "${title}"`)
	}
	// Give a startup editor time to open itself before asserting that none did.
	await sleep(3000)
	const tabs = await tabTitles(page)
	const picture = await shot(page, ctx.results, 'branding')
	if (await welcomeDialog(page)) {
		throw new Error(`VS Code's first-run Welcome dialog ("Welcome to VS Code", sign in to use GitHub Copilot) opens over Insilode: ${picture}`)
	}
	const onboarding = tabs.filter(t => /welcome|get started|walkthrough/i.test(t))
	if (onboarding.length || await page.locator('.gettingStartedContainer').count()) {
		throw new Error(`VS Code's onboarding opened: ${onboarding.join(', ') || 'the Get Started page'}`)
	}
	return pass(`${product}, title "${title}", tabs: ${tabs.length ? tabs.join(' | ') : 'none'}`, [picture])
}

/** The flow canvas opens (as an editor tab where this build does that) and a tour plays on it. */
export async function canvasTour(ctx) {
	const page = await ctx.app.workbench()
	await dismissWelcome(page)
	const file = tourFile(ctx.folder)
	// The command exists once the extension has started and the flow needs the code index: until then it fails quietly, so ask again
	// (each attempt is the whole gesture: palette, pick the file) until a flow tab is there.
	await until('a flow tab after "Play Tour from File"', async () => {
		if ((await tabTitles(page)).some(t => /^Flow:/.test(t))) {
			return true
		}
		await runCommand(page, 'Insilode: Play Tour from File').catch(() => page.keyboard.press('Escape'))
		// The picker lists the tour file we wrote; the palette's own rows must not be taken for it.
		const row = page.locator('.quick-input-list .monaco-list-row', { hasText: 'e2e.tour.json' })
		if (await row.first().waitFor({ timeout: 6000 }).then(() => true, () => false)) {
			await row.first().click()
		} else {
			await page.keyboard.press('Escape')
		}
		await sleep(8000)
		return (await tabTitles(page)).some(t => /^Flow:/.test(t))
	}, { ms: 120000, every: 2000 })
	const canvas = await until('the flow canvas', () => findCanvas(page), { ms: 90000, every: 1000 })
	await until('a card on the canvas', async () => (await canvas.locator('.react-flow__node').count()) > 0, { ms: 60000, every: 1000 })
	const caption = await until('the tour caption', async () => {
		const el = canvas.locator('.tour-caption-text').first()
		return (await el.count()) && (await el.innerText())
	}, { ms: 60000, every: 1000 })
	if (!/creates an order/.test(caption)) {
		throw new Error(`The first tour step says "${caption}", not the first step of ${file}`)
	}
	const tabs = await tabTitles(page)
	const asTab = tabs.some(t => /flow|tour|orders/i.test(t))
	return pass(`${asTab ? 'canvas opened as an editor tab' : 'canvas opened beside the editor (not an editor tab in this build)'}; caption: "${caption.slice(0, 60)}"`, [await shot(page, ctx.results, 'canvas-tour')])
}

const OVERLAY_TITLE = 'Insilode Agents'
const overlayInfo = ctx => ctx.app.main(({ BrowserWindow }, title) => {
	const w = BrowserWindow.getAllWindows().find(x => x.getTitle() === title && !x.isDestroyed())
	return w ? { visible: w.isVisible(), bounds: w.getBounds() } : null
}, OVERLAY_TITLE)

async function saveOverlayShot(ctx, overlay, name) {
	const file = `shots/${ctx.results.label}-${name}.png`
	await overlay.screenshot({ path: join(ctx.results.out, file) })
	return file
}

/** The status island: it appears with the fake agents, and (where this build has the controls) minimizes, drags, closes and hides while Insilode is focused. */
export async function island(ctx) {
	const page = await ctx.app.workbench()
	await dismissWelcome(page)
	const steps = []
	const shots = []
	const direct = ctx.app.mode === '_electron'
	const shown = await until('the status island', async () => {
		if (direct) {
			const info = await overlayInfo(ctx)
			return info?.visible && info
		}
		return ctx.app.overlayPage() && {}
	}, { ms: 60000, every: 500 })
	const overlay = await until('the island page', () => ctx.app.overlayPage(), { ms: 15000 })
	await overlay.waitForSelector('.box', { timeout: 15000 })
	steps.push(`shown${shown.bounds ? ` at ${shown.bounds.x},${shown.bounds.y} (${shown.bounds.width}x${shown.bounds.height})` : ''}`)
	shots.push(await saveOverlayShot(ctx, overlay, 'island'))

	// The controls arrive with the island controls change; a build without them still has to show the island.
	await overlay.hover('.box').catch(() => undefined)
	if (!await overlay.locator('button[title="Minimize"]').count()) {
		return pass(`${steps.join(', ')}; minimize, drag, close and hide-while-focused are not in this build`, shots)
	}

	// Minimize, then expand again.
	await overlay.locator('button[title="Minimize"]').click()
	await until('the island to minimize', async () => (await overlay.locator('.box.mini').count()) > 0, { ms: 10000 })
	shots.push(await saveOverlayShot(ctx, overlay, 'island-minimized'))
	await overlay.locator('.box.mini').click()
	await until('the island to open again', async () => (await overlay.locator('.box.mini').count()) === 0, { ms: 10000 })
	steps.push('minimized and expanded')

	// Drag: the main process reads the real pointer, so the real pointer moves (this machine is isolated).
	if (direct) {
		const before = (await overlayInfo(ctx)).bounds
		const [sx, sy] = [before.x + before.width / 2, before.y + before.height / 2]
		if (movePointer(sx, sy)) {
			// movePointer just put the real cursor on the island: its mouseenter makes the page build .box again (as the list)
			// while the window resizes to it, so for a moment there is no box on screen and boundingBox() answers null. A race
			// of this test, not of the app: wait for the new box.
			const box = await until('the island on screen', () => overlay.locator('.box').boundingBox({ timeout: 1000 }), { ms: 10000, every: 100 })
			const [px, py] = [box.x + box.width / 2, box.y + box.height / 2]
			// The island follows the pointer, so in the page's own coordinates the pointer stays where it is while the real cursor moves.
			await overlay.mouse.move(px, py)
			await overlay.mouse.down()
			for (let i = 1; i <= 8; i++) {
				movePointer(sx + i * 20, sy + i * 12)
				await overlay.mouse.move(px + (i % 2), py)
				await sleep(60)
			}
			await overlay.mouse.move(px, py)
			await overlay.mouse.up()
			await sleep(500)
			const after = (await overlayInfo(ctx)).bounds
			if (after.x === before.x && after.y === before.y) {
				throw new Error(`The island did not move when dragged (still at ${after.x},${after.y})`)
			}
			steps.push(`dragged by ${after.x - before.x},${after.y - before.y}`)
		} else {
			steps.push('drag skipped (this machine cannot move the pointer)')
		}
	}

	// Hidden while Insilode is focused: the setting is live, and a window has to be focused for real.
	if (direct) {
		ctx.setSettings({ 'flow.agents.desktop.overlay.autoHide': { noAgents: true, insilodeFocused: true } })
		const focused = await ctx.app.main(({ BrowserWindow }, title) => {
			BrowserWindow.getAllWindows().find(x => x.getTitle() !== title && !x.isDestroyed())?.focus()
			return !!BrowserWindow.getFocusedWindow()
		}, OVERLAY_TITLE)
		if (focused) {
			await until('the island to hide while Insilode is focused', async () => !(await overlayInfo(ctx))?.visible, { ms: 15000 })
			steps.push('hidden while focused')
		} else {
			steps.push('hide-while-focused skipped (this OS gave the window no focus)')
		}
		// VS Code can miss a settings file written right after the last write: let that one land, and write again while waiting.
		await sleep(3000)
		let n = 0
		await until('the island to come back', async () => {
			ctx.setSettings({ 'flow.agents.desktop.overlay.autoHide': { noAgents: true, insilodeFocused: false }, 'flow.e2e.nonce': ++n })
			await sleep(2000)
			return (await overlayInfo(ctx))?.visible
		}, { ms: 40000, every: 500 })
	}

	// Close: the x turns the island off in the settings.
	await overlay.hover('.box').catch(() => undefined)
	await overlay.locator('button[title^="Close"]').click()
	await until('the island to close', async () => direct ? !(await overlayInfo(ctx))?.visible : !ctx.app.overlayPage(), { ms: 20000 })
	steps.push('closed')
	shots.push(await shot(page, ctx.results, 'after-island-close'))
	return pass(steps.join(', '), shots)
}

export const APP_SCENARIOS = [
	{ id: 'branding', title: 'Starts with Insilode branding, no VS Code onboarding', run: branding },
	{ id: 'canvas-tour', title: 'Flow canvas opens and a tour plays', run: canvasTour },
	{ id: 'island', title: 'Status island: shows, minimizes, drags, hides, closes', run: island },
]
