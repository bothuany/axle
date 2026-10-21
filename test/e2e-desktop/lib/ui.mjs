// Small helpers for driving the workbench the way a person does: keyboard and clicks inside the page (Playwright sends them
// to the page itself, so nothing depends on which OS window has focus).
import { until } from './app.mjs'

/** Runs a command from the Command Palette by its title. */
export async function runCommand(page, title) {
	await page.keyboard.press('Control+Shift+P')
	const input = page.locator('.quick-input-widget .quick-input-box input')
	await input.waitFor({ state: 'visible', timeout: 15000 })
	await input.fill(`>${title}`)
	// The list filters as you type: wait until the row for this title is the first one.
	await until(`the command "${title}" in the palette`, async () => {
		const row = page.locator('.quick-input-list .monaco-list-row').first()
		return (await row.count()) && (await row.innerText()).toLowerCase().includes(title.toLowerCase().split('…')[0])
	}, { ms: 15000 })
	await page.keyboard.press('Enter')
}

/** Types a path into the file prompt a command shows (e.g. "Play Tour from File…"). */
export async function answerPrompt(page, text) {
	const input = page.locator('.quick-input-widget .quick-input-box input')
	await input.waitFor({ state: 'visible', timeout: 15000 })
	await input.fill(text)
	await page.keyboard.press('Enter')
}

/** Titles of the editor tabs that are open. */
export const tabTitles = page => page.locator('.editor-group-container .tabs-container .tab').evaluateAll(tabs => tabs.map(t => t.getAttribute('aria-label') || t.textContent || ''))

/** Every frame that holds a React Flow canvas: the webview nests it two iframes deep, and a probe must not depend on that. */
export async function findCanvas(page) {
	for (const frame of page.frames()) {
		if (frame === page.mainFrame()) {
			continue
		}
		try {
			if (await frame.locator('.react-flow').count()) {
				return frame
			}
		} catch {
			// a frame that navigates while we ask
		}
	}
	return undefined
}

export async function shot(page, results, name) {
	const file = `shots/${results.label}-${name}.png`
	await page.screenshot({ path: `${results.out}/${file}` })
	return file
}

const WELCOME = /Welcome to VS Code|Sign in to use GitHub Copilot/

/** Whether VS Code's first-run "Welcome" dialog (a Copilot sign-in) is on screen. */
export async function welcomeDialog(page) {
	return (await page.getByText(WELCOME).count()) > 0
}

/** Closes that dialog the way a person would, so a scenario that is not about onboarding can go on. Returns whether it was there. */
export async function dismissWelcome(page) {
	if (!await welcomeDialog(page)) {
		return false
	}
	for (let i = 0; i < 4 && await welcomeDialog(page); i++) {
		const skip = page.getByText(/^(Continue without Signing In|Skip|Next|Get Started|Finish|Done)$/i).first()
		if (await skip.count()) {
			await skip.click({ force: true }).catch(() => undefined)
		} else {
			await page.keyboard.press('Escape')
		}
		await page.waitForTimeout(800)
	}
	return true
}
