// The agent avatars are drawn by flow-agent's dock and by core's desktop overlay. Core cannot import an extension, so
// the patch carries a copy of the renderer (src/vs/platform/insilodeDesktop/common/insilodeAvatars.ts). This test keeps the
// copy byte for byte equal to the extension's file, so the two never drift apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE = `${repo}editor/extensions/flow-agent/src/avatars.ts`;
const PATCH = `${repo}editor/patches/flow-desktop.patch`;
const COPY = 'src/vs/platform/insilodeDesktop/common/insilodeAvatars.ts';

/** The content of a file the patch adds, from its `+` lines. */
function addedFile(patch, path) {
	const start = patch.indexOf(`+++ b/${path}\n`);
	assert.ok(start >= 0, `${path} is in the patch`);
	const lines = [];
	for (const line of patch.slice(start).split('\n').slice(1)) {
		if (line.startsWith('diff --git ')) {
			break;
		}
		if (line.startsWith('+')) {
			lines.push(line.slice(1));
		} else if (!line.startsWith('@@') && !line.startsWith('\\')) {
			assert.fail(`${path} is added whole by the patch, but it has a context line: ${line}`);
		}
	}
	return lines.join('\n');
}

test('the core copy of the avatar renderer is the same as flow-agent\'s', () => {
	const source = readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');
	const copy = addedFile(readFileSync(PATCH, 'utf8').replace(/\r\n/g, '\n'), COPY);
	assert.equal(copy, source, `editor/patches/flow-desktop.patch must add ${COPY} as an exact copy of editor/extensions/flow-agent/src/avatars.ts`);
});
