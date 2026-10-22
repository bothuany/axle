/*---------------------------------------------------------------------------------------------
 *  Insilode type model: reading a declared type as written (`Map<String, List<UserDto>>`,
 *  `string[]`, `Optional[User]`, `User | null`) and unwrapping it to the workspace types it is
 *  made of, with how many of them it holds. Collections, optionals, response wrappers and
 *  framework generics are seen through; types that do not resolve to the workspace are dropped.
 *--------------------------------------------------------------------------------------------*/

import type { Collection } from './model';

export interface TypeExpr {
	/** Last segment of the name as written (`java.util.List` → List). Empty for an opaque type (object literal, function). */
	name: string;
	/** The name as written, with its qualifier. */
	qualified: string;
	args: TypeExpr[];
	/** Array dimensions: `X[]` is 1. */
	array: number;
	/** `X?` or a union with null/undefined/None. */
	nullable: boolean;
	/** A union or intersection: the members are `args`. */
	union?: boolean;
}

const OPAQUE: TypeExpr = { name: '', qualified: '', args: [], array: 0, nullable: false };

/** Things that hold many of their argument. */
const MANY = new Set([
	'List', 'ArrayList', 'LinkedList', 'Set', 'HashSet', 'LinkedHashSet', 'TreeSet', 'SortedSet', 'NavigableSet', 'Collection', 'Iterable', 'Iterator',
	'Queue', 'Deque', 'ArrayDeque', 'Stack', 'Vector', 'Stream', 'Flux', 'Page', 'Slice', 'PageImpl', 'Array', 'ReadonlyArray', 'Sequence', 'Observable',
	'Map', 'HashMap', 'LinkedHashMap', 'TreeMap', 'SortedMap', 'ConcurrentHashMap', 'EnumMap', 'Record', 'MutableMapping', 'Mapping',
	'list', 'set', 'frozenset', 'tuple', 'dict', 'Dict', 'FrozenSet', 'Tuple', 'DefaultDict',
	'IEnumerable', 'IList', 'ICollection', 'IReadOnlyList', 'IReadOnlyCollection', 'IQueryable', 'Dictionary', 'IDictionary', 'ISet', 'ImmutableArray', 'IAsyncEnumerable',
	'Vec', 'VecDeque', 'BTreeMap', 'BTreeSet',
]);

/** Things that may hold nothing. */
const OPTIONAL = new Set(['Optional', 'OptionalInt', 'Maybe', 'Option', 'Nullable', 'Lazy']);

/** Wrappers that are not part of the data. */
const TRANSPARENT = new Set([
	'ResponseEntity', 'HttpEntity', 'Mono', 'CompletableFuture', 'Future', 'Callable', 'DeferredResult', 'WebAsyncTask', 'Promise', 'PromiseLike', 'Awaitable', 'Awaited',
	'Task', 'ValueTask', 'ActionResult', 'ApiResponse', 'EntityModel', 'CollectionModel', 'PagedModel', 'Partial', 'Required', 'Readonly', 'Omit', 'Pick', 'NonNullable',
	'Annotated', 'Mapped', 'Type', 'type', 'Final', 'ClassVar', 'Ref', 'WeakReference', 'AtomicReference', 'Box', 'Rc', 'Arc', 'Cow', 'Result', 'Either', 'Deferred', 'Supplier',
	'ObjectProvider', 'Provider', 'Class',
]);

const NULLISH = new Set(['null', 'undefined', 'None', 'void', 'Void', 'never', 'unknown', 'any', 'object', 'Object']);

/** Parses a declared type. Never throws: what it cannot read becomes an opaque type. */
export function parseType(text: string | undefined): TypeExpr {
	if (!text) {
		return OPAQUE;
	}
	const p = new Parser(text);
	try {
		return p.union();
	} catch {
		return OPAQUE;
	}
}

class Parser {
	private i = 0;
	constructor(private readonly s: string) { }

	private ws() {
		while (this.i < this.s.length && /\s/.test(this.s[this.i])) {
			this.i++;
		}
	}

	private peek() {
		this.ws();
		return this.s[this.i] ?? '';
	}

	private eat(ch: string) {
		if (this.peek() === ch) {
			this.i++;
			return true;
		}
		return false;
	}

	union(): TypeExpr {
		const members = [this.primary()];
		while (this.peek() === '|' || this.peek() === '&') {
			this.i++;
			members.push(this.primary());
		}
		if (members.length === 1) {
			return members[0];
		}
		return { name: '', qualified: '', args: members, array: 0, nullable: false, union: true };
	}

	private skipBalanced(open: string, close: string) {
		let depth = 0;
		while (this.i < this.s.length) {
			const ch = this.s[this.i++];
			if (ch === open) {
				depth++;
			} else if (ch === close && --depth === 0) {
				return;
			}
		}
	}

	private primary(): TypeExpr {
		let nullable = false;
		for (;;) {
			const ch = this.peek();
			if (ch === '@') {
				this.i++;
				this.ident();
				if (this.peek() === '(') {
					this.skipBalanced('(', ')');
				}
			} else if (this.s.startsWith('final ', this.i) || this.s.startsWith('readonly ', this.i) || this.s.startsWith('const ', this.i) || this.s.startsWith('in ', this.i) || this.s.startsWith('out ', this.i)) {
				this.i = this.s.indexOf(' ', this.i) + 1;
			} else {
				break;
			}
		}
		let expr: TypeExpr;
		const ch = this.peek();
		if (ch === '?') {
			// Java wildcard: `?`, `? extends X`, `? super X`.
			this.i++;
			const kw = this.ident();
			expr = kw === 'extends' || kw === 'super' ? this.primary() : OPAQUE;
		} else if (ch === '(') {
			// `(A | B)[]` or a function type.
			const start = this.i;
			this.i++;
			const inner = this.union();
			if (this.eat(')') && this.peek() !== '=') {
				expr = inner;
			} else {
				this.i = start;
				this.skipBalanced('(', ')');
				this.skipRest();
				expr = OPAQUE;
			}
		} else if (ch === '{') {
			this.skipBalanced('{', '}');
			expr = OPAQUE;
		} else if (ch === '[') {
			// TS tuple.
			this.i++;
			const members: TypeExpr[] = [];
			while (this.peek() && this.peek() !== ']') {
				members.push(this.union());
				if (!this.eat(',')) {
					break;
				}
			}
			this.eat(']');
			expr = { name: 'Array', qualified: 'Array', args: members, array: 0, nullable: false };
		} else if (ch === '"' || ch === "'" || ch === '`') {
			const q = ch;
			this.i++;
			while (this.i < this.s.length && this.s[this.i] !== q) {
				this.i++;
			}
			this.i++;
			expr = { ...OPAQUE, name: '' };
		} else {
			const qualified = this.qualifiedName();
			if (!qualified) {
				this.i = this.s.length;
				return OPAQUE;
			}
			const parts = qualified.split('.');
			let args: TypeExpr[] = [];
			// `List<X>` (Java, TS, C#), `list[X]` (Python): `X[]` is an array, not a generic.
			const next = this.peek() === '[' ? this.s.slice(this.i + 1).trimStart()[0] : '';
			if (this.peek() === '<' || (next && /[A-Za-z_"'[(]/.test(next))) {
				const open = this.s[this.i];
				this.i++;
				args = this.args(open === '<' ? '>' : ']');
			}
			expr = { name: parts[parts.length - 1], qualified, args, array: 0, nullable: false };
		}
		for (;;) {
			const c = this.peek();
			if (c === '[' && this.s[this.i + 1] === ']') {
				this.i += 2;
				expr = { ...expr, array: expr.array + 1 };
			} else if (c === '[' && /^\[\s*\]/.test(this.s.slice(this.i))) {
				this.i = this.s.indexOf(']', this.i) + 1;
				expr = { ...expr, array: expr.array + 1 };
			} else if (c === '?') {
				this.i++;
				nullable = true;
			} else if (this.s.startsWith('...', this.i)) {
				this.i += 3;
				expr = { ...expr, array: expr.array + 1 };
			} else if (c === '!') {
				this.i++;
			} else {
				break;
			}
		}
		if (NULLISH.has(expr.name) && !expr.args.length) {
			return { ...expr, nullable: true };
		}
		return nullable ? { ...expr, nullable: true } : expr;
	}

	private skipRest() {
		let depth = 0;
		while (this.i < this.s.length) {
			const ch = this.s[this.i];
			if (ch === '<' || ch === '(' || ch === '[' || ch === '{') {
				depth++;
			} else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') {
				if (depth === 0) {
					return;
				}
				depth--;
			} else if ((ch === ',' || ch === '|') && depth === 0) {
				return;
			}
			this.i++;
		}
	}

	private args(close: string): TypeExpr[] {
		const out: TypeExpr[] = [];
		while (this.peek() && this.peek() !== close) {
			out.push(this.union());
			if (!this.eat(',')) {
				break;
			}
		}
		this.eat(close);
		return out;
	}

	private ident() {
		this.ws();
		const m = /^[A-Za-z_$][\w$]*/.exec(this.s.slice(this.i));
		if (!m) {
			return '';
		}
		this.i += m[0].length;
		return m[0];
	}

	private qualifiedName() {
		let name = this.ident();
		if (!name) {
			return '';
		}
		while (this.s[this.i] === '.' && this.s[this.i + 1] !== '.' && /[A-Za-z_$]/.test(this.s[this.i + 1] ?? '')) {
			this.i++;
			name += '.' + this.ident();
		}
		return name;
	}
}

/** A workspace type a declared type is made of, and how it sits in it. */
export interface Leaf {
	id: string;
	many: boolean;
	optional: boolean;
}

/**
 * The workspace types a type expression is made of. `resolve` answers the id of a workspace type for a name as written (qualified
 * name second), or undefined; a name it cannot resolve is looked through if it is a known wrapper or collection, else only its
 * generic arguments are looked at (`ApiResponse<UserDto>` from a library still shows the UserDto).
 */
export function unwrap(expr: TypeExpr, resolve: (name: string, qualified: string) => string | undefined): Leaf[] {
	const out: Leaf[] = [];
	const walk = (e: TypeExpr, many: boolean, optional: boolean, depth: number) => {
		if (depth > 12) {
			return;
		}
		many ||= e.array > 0;
		optional ||= e.nullable;
		if (e.union) {
			for (const m of e.args) {
				if (NULLISH.has(m.name) && !m.args.length) {
					optional = true;
				}
			}
			for (const m of e.args) {
				if (!(NULLISH.has(m.name) && !m.args.length)) {
					walk(m, many, optional, depth + 1);
				}
			}
			return;
		}
		if (!e.name) {
			return;
		}
		const id = resolve(e.name, e.qualified);
		if (id) {
			out.push({ id, many, optional });
			for (const a of e.args) {
				walk(a, many, optional, depth + 1);
			}
			return;
		}
		if (MANY.has(e.name)) {
			many = true;
		} else if (OPTIONAL.has(e.name)) {
			optional = true;
		} else if (e.name === 'Annotated' || e.name === 'Mapped') {
			if (e.args[0]) {
				walk(e.args[0], many, optional, depth + 1);
			}
			return;
		} else if (!TRANSPARENT.has(e.name) && !e.args.length) {
			return; // a plain external type: String, UUID, int
		}
		for (const a of e.args) {
			walk(a, many, optional, depth + 1);
		}
	};
	walk(expr, false, false, 0);
	return out;
}

/** Of several leaves: the field's cardinality. */
export function collectionOf(leaves: readonly Leaf[], expr: TypeExpr): Collection {
	if (leaves.some(l => l.many)) {
		return 'many';
	}
	if (leaves.some(l => l.optional) || expr.nullable) {
		return 'optional';
	}
	return 'one';
}

/** The type as the diagram shows it: one line, packages stripped (`java.util.List<com.x.UserDto>` → `List<UserDto>`). */
export function displayType(text: string | undefined): string {
	if (!text) {
		return '';
	}
	return text.replace(/\s+/g, ' ').replace(/\b(?:[a-z_][\w]*\.)+(?=[A-Za-z_])/g, '').replace(/\s*,\s*/g, ', ').trim();
}
