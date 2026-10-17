// Axle never starts a window that takes focus and never steals focus (CLAUDE.md). The desktop status overlay is an
// always-on-top window in the main process, so its code is held to that here. That code exists in this repository only
// as the added lines of editor/patches/flow-desktop.patch (editor/vscode is generated, and Semgrep does not scan it),
// so this test reads the patch.
//
// The one path to focus is a click on an agent in the overlay, the user's gesture: the workbench contribution then calls
// focusWindow once. Everything in electron-main must stay passive: create hidden and unfocusable, appear with
// showInactive(), never focus(), show(), app.focus(), moveTop() or a critical Dock bounce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PATCH = fileURLToPath(new URL('../../editor/patches/flow-desktop.patch', import.meta.url));
const MAIN = /\/axleDesktop\/electron-main\//;
const CONTRIBUTION = /\/axleDesktop\/electron-browser\//;

/** The added lines of each file in a unified diff, comments left out (they may name what they forbid). */
export function addedLines(patch) {
	const files = new Map();
	let current;
	for (const line of patch.split('\n')) {
		const header = /^\+\+\+ b\/(.+)$/.exec(line);
		if (header) {
			current = header[1];
			files.set(current, []);
		} else if (current && line.startsWith('+')) {
			const code = line.slice(1);
			if (!/^\s*(\/\/|\/?\*)/.test(code)) {
				files.get(current).push(code);
			}
		}
	}
	return files;
}

const FORBIDDEN = [
	[/(^|[^\w])focus\s*\(/, 'focus()'],
	[/\.show\s*\(\s*\)/, '.show() (use showInactive())'],
	[/\bapp\.focus\b/, 'app.focus'],
	[/\.moveTop\s*\(/, 'moveTop()'],
	[/\bsetFocusable\s*\(\s*true/, 'setFocusable(true)'],
	[/bounce\s*\(\s*['"]critical['"]/, "dock.bounce('critical')"],
	[/\bfocusWindow\s*\(/, 'focusWindow()'],
];

/** What breaks the rule in a patch: forbidden calls in main-process code, a window not created hidden and unfocusable, more than one focus path in the workbench. */
export function violations(patch) {
	const out = [];
	for (const [file, lines] of addedLines(patch)) {
		if (MAIN.test(file)) {
			lines.forEach(code => {
				for (const [re, what] of FORBIDDEN) {
					if (re.test(code)) {
						out.push(`${file}: ${what}: ${code.trim()}`);
					}
				}
			});
			const text = lines.join('\n');
			for (const m of text.matchAll(/new BrowserWindow\(\{([\s\S]*?)\n\t*\}\);/g)) {
				if (!/\bshow:\s*false\b/.test(m[1]) || !/\bfocusable:\s*false\b/.test(m[1])) {
					out.push(`${file}: a BrowserWindow without show: false and focusable: false`);
				}
			}
			if (/new BrowserWindow\(/.test(text) && !/new BrowserWindow\(\{/.test(text)) {
				out.push(`${file}: a BrowserWindow whose options cannot be checked`);
			}
		}
		if (CONTRIBUTION.test(file)) {
			const focusing = lines.filter(code => /\bfocusWindow\s*\(|(^|[^\w])focus\s*\(|\bapp\.focus\b/.test(code));
			if (focusing.length > 1) {
				out.push(`${file}: ${focusing.length} focus calls; the overlay click is the only one allowed`);
			}
		}
	}
	return out;
}

test('the desktop overlay code never takes focus on its own', () => {
	const patch = readFileSync(PATCH, 'utf8');
	assert.deepEqual(violations(patch), []);
	const files = [...addedLines(patch).keys()];
	assert.ok(files.some(f => MAIN.test(f)), 'the patch has the main-process overlay code this test guards');
	assert.ok(/showInactive\(\)/.test(patch), 'the overlay appears with showInactive()');
});

test('the scan catches what it forbids', () => {
	const planted = [
		'+++ b/src/vs/platform/axleDesktop/electron-main/x.ts',
		'+\t\twin.focus();',
		'+\t\twin.show();',
		'+\t\tapp.focus({ steal: true });',
		"+\t\tapp.dock.bounce('critical');",
		'+\t\t// win.focus() in a comment is fine',
		'+\t\tconst w = new BrowserWindow({',
		'+\t\t\tframe: false,',
		'+\t\t});',
		'+++ b/src/vs/workbench/contrib/axleDesktop/electron-browser/y.ts',
		'+\t\tthis.nativeHostService.focusWindow();',
		'+\t\tthis.nativeHostService.focusWindow();',
	].join('\n');
	const found = violations(planted);
	assert.equal(found.length, 7, found.join('\n'));
	assert.ok(found.some(v => v.includes('without show: false')));
	assert.ok(found.some(v => v.includes('2 focus calls')));
	assert.deepEqual(violations('+++ b/src/vs/platform/axleDesktop/electron-main/x.ts\n+\t\twin.showInactive();\n+\t\tfocusable: false,'), []);
});
