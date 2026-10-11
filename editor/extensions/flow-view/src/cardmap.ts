/*---------------------------------------------------------------------------------------------
 *  Axle: pure position helpers between a card's text (what the canvas editor shows) and the real
 *  document. No `vscode` import, so they can be tested on their own.
 *
 *  A card holds whole lines of a file, from `startLine` (1-based, the file's line number of the card's
 *  first line). Card lines and columns are Monaco's (1-based); document lines and characters are VS Code's (0-based).
 *--------------------------------------------------------------------------------------------*/

export const normalize = (s: string) => s.replace(/\r\n/g, '\n');

/** Lines in a text (a text without a newline is one line; an empty text is one empty line). */
export const lineCount = (text: string) => normalize(text).split('\n').length;

/** The file's line (1-based) of the last line of a card that starts at `startLine` and holds `text`. */
export const endLineOf = (startLine: number, text: string) => startLine + lineCount(text) - 1;

/** A position as Monaco (card line, column; 1-based) and VS Code (document line, character; 0-based) each spell it. */
export interface DocPos {
	line: number;
	character: number;
}

export const toDoc = (startLine: number, cardLine: number, column: number): DocPos => ({ line: startLine - 1 + cardLine - 1, character: column - 1 });

export const toCard = (startLine: number, p: DocPos) => ({ lineNumber: p.line - (startLine - 1) + 1, column: p.character + 1 });

/** A range in document coordinates (0-based lines and characters). */
export interface DocRange {
	start: DocPos;
	end: DocPos;
}

/** A range as Monaco spells it (1-based, inclusive lines). */
export interface CardRange {
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
}

/** Does the card (which holds `lines` lines from `startLine`) contain this document line (0-based)? */
export const lineInCard = (startLine: number, lines: number, docLine: number) => docLine >= startLine - 1 && docLine <= startLine - 2 + lines;

/** The range in card coordinates when all of it lies inside the card; `undefined` for a range that reaches outside. */
export function toCardRange(startLine: number, lines: number, r: DocRange): CardRange | undefined {
	if (!lineInCard(startLine, lines, r.start.line) || !lineInCard(startLine, lines, r.end.line)) {
		return undefined;
	}
	const a = toCard(startLine, r.start);
	const b = toCard(startLine, r.end);
	return { startLineNumber: a.lineNumber, startColumn: a.column, endLineNumber: b.lineNumber, endColumn: b.column };
}

/** What a sync of the card's text into the document has to do. */
export type SyncPlan = 'skip' | 'apply' | 'conflict';

/**
 * `docText`: what the document holds now on the card's lines (the lines last put there, or the card's original text
 * on the first sync). If that is not what we expect, someone else changed the lines: never overwrite them.
 */
export function planSync(p: { expected: string; docText: string | undefined; last: string; next: string }): SyncPlan {
	if (p.docText === undefined || normalize(p.docText) !== normalize(p.expected)) {
		return 'conflict';
	}
	return normalize(p.next) === normalize(p.last) ? 'skip' : 'apply';
}

/** Where `needle` occurs in `haystack` when it occurs exactly once: its start and end as (line, character), 0-based. */
export function locateOnce(haystack: string, needle: string): DocRange | undefined {
	const hay = normalize(haystack);
	const at = hay.indexOf(normalize(needle));
	if (at < 0 || hay.indexOf(normalize(needle), at + 1) >= 0) {
		return undefined;
	}
	const pos = (offset: number): DocPos => {
		const before = hay.slice(0, offset).split('\n');
		return { line: before.length - 1, character: before[before.length - 1].length };
	};
	return { start: pos(at), end: pos(at + normalize(needle).length) };
}

/** Does this declaration line have no body: an interface member, or an abstract one? Such a symbol is implemented elsewhere. */
export function isBodyless(declaration: string): boolean {
	const d = declaration.trim();
	if (/\b(?:abstract|interface)\b/.test(d)) {
		return true;
	}
	// Parameter lists may hold defaults (`= default`): judge what is left around them.
	const outer = d.replace(/\([^()]*\)/g, '()');
	return /\(\)\s*(?::\s*[^=;{]+)?;$/.test(outer) && !/[={]|=>/.test(outer);
}
