// A Windows CI runner hands out its temp folder by an 8.3 short name (C:\Users\RUNNER~1\...), while the C# analyzer reports every file by
// its long name (C:\Users\runneradmin\...). A test that runs the analyzer on a copy in os.tmpdir() and then compares those paths with its
// own passes on a developer's machine and fails only on the runner. The temp folder must be resolved to its real name first
// (`realpathSync.native`). Cheap to check here, expensive to find in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));

/** Test files that run the analyzer (or dotnet) and make a temp folder without resolving its real name. */
export function unresolvedTempPaths(files) {
	return files.filter(({ text }) => /FlowAnalyzer\.dll|execFileSync\(\s*'dotnet'|spawn\(\s*'dotnet'/.test(text) && /\btmpdir\s*\(/.test(text) && !/realpathSync\.native/.test(text)).map(f => f.name);
}

test('tests that run the analyzer on a temp folder resolve its real name first', () => {
	const dir = join(repo, 'editor', 'extensions', 'flow-view', 'test');
	const files = readdirSync(dir).filter(n => /\.test\.mjs$/.test(n)).map(name => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
	assert.deepEqual(unresolvedTempPaths(files), []);
});

test('the check finds the mistake it guards against', () => {
	const bad = "const out = execFileSync('dotnet', [DLL, 'tables', join(tmpdir(), 'x')])";
	assert.deepEqual(unresolvedTempPaths([{ name: 'a.test.mjs', text: bad }, { name: 'b.test.mjs', text: `${bad}; realpathSync.native(dir)` }, { name: 'c.test.mjs', text: 'mkdtempSync(join(tmpdir(), "y"))' }]), ['a.test.mjs']);
});
