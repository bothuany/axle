/*---------------------------------------------------------------------------------------------
 *  Axle polyglot index: Go, PHP, Ruby and Rust. These extractors only need to know two things:
 *  where the functions and their call sites are, and which functions are registered as routes
 *  (Gin/Echo/Fiber/chi/net-http, Laravel/Symfony, Rails/Sinatra, axum/actix/Rocket). The links
 *  between functions are made by the shared resolver where it can, and by the language server
 *  (lspResolve.ts) where it cannot.
 *--------------------------------------------------------------------------------------------*/

import { joinPath, type CallFact, type FileFacts, type FuncFact, type Lang, type TypeFact } from './model';
import { endLine, line, splitType, stringValue, walk, type TsNode } from './ts';

type RouteVerb = string;

/** A node's position as a set key (node wrappers are fresh objects on every access). */
const posKey = (n: TsNode) => `${n.startPosition.row}:${n.startPosition.column}`;

/** Strings written in the four languages, without their quotes. */
function str(n: TsNode | null | undefined): string | undefined {
	if (!n) {
		return undefined;
	}
	switch (n.type) {
		case 'interpreted_string_literal':
		case 'raw_string_literal':
		case 'encapsed_string':
			return n.text.slice(1, -1);
		default:
			return stringValue(n);
	}
}

const BUILTIN_CALLS = new Set(['len', 'cap', 'make', 'new', 'append', 'copy', 'delete', 'panic', 'recover', 'print', 'close', 'string', 'int', 'int64', 'float64', 'byte', 'bool', 'error', 'isset', 'empty', 'count', 'array', 'unset', 'die', 'exit', 'puts', 'require', 'require_relative', 'raise', 'attr_accessor', 'attr_reader', 'attr_writer', 'include', 'extend', 'vec', 'Some', 'Ok', 'Err', 'Box', 'format']);

function mkType(facts: FileFacts, n: TsNode, name: string, kind: TypeFact['kind'], supers: string[] = [], stub = false): TypeFact {
	const t: TypeFact = { name, file: facts.file, line: line(n), endLine: endLine(n), kind, isAbstract: kind === 'interface', supers, superArgs: {}, annotations: [], fields: [], methods: [], ...(stub ? { stub: true } : {}) };
	facts.types.push(t);
	return t;
}

function mkFn(facts: FileFacts, n: TsNode, name: string, owner: TypeFact | undefined, extra: Partial<FuncFact> = {}): FuncFact {
	const fn: FuncFact = {
		id: `${facts.file}#${owner ? owner.name + '.' : ''}${name}@${line(n)}`,
		name, owner: owner?.name, file: facts.file, line: line(n), endLine: endLine(n),
		params: {}, locals: {}, consts: {}, annotations: [], calls: [],
		isPublic: !/^[a-z_]/.test(name) || facts.lang !== 'go',
		isStatic: false, exported: !owner, ...extra,
	};
	owner?.methods.push(name);
	facts.funcs.push(fn);
	return fn;
}

/** Receiver as the resolver wants it: `$this->svc` → this.svc, `h.svc` (Go receiver h) → self.svc. */
function recv(n: TsNode | null | undefined, self?: string): string | undefined {
	if (!n) {
		return undefined;
	}
	let t = n.text.replace(/\s+/g, '').replace(/->/g, '.').replace(/::/g, '.').replace(/\$/g, '').replace(/&\./g, '.').replace(/^([A-Z]\w*)\.new$/, '$1');
	if (t.length > 80 || /[()[\]{}"'`]/.test(t)) {
		// `UserService.new.all` / `Foo::new()`: the type itself.
		const ctor = t.match(/^([A-Z]\w*)(?:\.new)?(?:\(\))?$/);
		return ctor ? ctor[1] : undefined;
	}
	if (self && (t === self || t.startsWith(self + '.'))) {
		t = 'self' + t.slice(self.length);
	}
	return t;
}

interface Walker {
	/** True if the node was a route registration (handled, so not a call). */
	route(n: TsNode, fn: FuncFact | undefined): boolean;
	/** A call at this node, if it is one. */
	call(n: TsNode): CallFact | undefined;
	/** Function-like nodes that are never part of the enclosing function's own calls. */
	isDef(n: TsNode): boolean;
}

function collect(body: TsNode, fn: FuncFact | undefined, w: Walker) {
	walk(body, n => {
		if (n !== body && w.isDef(n)) {
			return false;
		}
		if (w.route(n, fn)) {
			return false;
		}
		const c = fn && w.call(n);
		if (c && c.name && !BUILTIN_CALLS.has(c.name)) {
			fn!.calls.push(c);
		}
		return true;
	});
}

const VERBS = /^(get|post|put|delete|patch|head|options|any|all|match)$/i;
const verbOf = (v: string): RouteVerb => /^(any|all|match|handle|handlefunc)$/i.test(v) ? '*' : v.toUpperCase();
const RESOURCE: [string, string, string][] = [['GET', '', 'index'], ['POST', '', 'store'], ['GET', '/{id}', 'show'], ['PUT', '/{id}', 'update'], ['DELETE', '/{id}', 'destroy']];

// ── Go ────────────────────────────────────────────────────────────────────────

export function extractGo(root: TsNode, file: string, mtime: number): FileFacts {
	const facts = blank(file, 'go', mtime);
	/** `r.GET("/x", h)`, `http.HandleFunc("/x", h)`, `mux.HandleFunc("GET /x", h)`: the route a call registers, if it is one. */
	const goRoute = (n: TsNode) => {
		if (n.type !== 'call_expression') {
			return undefined;
		}
		const f = n.childForFieldName('function');
		if (f?.type !== 'selector_expression') {
			return undefined;
		}
		const verb = f.childForFieldName('field')?.text ?? '';
		const args = n.childForFieldName('arguments')?.namedChildren ?? [];
		const written = str(args[0]);
		if (written === undefined || args.length < 2 || !GO_ROUTE_VERB.test(verb)) {
			return undefined;
		}
		// net/http (Go 1.22) patterns: "GET /users/{id}". Anything else must look like a path, so
		// `cache.Get("key", &out)` and `cron.AddFunc("@daily", fn)` are ordinary calls.
		const pattern = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/.*)$/.exec(written);
		if (!pattern && !written.startsWith('/')) {
			return undefined;
		}
		return { verb: pattern ? pattern[1] : verbOf(verb), path: pattern ? pattern[2] : written, on: f.childForFieldName('operand')?.text ?? '', handler: args.at(-1)! };
	};
	const route = (n: TsNode, fn: FuncFact | undefined): boolean => {
		const r = goRoute(n);
		if (!r) {
			return false;
		}
		const target = r.handler.type === 'func_literal' ? inline(facts, r.handler, r.verb, r.path, goParams) : r.handler.text.replace(/\s+/g, '');
		facts.routes.push({ verb: r.verb, path: r.path, handler: typeof target === 'string' ? target : target.id, line: line(n), on: r.on });
		void fn;
		return true;
	};
	const w: Walker = {
		route,
		isDef: n => n.type === 'func_literal' && isRegistered(n),
		call: n => {
			if (n.type !== 'call_expression') {
				return undefined;
			}
			const f = n.childForFieldName('function');
			if (f?.type === 'identifier') {
				return { name: f.text, line: line(n), strings: [] };
			}
			if (f?.type === 'selector_expression') {
				return { name: f.childForFieldName('field')?.text ?? '', recv: recv(f.childForFieldName('operand'), selfName), line: line(n), strings: [] };
			}
			return undefined;
		},
	};
	let selfName: string | undefined;
	const registered = new Set<string>();
	const isRegistered = (n: TsNode) => registered.has(posKey(n));
	// Mark inline handlers before their parent's calls are collected: only literals a route really takes.
	walk(root, n => {
		const r = goRoute(n);
		if (r?.handler.type === 'func_literal') {
			registered.add(posKey(r.handler));
		}
	});

	// api := r.Group("/api"): routes registered on `api` get the prefix (groups of groups add up).
	walk(root, n => {
		if (n.type === 'short_var_declaration' || n.type === 'assignment_statement') {
			const left = n.childForFieldName('left')?.namedChildren[0]?.text;
			const right = n.childForFieldName('right')?.namedChildren[0];
			const f = right?.type === 'call_expression' ? right.childForFieldName('function') : undefined;
			if (left && f?.type === 'selector_expression' && f.childForFieldName('field')?.text === 'Group') {
				const p = str(right!.childForFieldName('arguments')?.namedChildren[0]);
				if (p !== undefined) {
					facts.prefixes[left] = joinPath(facts.prefixes[f.childForFieldName('operand')?.text ?? ''] ?? '', p);
				}
			}
		}
	});

	for (const n of root.namedChildren) {
		if (n.type === 'type_declaration') {
			for (const spec of n.namedChildren.filter(c => c.type === 'type_spec')) {
				const name = spec.childForFieldName('name')?.text;
				const ty = spec.childForFieldName('type');
				if (!name || !ty) {
					continue;
				}
				const t = mkType(facts, spec, name, ty.type === 'interface_type' ? 'interface' : 'class');
				if (ty.type === 'struct_type') {
					t.declKind = 'struct';
				}
				walk(ty, f => {
					if (f.type === 'field_declaration') {
						const type = f.childForFieldName('type');
						const names = f.childrenForFieldName('name');
						for (const nm of names.length ? names : type ? [type] : []) {
							const fname = nm.text.replace(/^\*/, '');
							t.fields.push({
								name: fname, type: type ? splitType(type.text.replace(/^[*\[\]]+/, '')).base : '', typeArgs: [], annotations: [], line: line(f),
								typeText: type ? goType(type.text) : undefined, visibility: /^[A-Z]/.test(fname) ? '+' : '-',
							});
						}
						return false;
					}
					return true;
				});
			}
		} else if (n.type === 'function_declaration' || n.type === 'method_declaration') {
			const name = n.childForFieldName('name')?.text ?? '?';
			let owner: TypeFact | undefined;
			selfName = undefined;
			const rcv = n.childForFieldName('receiver')?.namedChildren[0];
			if (rcv) {
				const tn = splitType((rcv.childForFieldName('type')?.text ?? '').replace(/^\*/, '')).base;
				owner = facts.types.find(t => t.name === tn) ?? mkType(facts, rcv, tn, 'class', [], true);
				selfName = rcv.childForFieldName('name')?.text;
			}
			const fn = mkFn(facts, n, name, owner);
			goParams(n, fn);
			const body = n.childForFieldName('body');
			if (body) {
				collect(body, fn, w);
			}
		}
	}
	return facts;
}

const GO_ROUTE_VERB = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|Get|Post|Put|Delete|Patch|Head|Options|Any|Handle|HandleFunc|Method|ANY|Match)$/;

/** A Go type in the form the type model reads: `[]*User` → `User?[]`, `map[string]User` → `Map<string, User>`, `*User` → `User?` (a pointer may be nil). */
function goType(text: string): string {
	const t = text.replace(/\s+/g, ' ').trim();
	if (t.startsWith('*')) {
		return `${goType(t.slice(1))}?`;
	}
	if (t.startsWith('[]')) {
		return `${goType(t.slice(2))}[]`;
	}
	const m = /^map\[([^\]]+)\](.+)$/.exec(t);
	return m ? `Map<${goType(m[1])}, ${goType(m[2])}>` : t;
}

function goParams(n: TsNode, fn: FuncFact) {
	for (const p of n.childForFieldName('parameters')?.namedChildren ?? []) {
		const ty = p.childForFieldName('type');
		for (const nm of p.childrenForFieldName('name')) {
			if (ty) {
				fn.params[nm.text] = splitType(ty.text.replace(/^[*\[\]]+/, '')).base;
				(fn.paramInfo ??= []).push({ name: nm.text, typeText: goType(ty.text), anns: [] });
			}
		}
	}
	const result = n.childForFieldName('result');
	if (result) {
		// `(*User, error)`: the first value is the one that counts.
		fn.returns = goType(result.type === 'parameter_list' ? (result.namedChildren[0]?.childForFieldName('type')?.text ?? result.namedChildren[0]?.text ?? '') : result.text);
	}
	fn.visibility = /^[A-Z]/.test(fn.name) ? '+' : '-';
}

// ── PHP ───────────────────────────────────────────────────────────────────────

export function extractPhp(root: TsNode, file: string, mtime: number): FileFacts {
	const facts = blank(file, 'php', mtime);
	const w: Walker = {
		isDef: n => n.type === 'anonymous_function' || n.type === 'arrow_function' ? registeredPhp.has(posKey(n)) : false,
		route: () => false,
		call: n => {
			if (n.type === 'function_call_expression') {
				const f = n.childForFieldName('function');
				return f ? { name: f.text.split('\\').pop()!, line: line(n), strings: [] } : undefined;
			}
			if (n.type === 'member_call_expression' || n.type === 'nullsafe_member_call_expression') {
				return { name: n.childForFieldName('name')?.text ?? '', recv: recv(n.childForFieldName('object')), line: line(n), strings: [] };
			}
			if (n.type === 'scoped_call_expression') {
				const scope = n.childForFieldName('scope')?.text ?? '';
				return { name: n.childForFieldName('name')?.text ?? '', recv: scope === 'static' ? 'self' : scope, line: line(n), strings: [] };
			}
			return undefined;
		},
	};
	const registeredPhp = new Set<string>();

	/** Route::get('/x', [C::class, 'm']) and Route::prefix('api')->group(fn) */
	const routes = (n: TsNode, prefix: string, fn?: FuncFact) => {
		walk(n, c => {
			if (c.type === 'member_call_expression' && c.childForFieldName('name')?.text === 'group') {
				// Route::prefix('api')->middleware('x')->group(function () { ... })
				let p = prefix;
				for (let cur: TsNode | null = c.childForFieldName('object'); cur; cur = cur.type === 'member_call_expression' ? cur.childForFieldName('object') : null) {
					const nm = cur.childForFieldName('name')?.text;
					const a = cur.childForFieldName('arguments')?.namedChildren ?? [];
					if (nm === 'prefix') {
						p = joinPath(p, str(a[0]?.namedChildren[0]) ?? '');
					}
					if (cur.type === 'scoped_call_expression') {
						break;
					}
				}
				const body = (c.childForFieldName('arguments')?.namedChildren ?? []).map(a => a.namedChildren[0]).find(x => x?.type === 'anonymous_function' || x?.type === 'arrow_function');
				if (body) {
					registeredPhp.add(posKey(body));
					routes(body, p, fn);
				}
				return false;
			}
			if (c.type !== 'scoped_call_expression' || c.childForFieldName('scope')?.text !== 'Route') {
				return true;
			}
			const verb = c.childForFieldName('name')?.text ?? '';
			const args = (c.childForFieldName('arguments')?.namedChildren ?? []).map(a => a.namedChildren[0]);
			const pathArg = str(args[0]);
			if (verb === 'resource' || verb === 'apiResource') {
				const ctl = (args[1]?.text ?? '').match(/(\w+)::class/)?.[1] ?? (str(args[1]) ?? '').replace(/^.*\\/, '');
				for (const [v, suffix, action] of RESOURCE) {
					facts.routes.push({ verb: v, path: joinPath(prefix, pathArg ?? '', suffix), handler: `${ctl}.${action}`, line: line(c) });
				}
				return false;
			}
			if (!VERBS.test(verb) || pathArg === undefined || args.length < 2) {
				return true;
			}
			const h = args[1]!;
			let handler: string | undefined;
			if (h.type === 'array_creation_expression') {
				const parts = h.namedChildren.map(x => x.namedChildren[0]);
				const cls = (parts[0]?.text ?? '').match(/(\w+)::class/)?.[1] ?? str(parts[0]);
				handler = cls && str(parts[1]) ? `${cls.replace(/^.*\\/, '')}.${str(parts[1])}` : undefined;
			} else if (str(h)) {
				const [cls, m] = str(h)!.replace(/^.*\\/, '').split('@');
				handler = m ? `${cls}.${m}` : cls;
			} else if (h.type === 'anonymous_function' || h.type === 'arrow_function') {
				registeredPhp.add(posKey(h));
				const f = mkFn(facts, h, `${verbOf(verb)} ${joinPath(prefix, pathArg)}`, undefined, { exported: false, inlineRoute: { verb: verbOf(verb), path: joinPath(prefix, pathArg) } });
				const b = h.childForFieldName('body');
				if (b) {
					collect(b, f, w);
				}
				handler = f.id;
			}
			if (handler) {
				facts.routes.push({ verb: verbOf(verb), path: joinPath(prefix, pathArg), handler, line: line(c) });
			}
			return false;
		});
	};

	const classAttrRoute = (attrs: TsNode | null | undefined): string => {
		const a = phpAttr(attrs, 'Route');
		return a?.value ?? '';
	};
	const visit = (n: TsNode) => {
		if (n.type === 'class_declaration' || n.type === 'trait_declaration') {
			const name = n.childForFieldName('name')?.text ?? '?';
			const supers: string[] = [];
			for (const c of n.namedChildren) {
				if (c.type === 'base_clause' || c.type === 'class_interface_clause') {
					supers.push(...c.namedChildren.map(x => x.text.replace(/^.*\\/, '')));
				}
			}
			const t = mkType(facts, n, name, 'class', supers);
			const prefix = classAttrRoute(n.namedChildren.find(c => c.type === 'attribute_list'));
			for (const m of n.childForFieldName('body')?.namedChildren ?? []) {
				if (m.type === 'property_declaration') {
					const ty = m.namedChildren.find(c => c.type !== 'visibility_modifier' && c.type !== 'property_element' && c.type !== 'static_modifier' && c.type !== 'readonly_modifier' && c.type !== 'attribute_list');
					const vis = m.namedChildren.find(c => c.type === 'visibility_modifier')?.text;
					for (const el of m.namedChildren.filter(c => c.type === 'property_element')) {
						t.fields.push({
							name: el.text.replace(/^\$/, '').split('=')[0].trim(), type: ty ? splitType(ty.text.replace(/^\?/, '')).base : '', typeArgs: [], annotations: [], line: line(m),
							typeText: ty ? phpType(ty.text) : undefined, visibility: phpVisibility(vis), isStatic: m.namedChildren.some(c => c.type === 'static_modifier') || undefined,
						});
					}
				} else if (m.type === 'method_declaration') {
					const mname = m.childForFieldName('name')?.text ?? '?';
					const fn = mkFn(facts, m, mname, t, { isPublic: !m.namedChildren.some(c => c.type === 'visibility_modifier' && /private|protected/.test(c.text)), isStatic: m.namedChildren.some(c => c.type === 'static_modifier') });
					for (const p of m.childForFieldName('parameters')?.namedChildren ?? []) {
						const pn = p.childForFieldName('name')?.text.replace(/^\$/, '');
						const pt = p.childForFieldName('type');
						if (pn && pt) {
							fn.params[pn] = splitType(pt.text.replace(/^\?/, '')).base;
							(fn.paramInfo ??= []).push({ name: pn, typeText: phpType(pt.text), anns: [] });
							// Constructor promotion: public function __construct(private UserService $svc)
							if (mname === '__construct' && p.type === 'property_promotion_parameter') {
								t.fields.push({ name: pn, type: fn.params[pn], typeArgs: [], annotations: [], line: line(p), typeText: phpType(pt.text), visibility: phpVisibility(p.namedChildren.find(c => c.type === 'visibility_modifier')?.text), isFinal: p.namedChildren.some(c => c.type === 'readonly_modifier') || undefined });
							}
						}
					}
					const rt = m.childForFieldName('return_type');
					if (rt) {
						fn.returns = phpType(rt.text.replace(/^:\s*/, ''));
					}
					fn.visibility = phpVisibility(m.namedChildren.find(c => c.type === 'visibility_modifier')?.text);
					const body = m.childForFieldName('body');
					if (body) {
						collect(body, fn, w);
					}
					const attr = phpAttr(m.namedChildren.find(c => c.type === 'attribute_list'), 'Route');
					if (attr?.value !== undefined) {
						const verbs = (attr.methods.length ? attr.methods : ['*']);
						for (const v of verbs) {
							facts.routes.push({ verb: v, path: joinPath(prefix, attr.value), handler: `${name}.${mname}`, line: line(m) });
						}
					}
				}
			}
		} else if (n.type === 'interface_declaration' || n.type === 'enum_declaration') {
			const t = mkType(facts, n, n.childForFieldName('name')?.text ?? '?', n.type === 'enum_declaration' ? 'enum' : 'interface');
			for (const c of n.namedChildren) {
				if (c.type === 'base_clause' || c.type === 'class_interface_clause') {
					t.supers.push(...c.namedChildren.map(x => x.text.replace(/^.*\\/, '')));
				}
			}
			for (const m of n.childForFieldName('body')?.namedChildren ?? []) {
				if (m.type === 'enum_case') {
					(t.enumConstants ??= []).push(m.childForFieldName('name')?.text ?? '');
				}
			}
		} else if (n.type === 'function_definition') {
			const fn = mkFn(facts, n, n.childForFieldName('name')?.text ?? '?', undefined);
			const body = n.childForFieldName('body');
			if (body) {
				collect(body, fn, w);
			}
		}
	};
	for (const n of root.namedChildren) {
		visit(n);
		if (n.type === 'expression_statement') {
			routes(n, '');
		}
	}
	return facts;
}

/** `?UserDto` → `UserDto?`, a leading backslash and namespaces dropped; `array` stays `array` (the shape of its items is in a docblock the index does not read). */
function phpType(text: string): string {
	const t = text.replace(/\s+/g, ' ').trim().replace(/\\+/g, '.').replace(/^\./, '');
	return t.startsWith('?') ? `${t.slice(1)}?` : t;
}

const phpVisibility = (word: string | undefined): '+' | '-' | '#' => (word === 'private' ? '-' : word === 'protected' ? '#' : '+');

function phpAttr(list: TsNode | null | undefined, name: string): { value?: string; methods: string[] } | undefined {
	if (!list) {
		return undefined;
	}
	let found: { value?: string; methods: string[] } | undefined;
	walk(list, n => {
		if (n.type === 'attribute' && n.namedChildren[0]?.text.split('\\').pop() === name) {
			const args = n.childForFieldName('parameters')?.namedChildren ?? [];
			const value = str(args.find(a => !a.childForFieldName('name'))?.namedChildren[0]);
			const methods = args.filter(a => a.childForFieldName('name')?.text === 'methods').flatMap(a => [...a.text.matchAll(/['"]([A-Za-z]+)['"]/g)].map(m => m[1].toUpperCase()));
			found = { value, methods };
		}
	});
	return found;
}

// ── Ruby ──────────────────────────────────────────────────────────────────────

/** A lone identifier where a value is expected (`audit`, `x = fetch_user`, `puts(load)`): a method call with no receiver or arguments. */
function isBareCall(n: TsNode): boolean {
	const parent = n.parent;
	if (!parent) {
		return false;
	}
	if (parent.type === 'assignment') {
		return posKey(parent.childForFieldName('right') ?? n) === posKey(n);
	}
	return ['body_statement', 'then', 'do_block', 'argument_list', 'binary', 'return', 'array', 'parenthesized_statements', 'conditional', 'if', 'unless'].includes(parent.type);
}

export function extractRuby(root: TsNode, file: string, mtime: number): FileFacts {
	const facts = blank(file, 'ruby', mtime);
	const registered = new Set<string>();
	/** Names assigned anywhere in the file's methods (`user = …`, block parameters): not calls when they stand alone. */
	const locals = new Set<string>();
	walk(root, n => {
		if (n.type === 'assignment' || n.type === 'operator_assignment') {
			const left = n.childForFieldName('left');
			if (left?.type === 'identifier') {
				locals.add(left.text);
			}
		} else if (n.type === 'block_parameters' || n.type === 'method_parameters' || n.type === 'lambda_parameters') {
			n.namedChildren.forEach(c => {
				const name = c.type === 'identifier' ? c : c.childForFieldName('name');
				if (name) {
					locals.add(name.text);
				}
			});
		}
	});
	const w: Walker = {
		isDef: n => (n.type === 'do_block' || n.type === 'block') && registered.has(posKey(n)),
		route: () => false,
		call: n => {
			if (n.type === 'call') {
				const name = n.childForFieldName('method')?.text;
				return name ? { name, recv: recv(n.childForFieldName('receiver')), line: line(n), strings: [] } : undefined;
			}
			// A bare word on its own line is a method call (`audit`, `greet`), unless it is a local variable.
			if (n.type === 'identifier' && isBareCall(n) && !locals.has(n.text)) {
				return { name: n.text, line: line(n), strings: [] };
			}
			return undefined;
		},
	};
	const argsOf = (c: TsNode) => c.childForFieldName('arguments')?.namedChildren ?? [];
	const pairValue = (args: TsNode[], k: string) => str(args.find(a => a.type === 'pair' && a.childForFieldName('key')?.text.replace(/:$/, '') === k)?.childForFieldName('value'));
	const rails = (n: TsNode, prefix: string, fn?: FuncFact) => {
		walk(n, c => {
			if (c.type !== 'call' || c.childForFieldName('receiver')) {
				return true;
			}
			const name = c.childForFieldName('method')?.text ?? '';
			const args = argsOf(c);
			const block = c.childForFieldName('block');
			if ((name === 'namespace' || name === 'scope') && block) {
				const seg = name === 'namespace' ? (args[0]?.text ?? '').replace(/^:/, '') : (pairValue(args, 'path') ?? str(args[0]) ?? '');
				registered.add(posKey(block));
				rails(block, joinPath(prefix, seg), fn);
				return false;
			}
			if ((name === 'resources' || name === 'resource') && args[0]) {
				const res = (args[0].text ?? '').replace(/^:/, '');
				const only = args.find(a => a.type === 'pair' && a.childForFieldName('key')?.text.replace(/:$/, '') === 'only')?.childForFieldName('value')?.text;
				const ctl = `${res.split('_').map(p => p[0].toUpperCase() + p.slice(1)).join('')}Controller`;
				const ACTIONS: [string, string, string][] = [['GET', '', 'index'], ['POST', '', 'create'], ['GET', '/:id', 'show'], ['PUT', '/:id', 'update'], ['DELETE', '/:id', 'destroy']];
				for (const [v, suffix, action] of ACTIONS) {
					if (!only || only.includes(action)) {
						facts.routes.push({ verb: v, path: joinPath(prefix, res, suffix), handler: `${ctl}.${action}`, line: line(c) });
					}
				}
				return false;
			}
			if (!/^(get|post|put|patch|delete|options|head|match|root)$/.test(name)) {
				return true;
			}
			const verb = verbOf(name === 'root' ? 'get' : name);
			const pathArg = name === 'root' ? '/' : str(args[0]);
			if (pathArg === undefined) {
				return true;
			}
			const to = pairValue(args, 'to');
			if (to && to.includes('#')) {
				const [c1, a1] = to.split('#');
				facts.routes.push({ verb, path: joinPath(prefix, pathArg), handler: `${c1.split('/').map(p => p[0].toUpperCase() + p.slice(1)).join('::').replace(/_(\w)/g, (_, x: string) => x.toUpperCase())}Controller.${a1}`, line: line(c) });
				return false;
			}
			// Sinatra: get '/hello' do ... end
			if (block) {
				registered.add(posKey(block));
				const f = mkFn(facts, block, `${verb} ${joinPath(prefix, pathArg)}`, undefined, { exported: false, inlineRoute: { verb, path: joinPath(prefix, pathArg) } });
				collect(block, f, w);
				facts.routes.push({ verb, path: joinPath(prefix, pathArg), handler: f.id, line: line(c) });
				return false;
			}
			return true;
		});
	};
	const visit = (n: TsNode, owner?: TypeFact) => {
		if (n.type === 'class' || n.type === 'module') {
			const name = (n.childForFieldName('name')?.text ?? '?').split('::').pop()!;
			const sup = n.childForFieldName('superclass')?.namedChildren[0]?.text.split('::').pop();
			const t = mkType(facts, n, name, 'class', sup ? [sup] : []);
			for (const m of n.childForFieldName('body')?.namedChildren ?? n.namedChildren) {
				visit(m, t);
			}
		} else if (n.type === 'method' || n.type === 'singleton_method') {
			const fn = mkFn(facts, n, n.childForFieldName('name')?.text ?? '?', owner, { isStatic: n.type === 'singleton_method' });
			const body = n.childForFieldName('body');
			if (body) {
				collect(body, fn, w);
				// @svc = UserService.new  →  a field of known type
				walk(body, a => {
					if (a.type === 'assignment' && owner) {
						const left = a.childForFieldName('left');
						const r = recv(a.childForFieldName('right'));
						if (left?.type === 'instance_variable' && r && /^[A-Z]\w*$/.test(r)) {
							owner.fields.push({ name: left.text.slice(1), type: r, typeArgs: [], annotations: [], line: line(a) });
						}
					}
				});
			}
		}
	};
	for (const n of root.namedChildren) {
		visit(n);
		if (n.type === 'call') {
			rails(n, '');
		}
	}
	return facts;
}

// ── Rust ──────────────────────────────────────────────────────────────────────

const RUST_VERBS = /^(get|post|put|delete|patch|head|options)$/;

/** A Rust type in the form the type model reads: references and lifetimes dropped, paths shortened (`std::vec::Vec<crate::dto::Address>` → `Vec<Address>`). */
function rustType(text: string | undefined): string | undefined {
	return text?.replace(/\s+/g, ' ').replace(/&(?:'\w+\s+)?(?:mut\s+)?/g, '').replace(/\b(?:\w+::)+/g, '').trim() || undefined;
}

export function extractRust(root: TsNode, file: string, mtime: number): FileFacts {
	const facts = blank(file, 'rust', mtime);
	const registered = new Set<string>();

	/** `get(h)`, `get(h).post(h2)`, `web::get().to(h)`: verb and handler pairs. */
	const verbs = (e: TsNode | null | undefined, out: [string, TsNode | undefined][] = []): [string, TsNode | undefined][] => {
		if (!e || e.type !== 'call_expression') {
			return out;
		}
		const f = e.childForFieldName('function');
		const args = e.childForFieldName('arguments')?.namedChildren ?? [];
		if (f?.type === 'identifier' && RUST_VERBS.test(f.text)) {
			out.push([f.text.toUpperCase(), args[0]]);
		} else if (f?.type === 'scoped_identifier' && RUST_VERBS.test(f.childForFieldName('name')?.text ?? '')) {
			out.push([f.childForFieldName('name')!.text.toUpperCase(), undefined]);
		} else if (f?.type === 'field_expression') {
			const m = f.childForFieldName('field')?.text ?? '';
			if (RUST_VERBS.test(m)) {
				out.push([m.toUpperCase(), args[0]]);
			} else if (m === 'to' && out.length === 0) {
				// web::get().to(handler): the verb is in the receiver
				const inner = verbs(f.childForFieldName('value'));
				for (const [v] of inner) {
					out.push([v, args[0]]);
				}
				return out;
			}
			verbs(f.childForFieldName('value'), out);
		}
		return out;
	};

	const w: Walker = {
		isDef: n => n.type === 'closure_expression' && registered.has(posKey(n)),
		route: (n, fn) => {
			if (n.type !== 'call_expression') {
				return false;
			}
			const f = n.childForFieldName('function');
			if (f?.type !== 'field_expression' || f.childForFieldName('field')?.text !== 'route') {
				return false;
			}
			const args = n.childForFieldName('arguments')?.namedChildren ?? [];
			const path = str(args[0]);
			if (path === undefined || !args[1]) {
				return false;
			}
			for (const [verb, h] of verbs(args[1])) {
				if (!h) {
					continue;
				}
				if (h.type === 'closure_expression') {
					registered.add(posKey(h));
					const fnx = mkFn(facts, h, `${verb} ${path}`, undefined, { exported: false, inlineRoute: { verb, path } });
					const b = h.childForFieldName('body');
					if (b) {
						collect(b, fnx, w);
					}
					facts.routes.push({ verb, path, handler: fnx.id, line: line(n) });
				} else {
					facts.routes.push({ verb, path, handler: h.text.replace(/\s+/g, '').replace(/::/g, '.'), line: line(n) });
				}
			}
			// The receiver chain may hold more routes: `.route(a).route(b)`.
			collect(f.childForFieldName('value')!, fn, w);
			return true;
		},
		call: n => {
			if (n.type !== 'call_expression') {
				return undefined;
			}
			const f = n.childForFieldName('function');
			if (f?.type === 'identifier') {
				return { name: f.text, line: line(n), strings: [] };
			}
			if (f?.type === 'scoped_identifier') {
				return { name: f.childForFieldName('name')?.text ?? '', recv: recv(f.childForFieldName('path')), line: line(n), strings: [] };
			}
			if (f?.type === 'field_expression') {
				return { name: f.childForFieldName('field')?.text ?? '', recv: recv(f.childForFieldName('value')), line: line(n), strings: [] };
			}
			return undefined;
		},
	};

	const fnItem = (n: TsNode, owner: TypeFact | undefined, attrs: TsNode[]) => {
		const name = n.childForFieldName('name')?.text ?? '?';
		const fn = mkFn(facts, n, name, owner, { isPublic: n.namedChildren.some(c => c.type === 'visibility_modifier') });
		for (const p of n.childForFieldName('parameters')?.namedChildren ?? []) {
			const pat = p.childForFieldName('pattern');
			const ty = p.childForFieldName('type');
			if (pat && ty) {
				fn.params[pat.text] = splitType(ty.text.replace(/^&(mut\s+)?/, '').replace(/^(Arc|Rc|Box|web::Data|Data|State)<(.*)>$/, '$2')).base;
				(fn.paramInfo ??= []).push({ name: pat.text, typeText: rustType(ty.text) ?? '', anns: [] });
			}
		}
		const ret = n.childForFieldName('return_type');
		if (ret) {
			fn.returns = rustType(ret.text);
		}
		fn.visibility = fn.isPublic ? '+' : '-';
		const body = n.childForFieldName('body');
		if (body) {
			collect(body, fn, w);
		}
		// Actix / Rocket: #[get("/users")]
		for (const a of attrs) {
			const id = a.namedChildren[0];
			const verb = id?.text.split('::').pop() ?? '';
			if (RUST_VERBS.test(verb)) {
				const path = str(a.namedChildren.find(c => c.type === 'token_tree')?.namedChildren.find(c => c.type === 'string_literal'));
				if (path !== undefined) {
					facts.routes.push({ verb: verb.toUpperCase(), path, handler: owner ? `${owner.name}.${name}` : fn.id, line: line(n) });
				}
			}
		}
	};
	const items = (list: TsNode[], owner?: TypeFact) => {
		let attrs: TsNode[] = [];
		for (const n of list) {
			if (n.type === 'attribute_item') {
				attrs.push(n.namedChildren[0]);
				continue;
			}
			if (n.type === 'function_item') {
				fnItem(n, owner, attrs);
			} else if (n.type === 'struct_item') {
				const t = mkType(facts, n, n.childForFieldName('name')?.text ?? '?', 'class');
				t.declKind = 'struct';
				for (const f of n.childForFieldName('body')?.namedChildren ?? []) {
					if (f.type === 'field_declaration') {
						t.fields.push({
							name: f.childForFieldName('name')?.text ?? '', type: splitType((f.childForFieldName('type')?.text ?? '').replace(/^&(mut\s+)?/, '').replace(/^(Arc|Rc|Box)<(.*)>$/, '$2')).base, typeArgs: [], annotations: [], line: line(f),
							typeText: rustType(f.childForFieldName('type')?.text), visibility: f.namedChildren.some(c => c.type === 'visibility_modifier') ? '+' : '-',
						});
					}
				}
			} else if (n.type === 'enum_item') {
				const t = mkType(facts, n, n.childForFieldName('name')?.text ?? '?', 'enum');
				for (const v of n.childForFieldName('body')?.namedChildren ?? []) {
					if (v.type === 'enum_variant') {
						(t.enumConstants ??= []).push(v.childForFieldName('name')?.text ?? '');
					}
				}
			} else if (n.type === 'trait_item') {
				mkType(facts, n, n.childForFieldName('name')?.text ?? '?', 'interface');
			} else if (n.type === 'impl_item') {
				const tn = splitType(n.childForFieldName('type')?.text ?? '').base;
				const t = facts.types.find(x => x.name === tn) ?? mkType(facts, n, tn, 'class', [], true);
				const trait = n.childForFieldName('trait')?.text;
				if (trait) {
					t.supers.push(splitType(trait).base);
				}
				items(n.childForFieldName('body')?.namedChildren ?? [], t);
			} else if (n.type === 'mod_item') {
				items(n.childForFieldName('body')?.namedChildren ?? [], owner);
			}
			attrs = [];
		}
	};
	items(root.namedChildren);
	return facts;
}

// ── shared ────────────────────────────────────────────────────────────────────

function blank(file: string, lang: Lang, mtime: number): FileFacts {
	return { file, lang, mtime, imports: {}, types: [], funcs: [], routes: [], prefixes: {}, globals: {} };
}


/** An inline handler (Go func literal): becomes a function of its own, named after its route. */
function inline(facts: FileFacts, lit: TsNode, verb: string, path: string, params: (n: TsNode, fn: FuncFact) => void): FuncFact {
	const fn = mkFn(facts, lit, `${verb} ${path}`, undefined, { exported: false, inlineRoute: { verb, path } });
	params(lit, fn);
	const body = lit.childForFieldName('body');
	if (body) {
		const w: Walker = {
			route: () => false,
			isDef: () => false,
			call: n => {
				if (n.type !== 'call_expression') {
					return undefined;
				}
				const f = n.childForFieldName('function');
				if (f?.type === 'identifier') {
					return { name: f.text, line: line(n), strings: [] };
				}
				return f?.type === 'selector_expression' ? { name: f.childForFieldName('field')?.text ?? '', recv: recv(f.childForFieldName('operand')), line: line(n), strings: [] } : undefined;
			},
		};
		collect(body, fn, w);
	}
	return fn;
}

