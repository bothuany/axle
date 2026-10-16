/*---------------------------------------------------------------------------------------------
 *  Axle: the files a Codex `apply_patch` touches. Codex hooks report the edit as
 *  `tool_name: "apply_patch"` with the whole patch in `tool_input.command`, never a `file_path`,
 *  so the files come from the patch's own headers:
 *
 *    *** Begin Patch
 *    *** Update File: src/a.ts
 *    *** Move to: src/b.ts
 *    @@ ...
 *    *** Add File: src/c.ts
 *    +line
 *    *** Delete File: src/d.ts
 *    *** End Patch
 *
 *  Pure (no vscode), so it is tested on its own.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';

export interface PatchOp {
	op: 'add' | 'update' | 'delete';
	/** As written in the patch: usually relative to the agent's working folder. */
	file: string;
	/** `*** Move to:` under an Update: where the file ends up. */
	moveTo?: string;
}

const HEADER = /^\*\*\* (Add|Update|Delete) File: (.+)$/;
const MOVE = /^\*\*\* Move to: (.+)$/;
const BEGIN = '*** Begin Patch';
const END = '*** End Patch';

/**
 * Every file operation in `text`, in order. Only lines between `*** Begin Patch` and `*** End Patch`
 * count (a patch without its end marker runs to the end of the text), so a command that merely
 * mentions a header elsewhere adds nothing. Content lines always start with `+`, `-`, ` ` or `@@`,
 * so they can never be read as a header.
 */
export function parsePatch(text: string): PatchOp[] {
	const ops: PatchOp[] = [];
	let inside = false;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trimEnd();
		if (!inside) {
			inside = line.trim() === BEGIN;
			continue;
		}
		// Exact: a context line of a file that itself says "*** End Patch" starts with a space.
		if (line === END) {
			inside = false;
			continue;
		}
		const h = HEADER.exec(line);
		if (h) {
			ops.push({ op: h[1].toLowerCase() as PatchOp['op'], file: h[2].trim() });
			continue;
		}
		const m = MOVE.exec(line);
		const last = ops[ops.length - 1];
		if (m && last?.op === 'update' && !last.moveTo) {
			last.moveTo = m[1].trim();
		}
	}
	return ops;
}

/** The patch text of an apply_patch call: `command` is a string, or argv (`["apply_patch", "<patch>"]`). */
export function patchText(input: Record<string, unknown> = {}): string {
	const parts = [input.command, input.input, input.patch].flatMap(v => typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
	return parts.join('\n');
}

/**
 * The absolute paths an apply_patch call reads or writes: every file it adds, updates or deletes,
 * and both ends of a move (the old file goes away, the new one appears). Relative paths are taken
 * from `cwd`; without one they are left as written. No duplicates, first-seen order.
 */
export function patchFiles(input: Record<string, unknown> | undefined, cwd: string | undefined): string[] {
	const abs = (f: string) => path.isAbsolute(f) || !cwd ? path.normalize(f) : path.resolve(cwd, f);
	const out = new Set<string>();
	for (const o of parsePatch(patchText(input))) {
		out.add(abs(o.file));
		if (o.moveTo) {
			out.add(abs(o.moveTo));
		}
	}
	return [...out];
}
