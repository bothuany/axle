/*---------------------------------------------------------------------------------------------
 *  Insilode agent bridge: which methods of a file an agent's edit landed in. The turn impact used to count
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
	return hunks.map(rangeOfHunk);
}

/** One hunk's lines in the current file (see `rangesFromHunks`). */
export function rangeOfHunk(h: HunkLike): LineRange {
	return h.newLines > 0
		? { start: h.newStart, end: h.newStart + h.newLines - 1 }
		: { start: h.newStart - 1, end: h.newStart, gap: true };
}

/**
 * Whether an edit at `r` belongs to the lines `start`..`end` (a method's span). Changed lines count when they overlap it;
 * a gap only when both its sides are inside: lines removed just above a method are not an edit of that method.
 */
export function rangeTouches(r: LineRange, start: number, end: number): boolean {
	return r.gap ? start <= r.start && r.end <= end : start <= r.end && r.start <= end;
}

/** The diff a card shows: lines added inside it (current, 1-based) and removed lines placed after a current line (0 = above the first). */
export interface SpanDiff {
	added: number[];
	removed: { after: number; lines: string[] }[];
	plus: number;
	minus: number;
}

/** The part of `hunks` that falls in the lines `start`..`end`, or undefined when none does. */
export function spanDiff(hunks: (HunkLike & { lines: string[] })[], start: number, end: number): SpanDiff | undefined {
	const d: SpanDiff = { added: [], removed: [], plus: 0, minus: 0 };
	for (const h of hunks) {
		if (!rangeTouches(rangeOfHunk(h), start, end)) {
			continue;
		}
		// The current line the next added line will be; removed lines before it sit after the line above it.
		let line = h.newStart;
		let pendingRemoved: string[] = [];
		for (const l of h.lines) {
			if (l.startsWith('-')) {
				pendingRemoved.push(l.slice(1));
				d.minus++;
			} else if (l.startsWith('+')) {
				if (pendingRemoved.length) {
					d.removed.push({ after: line - 1, lines: pendingRemoved });
					pendingRemoved = [];
				}
				if (line >= start && line <= end) {
					d.added.push(line);
				}
				d.plus++;
				line++;
			}
		}
		if (pendingRemoved.length) {
			d.removed.push({ after: line - 1, lines: pendingRemoved });
		}
	}
	return d.plus || d.minus ? d : undefined;
}

/** What Undo writes for one hunk: 0-based lines `from` up to (not including) `to` of the current file become `lines`. */
export interface LineEdit {
	from: number;
	to: number;
	lines: string[];
}

/**
 * The edits that put a hunk's old lines back. The current lines of the hunk start at `newStart` (1-based), which for a pure
 * deletion is the line right after the gap: the old lines go in before it, at 0-based line `newStart - 1`.
 */
export function undoEdit(h: HunkLike & { lines: string[] }): LineEdit {
	const from = h.newStart - 1;
	return { from, to: from + h.newLines, lines: h.lines.filter(l => l.startsWith('-')).map(l => l.slice(1)) };
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
		const inside = methods.filter(m => rangeTouches(r, m.startLine, m.endLine));
		if (!inside.length) {
			wholeFile = true;
		}
		inside.forEach(m => hit.add(m));
	}
	return { methods: methods.filter(m => hit.has(m)), wholeFile };
}
