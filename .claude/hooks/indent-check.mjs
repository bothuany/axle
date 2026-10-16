// PostToolUse (Edit|Write|MultiEdit): the repo has no formatter, and its indentation differs by folder (CLAUDE.md):
// extension TypeScript and scripts use tabs, the canvas in ui/ uses 2 spaces. Only the text Claude just wrote is
// checked, so older lines never block an edit. Exit 2 sends the offending lines back to Claude to fix.
let input = ''
process.stdin.on('data', d => input += d)
process.stdin.on('end', () => {
	const data = JSON.parse(input || '{}')
	const tool = data.tool_input ?? {}
	const path = String(tool.file_path ?? '').replaceAll('\\', '/')

	let style
	if (/\/editor\/extensions\/flow-[^/]+\/(src|mcp|test)\/.+\.(ts|tsx|mjs)$/i.test(path) || /\/(scripts|\.claude\/hooks)\/[^/]+\.mjs$/i.test(path)) {
		style = 'tabs'
	} else if (/\/ui\/src\/.+\.(ts|tsx|css)$/i.test(path)) {
		style = 'spaces'
	} else {
		return
	}

	const written = [tool.content, tool.new_string, ...(tool.edits ?? []).map(e => e?.new_string)].filter(s => typeof s === 'string').join('\n')
	// Tabs files: a line that starts with two or more spaces (a lone space is a JSDoc ` * ` continuation).
	// Spaces files: a line that starts with a tab.
	const wrong = style === 'tabs' ? /^ {2,}\S/ : /^\t/
	const bad = written.split(/\r?\n/).filter(line => wrong.test(line))
	if (bad.length === 0) {
		return
	}
	const sample = bad.slice(0, 5).map(line => `  ${JSON.stringify(line.slice(0, 100))}`).join('\n')
	const rule = style === 'tabs' ? 'is indented with tabs' : 'is indented with 2 spaces, not tabs'
	process.stderr.write(`${path} ${rule}, but ${bad.length} line(s) you wrote are not:\n${sample}\nRe-indent them to match the file.\n`)
	process.exit(2)
})
