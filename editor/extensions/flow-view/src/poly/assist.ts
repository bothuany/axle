/*---------------------------------------------------------------------------------------------
 *  Axle polyglot index: the pure parts of completion and go-to-definition in a card. What stands before
 *  the cursor (`this.repo.find`, `$this->repo->`, `Foo::`, `get_repo().`), the word under it, and how a
 *  function is shown as a signature. No vscode, no index: the project resolves the names (graph.ts).
 *--------------------------------------------------------------------------------------------*/

import type { FuncFact, Lang } from './model';

/** One step of `a.b(x).c`: a name, and whether it was called. */
export interface Seg {
	name: string;
	call: boolean;
	/** `new Foo()`: the value is a Foo. */
	isNew?: boolean;
}

export interface Chain {
	segs: Seg[];
	/** What is typed of the member so far (may be empty). */
	partial: string;
}

const IDENT = /[\p{L}\p{N}_$]/u;

/** Index of the opening bracket that matches the closing one at `close` (scanning left), or -1. */
function matching(text: string, close: number): number {
	const open = text[close] === ')' ? '(' : '[';
	const shut = text[close];
	let depth = 0;
	for (let i = close; i >= 0; i--) {
		if (text[i] === shut) {
			depth++;
		} else if (text[i] === open && --depth === 0) {
			return i;
		}
	}
	return -1;
}

/** The member separator that ends `text` (`.`, `?.`, `->`, `::`, `!.`), with its length. */
function separatorEnd(text: string): number {
	for (const sep of ['?.', '!.', '->', '::', '.']) {
		if (text.endsWith(sep)) {
			return sep.length;
		}
	}
	return 0;
}

/**
 * The receiver chain before the cursor, for `text` = the line up to the cursor: `repo.find(id).na` → segs repo, find(), partial `na`.
 * `undefined` when the cursor is not right after a member separator (a plain identifier, or a number like `1.`).
 */
export function chainBefore(text: string): Chain | undefined {
	let end = text.length;
	while (end > 0 && IDENT.test(text[end - 1])) {
		end--;
	}
	const partial = text.slice(end);
	let head = text.slice(0, end);
	let sepLen = separatorEnd(head);
	if (!sepLen) {
		return undefined;
	}
	const segs: Seg[] = [];
	while (sepLen) {
		head = head.slice(0, head.length - sepLen);
		let call = false;
		// `x[0].` and `f(a).`: skip the brackets; a call names a method, an index keeps the element's own name unknown.
		while (head.endsWith(')') || head.endsWith(']')) {
			const open = matching(head, head.length - 1);
			if (open < 0) {
				return undefined;
			}
			call = call || head.endsWith(')');
			head = head.slice(0, open);
		}
		let at = head.length;
		while (at > 0 && IDENT.test(head[at - 1])) {
			at--;
		}
		const name = head.slice(at);
		if (!name || /^\d/.test(name)) {
			return undefined;
		}
		const isNew = /\bnew\s+$/.test(head.slice(0, at));
		segs.unshift(isNew ? { name, call, isNew } : { name, call });
		head = head.slice(0, at);
		sepLen = separatorEnd(head);
	}
	return { segs, partial };
}

/** The identifier around a column (1-based, as the editor spells it) in a line, or none. */
export function wordAt(line: string, column: number): { word: string; start: number; end: number } | undefined {
	let a = Math.min(Math.max(column - 1, 0), line.length);
	let b = a;
	while (a > 0 && IDENT.test(line[a - 1])) {
		a--;
	}
	while (b < line.length && IDENT.test(line[b])) {
		b++;
	}
	const word = line.slice(a, b);
	return word && /^[\p{L}_$]/u.test(word) ? { word, start: a, end: b } : undefined;
}

/** `a.b.c` / `$this->repo` as the index spells a receiver: dotted, without `$`, `?`, `!`. */
export function recvText(segs: readonly Seg[]): string {
	return segs.map(s => s.name.replace(/^\$/, '')).join('.');
}

const WRAPPERS = /^(?:Optional|Promise|Task|ValueTask|CompletableFuture|ResponseEntity|Mono|Flux|Option|Result|Box|Rc|Arc|Observable|Awaitable|Maybe|Future)\s*[<[]/;

/** The class a declared type names: `Optional<User>` → User, `*UserRepo` → UserRepo, `app.models.User` → User. Collections give nothing. */
export function baseType(text: string | undefined, depth = 0): string | undefined {
	let s = (text ?? '').trim().replace(/^[?&*]+|^(?:mut|const|static|final|readonly)\s+/g, '').trim();
	if (!s || depth > 4) {
		return undefined;
	}
	if (WRAPPERS.test(s)) {
		const inner = s.slice(s.search(/[<[]/) + 1);
		let level = 0;
		let cut = inner.length;
		for (let i = 0; i < inner.length; i++) {
			const c = inner[i];
			if (c === '<' || c === '[' || c === '(') {
				level++;
			} else if ((c === '>' || c === ']' || c === ')') && --level < 0) {
				cut = i;
				break;
			} else if (c === ',' && level === 0) {
				cut = i;
				break;
			}
		}
		return baseType(inner.slice(0, cut), depth + 1);
	}
	s = s.replace(/\s*\|\s*(?:null|None|undefined)\b/g, '').replace(/\b(?:null|None|undefined)\s*\|\s*/g, '');
	const m = /^[\p{L}_$][\p{L}\p{N}_$.]*/u.exec(s);
	if (!m) {
		return undefined;
	}
	const rest = s.slice(m[0].length).trim();
	// `List<User>`, `User[]`, `Dict[str, User]`: a collection, not the element.
	if (rest.startsWith('[]') || /^[<[]/.test(rest) && /^(?:List|Set|Map|Dict|Array|Collection|Iterable|Iterator|Vec|HashMap|HashSet|Sequence|Tuple|dict|list|set|tuple|IEnumerable|IList|ICollection)$/.test(m[0].split('.').pop()!)) {
		return undefined;
	}
	return m[0].split('.').pop();
}

const SELF = new Set(['self', 'this', 'cls', 'mcs']);

/** A function's parameters as written for its language: `(int id, String name)`, `(id: number)`, `(id int)`. */
export function paramLabels(fn: FuncFact, lang: Lang): string[] {
	const infos = fn.paramInfo?.length ? fn.paramInfo.map(p => [p.name, p.typeText] as const) : Object.entries(fn.params);
	return infos.filter(([n]) => !SELF.has(n)).map(([name, type]) => {
		if (!type) {
			return name;
		}
		return lang === 'java' ? `${type} ${name}` : lang === 'go' ? `${name} ${type}` : `${name}: ${type}`;
	});
}

/** The parameters as one text: `(int id, String name)`. */
export function paramList(fn: FuncFact, lang: Lang): string {
	return `(${paramLabels(fn, lang).join(', ')})`;
}

/** What a method adds to its name in the list: `(id: number): User`. */
export function signatureDetail(fn: FuncFact, lang: Lang): string {
	return paramList(fn, lang) + (fn.returns && fn.returns !== 'void' ? `: ${fn.returns}` : '');
}

/** The names a constructor goes by: not offered as members. */
export const isConstructorName = (name: string) => name === '<init>' || name === '__init__' || name === 'constructor' || name === 'initialize' || name === 'new' || name === '__construct';

/** VS Code's `CompletionItemKind` numbers, which is what the canvas expects (see ide.ts there). */
export const Kind = { Method: 1, Function: 2, Constructor: 3, Field: 4, Variable: 5, Class: 6, Interface: 7, Module: 8, Property: 9, Enum: 12, Keyword: 13, Constant: 20, Struct: 21 } as const;

export interface Suggestion {
	label: string;
	kind: number;
	detail?: string;
	insertText: string;
	snippet: boolean;
	sortText: string;
}

export interface Place {
	file: string;
	line: number;
	column?: number;
	/** Inside the card being edited (1-based, the card's own lines). */
	cardLine?: number;
	cardColumn?: number;
	label: string;
}

/**
 * The call whose parentheses are still open at the cursor (`repo.save(a, ` → save on repo, second argument), or none.
 * `segs` is the receiver chain (empty for a bare call).
 */
export function callBefore(before: string): { name: string; segs: Seg[]; active: number } | undefined {
	let depth = 0;
	let open = -1;
	for (let i = before.length - 1; i >= 0; i--) {
		const c = before[i];
		if (c === ')' || c === ']' || c === '}') {
			depth++;
		} else if (c === '(' || c === '[' || c === '{') {
			if (depth === 0) {
				if (c !== '(') {
					return undefined; // inside an array or a block, not an argument list
				}
				open = i;
				break;
			}
			depth--;
		}
	}
	if (open < 0) {
		return undefined;
	}
	let active = 0;
	let level = 0;
	for (const c of before.slice(open + 1)) {
		if (c === '(' || c === '[' || c === '{') {
			level++;
		} else if (c === ')' || c === ']' || c === '}') {
			level--;
		} else if (c === ',' && level === 0) {
			active++;
		}
	}
	const head = before.slice(0, open);
	const chain = chainBefore(head);
	if (chain) {
		return chain.partial ? { name: chain.partial, segs: chain.segs, active } : undefined;
	}
	const name = /[\p{L}_$][\p{L}\p{N}_$]*$/u.exec(head)?.[0];
	return name ? { name, segs: [], active } : undefined;
}
