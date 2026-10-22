#!/usr/bin/env node
// Windows: puts a "Insilode" shortcut on the Desktop and in the Start menu. It runs `node scripts/start.mjs` minimised.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROOT } from './lib.mjs'

if (process.platform !== 'win32') {
	console.error('The shortcut installer is Windows-only. Run `npm start` instead.')
	process.exit(1)
}
/** A PowerShell single-quoted string: PowerShell also treats the curly quotes (‘ ’ ‚ ‛) as quote characters, so each is doubled too. */
const q = s => `'${s.replace(/['‘’‚‛]/g, m => m + m)}'`
const script = `
$w = New-Object -ComObject WScript.Shell
$dirs = @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs'))
foreach ($dir in $dirs) {
  $s = $w.CreateShortcut((Join-Path $dir 'Insilode.lnk'))
  $s.TargetPath = ${q(process.execPath)}
  $s.Arguments = ${q(`"${join(ROOT, 'scripts', 'start.mjs')}"`)}
  $s.WorkingDirectory = ${q(ROOT)}
  $s.IconLocation = ${q(join(ROOT, 'editor', 'branding', 'icon.ico'))}
  $s.WindowStyle = 7
  $s.Save()
  Write-Host ('Created ' + (Join-Path $dir 'Insilode.lnk'))
}`
const dir = mkdtempSync(join(tmpdir(), 'flow-'))
try {
	const file = join(dir, 'shortcut.ps1')
	// Windows PowerShell 5.1 reads a script without a byte-order mark in the ANSI code page: paths with ş, ü or ç would come out wrong.
	writeFileSync(file, `\ufeff${script}`)
	const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], { stdio: 'inherit' })
	process.exitCode = r.status ?? 1
	if (r.status === 0) {
		console.log(`The shortcut runs ${process.execPath}. After you switch Node versions (nvm, fnm, an upgrade) that file may be gone: run "npm run shortcut" again.`)
	}
} finally {
	rmSync(dir, { recursive: true, force: true })
}
