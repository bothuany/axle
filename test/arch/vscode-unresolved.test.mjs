// The `vscode` rules in .dependency-cruiser.cjs match the import by its bare name, which only works while `vscode`
// stays unresolved (the host provides it at runtime; the typings come from the VS Code checkout). A package that
// installed @types/vscode would make the import resolve to a file and those rules would stop matching without a word.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));

test('no package installs @types/vscode', () => {
	const packages = [
		join(repo, 'package.json'),
		join(repo, 'ui', 'package.json'),
		...readdirSync(join(repo, 'editor', 'extensions')).map(name => join(repo, 'editor', 'extensions', name, 'package.json')),
	].filter(existsSync);
	const offenders = packages.filter(p => {
		const { dependencies = {}, devDependencies = {} } = JSON.parse(readFileSync(p, 'utf8'));
		return '@types/vscode' in dependencies || '@types/vscode' in devDependencies;
	});
	assert.deepEqual(offenders, []);
});
