// Skeleton first crosses the extension boundary by command: flow-view sends the dock a row (SkeletonView), and flow-agent sends
// back a warning action. Each side declares the shape on its own (extensions never import each other), so this keeps the two in step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const read = p => readFileSync(join(repo, p), 'utf8');
const view = read('editor/extensions/flow-view/src/skeleton/sessions.ts');
const dock = read('editor/extensions/flow-agent/src/skeleton.ts');
const host = read('editor/extensions/flow-view/src/skeletonHost.ts');

/** The field lines of an interface, nested object types included, without comments or whitespace. */
function shape(src, name) {
	const body = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(src)?.[1];
	assert.ok(body, `no interface ${name}`);
	return body.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('/**') && !l.startsWith('*') && !l.startsWith('//')).join(' ');
}

test('flow-view and flow-agent describe the skeleton row the same way', () => {
	assert.equal(shape(dock, 'SkeletonView'), shape(view, 'SkeletonView').replace(/stage: Stage;/, "stage: 'design' | 'skeleton' | 'handover';"));
	assert.match(view, /export type Stage = 'design' \| 'skeleton' \| 'handover';/);
});

test('every warning action the dock may send is one the window carries out', () => {
	const actions = /WARNING_ACTIONS = \[([^\]]*)\]/.exec(dock)[1].match(/'(\w+)'/g).map(a => a.slice(1, -1));
	assert.deepEqual(actions, ['accept', 'revert', 'open']);
	for (const a of actions) {
		assert.match(host, new RegExp(`action === '${a}'`), a);
	}
	assert.match(host, /choice === 'just'/);
	assert.match(host, /choice !== 'skeleton'/);
});
