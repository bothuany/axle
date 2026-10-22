await p.keyboard.press('F1'); await sleep(600)
await p.keyboard.insertText('Preferences: Open User Settings (JSON)'); await sleep(1000); await p.keyboard.press('Enter'); await sleep(2000)
await p.keyboard.press('Control+A'); await p.keyboard.press('Delete')
// Inserted as one line so the editor's auto-indent does not stack up.
await p.keyboard.insertText(JSON.stringify({
	'workbench.colorTheme': 'Insilode Dark',
	'workbench.startupEditor': 'none',
	'editor.fontSize': 14,
	'editor.minimap.enabled': false,
	'workbench.tips.enabled': false,
	'security.workspace.trust.banner': 'never',
	'terminal.integrated.initialHint': false,
	'terminal.integrated.fontSize': 14,
	'terminal.integrated.gpuAcceleration': 'off',
	'terminal.integrated.defaultProfile.windows': 'bash',
	'terminal.integrated.profiles.windows': { bash: { path: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['--noprofile', '--norc'], env: { PS1: '\\[\\e[38;5;111m\\]harbor-goods\\[\\e[0m\\] $ ', GIT_PAGER: 'cat', PAGER: 'cat' } } },
	'terminal.integrated.shellIntegration.enabled': false,
	'git.autofetch': false,
	'files.eol': '\n',
}))
await sleep(400)
await p.keyboard.press('Control+S'); await sleep(1500)
await p.keyboard.press('Control+W'); await sleep(800)
return 'ok'
