// Shared by the setup, start and build scripts: where things are, and how to start a program on every OS.
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const VSCODE = join(ROOT, 'editor', 'vscode')
export const EXTENSIONS = join(ROOT, 'editor', 'extensions')
export const PATCHES = join(ROOT, 'editor', 'patches')
export const isWin = process.platform === 'win32'

/** The Insilode extensions that have a build of their own (an esbuild.mjs), in folder order. */
export function buildableExtensions() {
	return readdirSync(EXTENSIONS).filter(name => name.startsWith('flow-') && existsSync(join(EXTENSIONS, name, 'esbuild.mjs')))
}

/** Insilode's patches to VS Code (editor/patches/*.patch), in the order setup applies them. */
export function patchFiles() {
	return readdirSync(PATCHES).filter(name => name.endsWith('.patch')).sort()
}

/**
 * Whether editor/vscode carries every patch in editor/patches. Each one is checked on its own (`git apply --reverse --check`),
 * which is why no two patches may change the same file (test/update checks that).
 */
export function patchesApplied() {
	return patchFiles().every(patch => launchSync('git', ['apply', '--reverse', '--check', join(PATCHES, patch)], { cwd: VSCODE, stdio: 'ignore' }).status === 0)
}

/** Where VS Code's icon font comes from (the npm package), where `gulp copy-codicons` puts it (src/) and where the workbench loads it (out/). */
export function codiconFontPaths(vscode = VSCODE) {
	const rel = ['vs', 'base', 'browser', 'ui', 'codicons', 'codicon', 'codicon.ttf']
	return {
		packaged: join(vscode, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.ttf'),
		src: join(vscode, 'src', ...rel),
		out: join(vscode, 'out', ...rel),
	}
}

/**
 * Makes sure the compiled workbench has its icon font: without out/.../codicon.ttf every icon is an empty box, and nothing
 * in the log says why. 'present' when it is there, 'copied' when it was copied from src/ or the npm package, 'missing'
 * when there is nothing to copy (the editor's `npm ci` did not run).
 */
export function ensureCodiconFont(vscode = VSCODE) {
	const { packaged, src, out } = codiconFontPaths(vscode)
	if (existsSync(out)) {
		return 'present'
	}
	const from = [src, packaged].find(p => existsSync(p))
	if (!from) {
		return 'missing'
	}
	mkdirSync(dirname(out), { recursive: true })
	copyFileSync(from, out)
	return 'copied'
}

/** cmd.exe expands %VAR% even inside quotes, and a line break ends the command: such an argument is refused, not rewritten. */
const quote = arg => {
	const s = String(arg)
	if (/[%\r\n]/.test(s)) {
		throw new Error(`Cannot pass "${s.replace(/[\r\n]/g, ' ')}" through cmd.exe: a % or a line break in it would be expanded or cut. Rename or move the folder.`)
	}
	return `"${s.replace(/"/g, '""')}"`
}

/**
 * `[file, args, options]` that start `cmd args` with no shell in between, so a space or `&` in a path stays
 * part of that path. Windows needs cmd.exe only for .cmd/.bat files (npm's shim, VS Code's code.bat), and
 * then every argument is quoted. `npm` runs npm's own script with this Node when npm started us.
 */
export function plan(cmd, args = [], options = {}) {
	if (cmd === 'node') {
		return [process.execPath, args, options]
	}
	// npm_execpath names whatever package manager started us (pnpm, yarn too): only npm's own script may stand in for `npm`.
	const npmCli = process.env.npm_execpath
	if (cmd === 'npm' && npmCli && basename(npmCli) === 'npm-cli.js') {
		return [process.execPath, [npmCli, ...args], options]
	}
	if (isWin && (cmd === 'npm' || /\.(cmd|bat)$/i.test(cmd))) {
		const line = [cmd === 'npm' ? 'npm.cmd' : cmd, ...args].map(quote).join(' ')
		return ['cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...options, windowsVerbatimArguments: true }]
	}
	return [cmd, args, options]
}

export const launch = (cmd, args, options) => spawn(...plan(cmd, args, options))
export const launchSync = (cmd, args, options) => spawnSync(...plan(cmd, args, options))
