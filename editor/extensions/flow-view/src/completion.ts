/*---------------------------------------------------------------------------------------------
 *  Axle: what a card completion is made of besides the language server's answer. No `vscode` import, so
 *  it can be tested on its own.
 *
 *  Completion in a card must never be worse than plain Monaco: whatever the language server says (nothing,
 *  a refusal, a timeout, an error), the identifiers of the card and of its file are offered as well.
 *--------------------------------------------------------------------------------------------*/

const IDENT = /[\p{L}_$][\p{L}\p{N}_$]*/gu;
const IDENT_CHAR = /[\p{L}\p{N}_$]/u;

/**
 * Do identifiers belong in the answer? Always when the user typed or asked (no trigger character), and after a trigger character
 * (`a.`, `(`) only when the language server had nothing: its members are the right answer there, a word of the card is not.
 */
export const wantsWords = (trigger: string | undefined, found: number) => trigger === undefined || found === 0;

/** Who answers for a file: Roslyn (the C# analyzer), the polyglot index (languages without a language server of their own here), or the editor's providers. */
export type Route = 'roslyn' | 'index' | 'vscode';

const INDEX_EXT = new Set(['java', 'py', 'go', 'php', 'rb', 'rs']);

const extOf = (file: string) => file.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() ?? '';

export function routeOf(file: string): Route {
	const ext = extOf(file);
	return ext === 'cs' ? 'roslyn' : INDEX_EXT.has(ext) ? 'index' : 'vscode';
}

/** JavaScript and TypeScript: the editor has a language server for them, and the index answers when it does not. */
export const isScript = (file: string) => /^(?:[mc]?[jt]sx?)$/.test(extOf(file));

/** The text of a line (1-based) up to a column (1-based, the cursor is before it). */
export function lineBefore(text: string, line: number, column: number): string {
	return (text.replace(/\r\n/g, '\n').split('\n')[line - 1] ?? '').slice(0, Math.max(0, column - 1));
}

/** The identifier ending at a position of a text (1-based line and column, as Monaco spells it): what the user has typed of the word so far. */
export function wordBefore(text: string, line: number, column: number): string {
	const row = text.replace(/\r\n/g, '\n').split('\n')[line - 1] ?? '';
	let at = Math.min(column - 1, row.length);
	const end = at;
	while (at > 0 && IDENT_CHAR.test(row[at - 1])) {
		at--;
	}
	return row.slice(at, end);
}

/** The distinct identifiers of a text, in order of first appearance, or most used first. */
export function identifiers(text: string, order: 'appearance' | 'frequency' = 'appearance'): string[] {
	const seen = new Map<string, number>();
	for (const m of text.matchAll(IDENT)) {
		seen.set(m[0], (seen.get(m[0]) ?? 0) + 1);
	}
	const all = [...seen.keys()];
	return order === 'frequency' ? all.sort((a, b) => seen.get(b)! - seen.get(a)!) : all;
}

/**
 * The words to offer: those of the card first (they are what the user is working with), then those of the whole file, most used first.
 * Not the word being typed (it would only offer itself) and nothing shorter than two characters.
 */
export function rankWords(card: string, file: string, typing: string, max: number): string[] {
	const out: string[] = [];
	const seen = new Set<string>([typing]);
	for (const w of [...identifiers(card), ...identifiers(file, 'frequency')]) {
		if (out.length >= max) {
			break;
		}
		if (w.length >= 2 && !seen.has(w)) {
			seen.add(w);
			out.push(w);
		}
	}
	return out;
}

/**
 * The language server's items, then the words that are not among them (by label). The server's items keep their order
 * and come first; the canvas ranks by what was typed, and the words carry a sort text that puts them behind on a tie.
 */
export function mergeCompletions<T extends { label: string }>(server: T[], words: string[], word: (w: string) => T): { items: T[]; words: number } {
	const have = new Set(server.map(i => i.label));
	const extra = words.filter(w => !have.has(w)).map(word);
	return { items: [...server, ...extra], words: extra.length };
}

/** Sorts behind every sort text a server sends (they are letters and digits). */
export const WORD_SORT = '~';
