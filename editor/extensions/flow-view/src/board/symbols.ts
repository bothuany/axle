/*---------------------------------------------------------------------------------------------
 *  Insilode board symbols: matching the `symbol` of a node ("OrderService.Place") against what the index knows.
 *  The handler asks the language servers for candidates; this decides which one is the symbol and which
 *  are close enough to suggest. Pure: no `vscode`.
 *--------------------------------------------------------------------------------------------*/

export interface SymbolCandidate {
	name: string;
	/** The type or namespace that holds it, when the index says. */
	container?: string;
	kind: string;
	file: string;
	line: number;
}

/** "A.B.c", "A::c", "A#c" or "A/c" → owner "A.B" and name "c". */
export function splitSymbol(symbol: string): { owner?: string; name: string } {
	const parts = symbol.trim().split(/::|[.#/]/).filter(Boolean);
	const name = parts.pop() ?? symbol.trim();
	return { owner: parts.length ? parts.join('.') : undefined, name };
}

/** The last word of a dotted path: what to ask the index for. */
export const symbolQuery = (symbol: string): string => splitSymbol(symbol).name.replace(/\(.*$/, '');

const lastOf = (path: string) => path.split(/::|[.#/]/).filter(Boolean).pop() ?? path;

/** The candidate that is the symbol (same name, and the same owner when the symbol names one), else up to three that look like it. */
export function matchSymbols(symbol: string, cands: SymbolCandidate[]): { exact?: SymbolCandidate; near: SymbolCandidate[] } {
	const { owner, name } = splitSymbol(symbol);
	const bare = name.replace(/\(.*$/, '');
	const ownerLast = owner ? lastOf(owner).toLowerCase() : undefined;
	const sameName = cands.filter(c => c.name.replace(/\(.*$/, '') === bare);
	const exact = sameName.find(c => !ownerLast || (c.container ? lastOf(c.container).toLowerCase() === ownerLast : false))
		// A type is found by its own name; a method whose index entry carries no container is still the one when only one has the name.
		?? (ownerLast && sameName.length === 1 && !sameName[0].container ? sameName[0] : undefined);
	if (exact) {
		return { exact, near: [] };
	}
	const want = bare.toLowerCase();
	const score = (c: SymbolCandidate) => {
		const n = c.name.toLowerCase();
		if (n === want) {
			return 0;
		}
		if (n.startsWith(want) || want.startsWith(n)) {
			return 1;
		}
		return n.includes(want) || want.includes(n) ? 2 : 9;
	};
	const near = cands.map(c => ({ c, s: score(c) })).filter(x => x.s < 9).sort((a, b) => a.s - b.s).slice(0, 3).map(x => x.c);
	return { near };
}

/** One candidate as the agent reads it: "method OrderService.Place src/Orders.cs:58". */
export const describeCandidate = (c: SymbolCandidate): string => `${c.kind} ${c.container ? `${c.container}.` : ''}${c.name} ${c.file}:${c.line}`;
