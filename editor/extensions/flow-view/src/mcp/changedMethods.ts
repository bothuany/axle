/*---------------------------------------------------------------------------------------------
 *  Axle agent bridge: which methods of a file an agent's edit landed in. The turn impact used to count
 *  every function of an edited file; with the edit's line ranges it can name the methods it changed,
 *  and only the flows that reach those. An edit outside every method (imports, a field, a constant)
 *  may change any of them, so then the whole file counts, as before.
 *
 *  Pure (no vscode), so it is tested on its own.
 *--------------------------------------------------------------------------------------------*/

/** Lines of the current file, 1-based and inclusive. */
export interface LineRange {
	start: number;
	end: number;
	/** Lines were only removed: the gap is between `start` and `end` (0 = above the first line). */
	gap?: boolean;
}

/** What `diff`'s structuredPatch gives per hunk (old → new, 1-based). */
export interface HunkLike {
	newStart: number;
	newLines: number;
}

export interface MethodSpan {
	id: string;
	name: string;
	/** The line with the method's name (after any annotations), 1-based. */
	line: number;
	startLine: number;
	endLine: number;
}

/**
 * Whether the spans describe `text`. The index re-reads a changed file shortly after it changes, so right after an
 * agent's write it may still hold the old one, and its spans would put the edit in the wrong method. Each method
 * whose name is a plain identifier must have that name on its line; one that does not means the spans are stale.
 */
export function spansMatch(methods: MethodSpan[], text: string): boolean {
	const lines = text.split(/\r?\n/);
	return methods.every(m => {
		const short = m.name.slice(m.name.lastIndexOf('.') + 1);
		return !/^[A-Za-z_$][\w$]*$/.test(short) || (lines[m.line - 1] ?? '').includes(short);
	});
}

/**
 * The current-file lines each hunk touches. A hunk that only removes lines leaves a gap: jsdiff (with
 * no context) gives `newStart` as the line right after it, so the gap lies between that line and the one before.
 */
export function rangesFromHunks(hunks: HunkLike[]): LineRange[] {
	return hunks.map(h => h.newLines > 0
		? { start: h.newStart, end: h.newStart + h.newLines - 1 }
		: { start: h.newStart - 1, end: h.newStart, gap: true });
}

/**
 * The methods `ranges` fall into. A method counts when a range overlaps its span. When some range lies
 * outside every method, `wholeFile` is true: that edit may change any method of the file. Nested
 * methods (a lambda's enclosing method, a local function) all count: each is a way in.
 */
export function methodsTouched<M extends MethodSpan>(methods: M[], ranges: LineRange[]): { methods: M[]; wholeFile: boolean } {
	const hit = new Set<M>();
	let wholeFile = false;
	for (const r of ranges) {
		// A gap is in a method only when both its sides are: removing a whole method between two others is not an edit of either.
		const inside = methods.filter(m => r.gap ? m.startLine <= r.start && r.end <= m.endLine : m.startLine <= r.end && r.start <= m.endLine);
		if (!inside.length) {
			wholeFile = true;
		}
		inside.forEach(m => hit.add(m));
	}
	return { methods: methods.filter(m => hit.has(m)), wholeFile };
}
