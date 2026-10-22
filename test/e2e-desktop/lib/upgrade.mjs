// The move from Axle (0.4.x and older) to Insilode, on a machine that is not yours (Windows Sandbox): an Axle Setup installs, the Insilode
// Setup runs over it, and what editor/patches says must hold: one install (the same folder, one uninstall entry), nothing named Axle left
// in it, and the first start copies Axle's settings. The old Setup is any Axle-Setup-*.exe (`--old-installer`); they all carry the one
// installer id that product.json keeps (win32x64UserAppId).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { sleep, until } from './app.mjs'

const MERGE_TASKS = '/MERGETASKS=!runcode,addcontextmenufolders'

/** Inno Setup's command line for a silent per-user install in the default folder, with the "Open with" entry for folders. */
export function upgradeArgs(log) {
	return ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', `/LOG=${log}`, MERGE_TASKS]
}

function run(exe, args, ms = 600000) {
	const r = spawnSync(exe, args, { timeout: ms, encoding: 'utf8', windowsHide: true })
	if (r.error) {
		throw new Error(`${exe} ${args[0]}: ${r.error.message}`)
	}
	return r
}

/** Best effort, after a failed step: stops the app and runs whatever uninstaller the install folder has. */
function uninstallLeftover(dir) {
	try {
		spawnSync('taskkill.exe', ['/F', '/T', '/IM', 'Insilode.exe'], { windowsHide: true })
		spawnSync('taskkill.exe', ['/F', '/T', '/IM', 'Axle.exe'], { windowsHide: true })
		const unins = existsSync(dir) ? readdirSync(dir).find(n => /^unins\d+\.exe$/i.test(n)) : undefined
		if (unins) {
			run(join(dir, unins), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], 120000)
		}
	} catch (e) {
		console.log(`  could not uninstall what the failed upgrade left in ${dir}: ${e.message}`)
	}
}

/** `reg query` of a key (a plain argument list, no shell): its text, or undefined when the key is not there. */
function reg(key) {
	const r = spawnSync('reg.exe', ['query', key], { encoding: 'utf8', windowsHide: true })
	return r.status === 0 ? r.stdout : undefined
}

/** The uninstall entries of this user that Inno Setup wrote (`<AppId>_is1`) and what they are called. */
export function uninstallEntries() {
	const root = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
	const keys = (reg(root) ?? '').split(/\r?\n/).map(l => l.trim()).filter(l => /_is1$/i.test(l))
	return keys.map(k => ({ key: k, name: /DisplayName\s+REG_SZ\s+(.*)/.exec(reg(k) ?? '')?.[1]?.trim() ?? '' }))
}

function find(dir, name, depth = 3) {
	if (!existsSync(dir) || depth < 0) {
		return false
	}
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) {
			return true
		}
		if (e.isDirectory() && find(join(dir, e.name), name, depth - 1)) {
			return true
		}
	}
	return false
}

export async function upgradeFromAxle({ oldSetup, setup, out }) {
	const notes = []
	const check = (ok, what) => {
		if (!ok) {
			throw new Error(`${what}\n${notes.join(' / ')}`)
		}
		notes.push(what)
	}
	const local = process.env.LOCALAPPDATA
	const roaming = process.env.APPDATA
	const programs = join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
	const dir = join(local, 'Programs', 'Axle')
	mkdirSync(out, { recursive: true })

	// A failed check in steps 1 to 3 leaves Axle or Insilode installed: it is uninstalled, so the scenarios after this one start
	// on a clean machine.
	try {
		// 1. Axle, installed the way a user did: the default folder, "Open with" for folders.
		const first = run(oldSetup, upgradeArgs(join(out, 'setup-axle.log')))
		check(first.status === 0 && existsSync(join(dir, 'Axle.exe')), `Axle's Setup installed Axle.exe into ${dir}`)
		const before = uninstallEntries()
		check(before.length === 1, `one uninstall entry before: ${before.map(e => e.name).join(', ')}`)
		const hadMenu = reg('HKCU\\Software\\Classes\\directory\\shell\\Axle') !== undefined
		notes.push(hadMenu ? '"Open with Axle" was registered' : '"Open with Axle" was not registered by this Axle Setup')
		// What the user had made with it: settings (the old theme) and an extension folder.
		mkdirSync(join(roaming, 'Axle', 'User'), { recursive: true })
		writeFileSync(join(roaming, 'Axle', 'User', 'settings.json'), '{\n\t"workbench.colorTheme": "Axle Dark",\n\t"editor.fontSize": 17\n}\n')
		mkdirSync(join(homedir(), '.axle', 'extensions'), { recursive: true })
		writeFileSync(join(homedir(), '.axle', 'argv.json'), '{}\n')
	
		// 2. Insilode's Setup over it.
		const second = run(setup, upgradeArgs(join(out, 'setup-insilode.log')))
		check(second.status === 0, `Insilode's Setup exited with ${second.status}`)
		const beside = join(local, 'Programs', 'Insilode')
		check(existsSync(join(dir, 'Insilode.exe')) && !existsSync(join(beside, 'Insilode.exe')), `Insilode.exe is in ${dir} (the old folder), not in ${beside}`)
		check(!existsSync(join(dir, 'Axle.exe')), 'Axle.exe is gone')
		check(!existsSync(join(dir, 'bin', 'axle.cmd')) && existsSync(join(dir, 'bin', 'insilode.cmd')), 'bin\\axle.cmd is gone, bin\\insilode.cmd is there')
		const after = uninstallEntries()
		check(after.length === 1 && /insilode/i.test(after[0].name) && after[0].key === before[0].key, `one uninstall entry, the same key, now called ${after.map(e => e.name).join(', ')}`)
		check(find(programs, 'Insilode.lnk') && !find(programs, 'Axle.lnk'), 'the Start menu has Insilode.lnk and no Axle.lnk')
		check(reg('HKCU\\Software\\Classes\\directory\\shell\\Axle') === undefined, '"Open with Axle" is removed')
		check(reg('HKCU\\Software\\Classes\\directory\\shell\\Insilode') !== undefined, '"Open with Insilode" is registered')
	
		// 3. The first start copies what Axle left: Insilode's own window opens here, in the sandbox, and is closed again.
		const child = spawn(join(dir, 'Insilode.exe'), [], { stdio: 'ignore', windowsHide: true, detached: true })
		child.unref()
		const marker = join(roaming, 'Insilode', '.migrated-from-axle')
		try {
			await until('Insilode to copy the Axle user data on its first start', () => existsSync(marker), { ms: 120000, every: 1000 })
		} finally {
			spawnSync('taskkill.exe', ['/F', '/T', '/IM', 'Insilode.exe'], { windowsHide: true })
			await sleep(2000)
		}
		const settings = readFileSync(join(roaming, 'Insilode', 'User', 'settings.json'), 'utf8')
		check(/"workbench.colorTheme": "Insilode Dark"/.test(settings) && /"editor.fontSize": 17/.test(settings), 'the settings were copied, the theme renamed')
		check(existsSync(join(homedir(), '.insilode', 'argv.json')), '~/.insilode was copied from ~/.axle')
		check(/Axle Dark/.test(readFileSync(join(roaming, 'Axle', 'User', 'settings.json'), 'utf8')), 'the Axle folder is as it was')
	
	} catch (e) {
		uninstallLeftover(dir)
		throw e
	}

	// 4. Gone again: the uninstaller removes the one install.
	const unins = readdirSync(dir).find(n => /^unins\d+\.exe$/i.test(n))
	check(!!unins, 'there is an uninstaller')
	run(join(dir, unins), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], 120000)
	await until('the install folder to be emptied', () => !existsSync(join(dir, 'Insilode.exe')), { ms: 120000, every: 1000 })
	check(uninstallEntries().length === 0, 'no uninstall entry is left')
	return { status: 'pass', detail: notes.join(' / '), shots: [] }
}
