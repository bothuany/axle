/*---------------------------------------------------------------------------------------------
 *  Axle polyglot index: JavaScript and TypeScript (and TSX). Classes with decorators (Nest,
 *  TypeORM), constructor-injected fields, functions and arrow functions, imports and require,
 *  calls, and Express-style route registrations with their inline handlers.
 *--------------------------------------------------------------------------------------------*/

import type { Ann, CallFact, FileFacts, FuncFact, ParamFact, TypeFact } from './model';
import { endLine, line, receiverText, same, splitType, stringValue, walk, type TsNode } from './ts';

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'options', 'head']);
/** Receivers that are HTTP clients, never an app or a router. */
const HTTP_CLIENT = /^(axios|ky|got|superagent|http|httpClient|apiClient|client)$/i;

function typeText(n: TsNode | null | undefined) {
	// type_annotation is ": Foo<Bar>"
	return n ? splitType(n.text.replace(/^:\s*/, '')) : { base: '', args: [] };
}

/** A type annotation as written without its colon, on one line: `Promise<UserDto[]>`. */
function rawTypeText(n: TsNode | null | undefined): string | undefined {
	const t = n?.text.replace(/^:\s*/, '').replace(/\s+/g, ' ').trim();
	return t || undefined;
}

/** TS accessibility keyword → UML visibility; public when nothing is written. */
function visibilityFrom(word: string | undefined): '+' | '-' | '#' {
	return word === 'private' ? '-' : word === 'protected' ? '#' : '+';
}

/** `interface Page<T, U>` → ['T', 'U']. */
function tsTypeParams(n: TsNode): string[] | undefined {
	const list = n.namedChildren.find(c => c.type === 'type_parameters');
	const names = (list?.namedChildren ?? []).filter(c => c.type === 'type_parameter').map(c => c.namedChildren.find(x => x.type === 'type_identifier')?.text ?? c.childForFieldName('name')?.text ?? '').filter(Boolean);
	return names.length ? names : undefined;
}

/** The members of an interface or an object type: `name?: Type;` as fields. */
function propertyFields(body: TsNode | null | undefined, t: TypeFact) {
	for (const m of body?.namedChildren ?? []) {
		if (m.type === 'property_signature') {
			const name = m.childForFieldName('name')?.text.replace(/^["']|["']$/g, '') ?? '';
			const ty = typeText(m.childForFieldName('type'));
			const raw = rawTypeText(m.childForFieldName('type'));
			if (name) {
				t.fields.push({
					name, type: ty.base, typeArgs: ty.args, annotations: [], line: line(m), typeText: raw, visibility: '+',
					isFinal: m.children.some(c => c.text === 'readonly') || undefined, optional: m.children.some(c => c.type === '?') || undefined,
				});
			}
		} else if (m.type === 'method_signature') {
			t.methods.push(m.childForFieldName('name')?.text ?? '?');
		}
	}
}

function decorators(n: TsNode): Ann[] {
	return n.namedChildren.filter(c => c.type === 'decorator').map(decorator);
}

function decorator(d: TsNode): Ann {
	{
		const expr = d.namedChildren[0];
		const target = expr?.type === 'call_expression' ? expr.childForFieldName('function') : expr;
		const full = target?.text ?? '';
		const ann: Ann = { name: full.split('.').pop() ?? full, full, named: {}, args: [] };
		if (expr?.type === 'call_expression') {
			for (const a of expr.childForFieldName('arguments')?.namedChildren ?? []) {
				ann.args.push(a.text);
				ann.value ??= stringValue(a);
				if (a.type === 'object') {
					for (const pair of a.namedChildren.filter(p => p.type === 'pair')) {
						ann.named[pair.childForFieldName('key')?.text.replace(/["']/g, '') ?? ''] = pair.childForFieldName('value')?.text ?? '';
					}
				}
			}
		}
		return ann;
	}
}

export function extractJs(root: TsNode, file: string, mtime: number): FileFacts {
	const facts: FileFacts = { file, lang: 'js', mtime, imports: {}, types: [], funcs: [], routes: [], prefixes: {}, globals: {} };
	const fnFrom = (n: TsNode, name: string, owner: TypeFact | undefined, anns: Ann[], exported: boolean): FuncFact => {
		const fn: FuncFact = {
			id: `${file}#${owner ? owner.name + '.' : ''}${name}@${line(n)}`,
			name, owner: owner?.name, file, line: line(n), endLine: endLine(n),
			params: {}, locals: {}, consts: {}, annotations: anns, calls: [],
			isPublic: !/^(private|#)/.test(n.text) && !name.startsWith('#'),
			isStatic: /^static\b/.test(n.text),
			exported,
		};
		const access = n.namedChildren.find(c => c.type === 'accessibility_modifier')?.text;
		fn.visibility = name.startsWith('#') ? '-' : visibilityFrom(access);
		fn.isAbstract = n.type === 'abstract_method_signature' || undefined;
		const returnType = rawTypeText(n.childForFieldName('return_type'));
		if (returnType) {
			fn.returns = returnType;
		}
		const info: ParamFact[] = [];
		for (const p of n.childForFieldName('parameters')?.namedChildren ?? []) {
			const pname = (p.childForFieldName('pattern') ?? p).text;
			const ptype = typeText(p.childForFieldName('type')).base;
			if (/^\w+$/.test(pname)) {
				fn.params[pname] = ptype;
				const raw = rawTypeText(p.childForFieldName('type'));
				if (raw) {
					info.push({ name: pname, typeText: p.type === 'optional_parameter' ? `${raw}?` : raw, anns: decorators(p).map(a => a.name) });
				}
			}
			// constructor(private readonly users: UsersService) → field
			if (owner && name === 'constructor' && p.namedChildren.some(c => c.type === 'accessibility_modifier' || c.text === 'readonly')) {
				owner.fields.push({
					name: pname, type: ptype, typeArgs: typeText(p.childForFieldName('type')).args, annotations: decorators(p), line: line(p), typeText: rawTypeText(p.childForFieldName('type')),
					visibility: visibilityFrom(p.namedChildren.find(c => c.type === 'accessibility_modifier')?.text), isFinal: p.namedChildren.some(c => c.text === 'readonly') || undefined,
				});
			} else if (owner && name === 'constructor') {
				const anns2 = decorators(p);
				if (anns2.length) {
					owner.fields.push({ name: pname, type: ptype, typeArgs: typeText(p.childForFieldName('type')).args, annotations: anns2, line: line(p), typeText: rawTypeText(p.childForFieldName('type')) });
				}
			}
		}
		if (info.length) {
			fn.paramInfo = info;
		}
		const body = n.childForFieldName('body');
		if (body) {
			jsCalls(body, fn, facts, fnFrom);
		}
		owner?.methods.push(name);
		facts.funcs.push(fn);
		return fn;
	};

	const declare = (n: TsNode, exported: boolean) => {
		if (n.type === 'class_declaration' || n.type === 'abstract_class_declaration' || n.type === 'class') {
			const t: TypeFact = {
				name: n.childForFieldName('name')?.text ?? 'default', file, line: line(n), endLine: endLine(n),
				kind: 'class', isAbstract: n.type === 'abstract_class_declaration', supers: [], superArgs: {},
				annotations: decorators(n), fields: [], methods: [], typeParams: tsTypeParams(n),
			};
			// Decorators can sit on the export statement instead.
			if (n.parent?.type === 'export_statement') {
				t.annotations.push(...decorators(n.parent));
				if (line(n.parent) < t.line) {
					t.declLine = line(n.parent);
				}
			}
			for (const h of n.namedChildren.filter(c => c.type === 'class_heritage')) {
				walk(h, x => {
					if (x.type === 'extends_clause' || x.type === 'implements_clause') {
						for (const v of x.namedChildren) {
							const { base, args } = splitType(v.text);
							if (base) {
								t.supers.push(base);
								if (args.length) {
									t.superArgs[base] = args;
								}
							}
						}
						return false;
					}
					return true;
				});
				// plain JS: class_heritage → identifier
				if (!t.supers.length && h.namedChildren[0]) {
					t.supers.push(splitType(h.namedChildren[0].text).base);
				}
			}
			let pending: Ann[] = [];
			for (const m of n.childForFieldName('body')?.namedChildren ?? []) {
				if (m.type === 'decorator') {
					pending.push(decorator(m));
					continue;
				}
				const anns = [...pending, ...decorators(m)];
				pending = [];
				if (m.type === 'method_definition' || m.type === 'abstract_method_signature' || m.type === 'method_signature') {
					fnFrom(m, m.childForFieldName('name')?.text ?? '?', t, anns, exported);
				} else if (m.type === 'public_field_definition' || m.type === 'field_definition') {
					const name = (m.childForFieldName('name') ?? m.childForFieldName('property'))?.text ?? '';
					const value = m.childForFieldName('value');
					if (value && (value.type === 'arrow_function' || value.type === 'function_expression')) {
						fnFrom(value, name, t, anns, exported);
					} else {
						const ty = typeText(m.childForFieldName('type'));
						t.fields.push({
							name, type: ty.base || (value?.type === 'new_expression' ? splitType(value.childForFieldName('constructor')?.text ?? '').base : ''), typeArgs: ty.args, annotations: anns, line: line(m), init: value?.text,
							typeText: rawTypeText(m.childForFieldName('type')), visibility: name.startsWith('#') ? '-' : visibilityFrom(m.namedChildren.find(c => c.type === 'accessibility_modifier')?.text),
							isStatic: m.children.some(c => c.type === 'static') || undefined, isFinal: m.children.some(c => c.text === 'readonly') || undefined, optional: m.children.some(c => c.type === '?') || undefined,
						});
					}
				}
			}
			facts.types.push(t);
		} else if (n.type === 'interface_declaration') {
			const t: TypeFact = { name: n.childForFieldName('name')?.text ?? '?', file, line: line(n), endLine: endLine(n), kind: 'interface', isAbstract: true, supers: [], superArgs: {}, annotations: [], fields: [], methods: [] };
			// `interface A extends B, C`: the type model draws the inheritance (the flow resolver never looked at it).
			for (const h of n.namedChildren.filter(c => c.type === 'extends_type_clause')) {
				for (const v of h.namedChildren) {
					const { base } = splitType(v.text);
					if (base) {
						t.supers.push(base);
					}
				}
			}
			propertyFields(n.childForFieldName('body'), t);
			t.typeParams = tsTypeParams(n);
			facts.types.push(t);
		} else if (n.type === 'type_alias_declaration' && n.childForFieldName('value')?.type === 'object_type') {
			// `type UserDto = { id: number; name: string }`: a type of fields, like an interface.
			const t: TypeFact = {
				name: n.childForFieldName('name')?.text ?? '?', file, line: line(n), endLine: endLine(n), kind: 'interface', declKind: 'alias', isAbstract: false, supers: [], superArgs: {}, annotations: [], fields: [], methods: [],
				typeParams: tsTypeParams(n),
			};
			propertyFields(n.childForFieldName('value'), t);
			facts.types.push(t);
		} else if (n.type === 'enum_declaration') {
			const t: TypeFact = { name: n.childForFieldName('name')?.text ?? '?', file, line: line(n), endLine: endLine(n), kind: 'enum', isAbstract: false, supers: [], superArgs: {}, annotations: [], fields: [], methods: [], enumConstants: [] };
			for (const m of n.childForFieldName('body')?.namedChildren ?? []) {
				const nm = m.type === 'enum_assignment' ? m.childForFieldName('name')?.text : m.type === 'property_identifier' || m.type === 'string' ? m.text : undefined;
				if (nm) {
					t.enumConstants!.push(nm.replace(/^["']|["']$/g, ''));
				}
			}
			facts.types.push(t);
		} else if (n.type === 'function_declaration' || n.type === 'generator_function_declaration') {
			fnFrom(n, n.childForFieldName('name')?.text ?? 'default', undefined, [], exported);
		} else if (n.type === 'lexical_declaration' || n.type === 'variable_declaration') {
			for (const d of n.namedChildren.filter(c => c.type === 'variable_declarator')) {
				const nameNode = d.childForFieldName('name');
				const name = nameNode?.text ?? '';
				const value = d.childForFieldName('value');
				if (!value) {
					continue;
				}
				// const { getOrders, save: persist } = require('./orders')
				if (nameNode?.type === 'object_pattern' && value.type === 'call_expression' && value.childForFieldName('function')?.text === 'require') {
					const src = stringValue(value.childForFieldName('arguments')?.namedChildren[0]);
					if (src) {
						for (const part of nameNode.namedChildren) {
							if (part.type === 'shorthand_property_identifier_pattern') {
								facts.imports[part.text] = `${src}:${part.text}`;
							} else if (part.type === 'pair_pattern') {
								const key = part.childForFieldName('key')?.text;
								const local = part.childForFieldName('value')?.text;
								if (key && local && /^\w+$/.test(local)) {
									facts.imports[local] = `${src}:${key}`;
								}
							}
						}
					}
					continue;
				}
				if (value.type === 'arrow_function' || value.type === 'function_expression' || value.type === 'function') {
					fnFrom(value, name, undefined, [], exported);
				} else if (value.type === 'call_expression' && value.childForFieldName('function')?.text === 'require') {
					const src = stringValue(value.childForFieldName('arguments')?.namedChildren[0]);
					if (src) {
						facts.imports[name] = `${src}:default`;
					}
				} else if (value.type === 'new_expression') {
					facts.globals[name] = splitType(value.childForFieldName('constructor')?.text ?? '').base;
				} else if (value.type === 'call_expression') {
					const callee = value.childForFieldName('function')?.text ?? '';
					facts.globals[name] = callee.split('.').pop() ?? callee; // express(), Router(), express.Router()
				} else if (name && /^\w+$/.test(name)) {
					const ty = typeText(d.childForFieldName('type'));
					if (ty.base) {
						facts.globals[name] = ty.base;
					}
				}
			}
		}
	};

	for (const c of root.namedChildren) {
		if (c.type === 'import_statement') {
			const src = stringValue(c.childForFieldName('source')) ?? '';
			walk(c, x => {
				if (x.type === 'import_specifier') {
					const name = x.childForFieldName('name')?.text ?? '';
					facts.imports[x.childForFieldName('alias')?.text ?? name] = `${src}:${name}`;
					return false;
				}
				if (x.type === 'namespace_import') {
					facts.imports[x.namedChildren[0]?.text ?? ''] = `${src}:*`;
					return false;
				}
				if (x.type === 'import_clause' && x.namedChildren[0]?.type === 'identifier') {
					facts.imports[x.namedChildren[0].text] = `${src}:default`;
				}
				return true;
			});
		} else if (c.type === 'export_statement') {
			const d = c.childForFieldName('declaration') ?? c.namedChildren.find(x => /declaration|class/.test(x.type));
			if (d) {
				declare(d, true);
			} else {
				const value = c.childForFieldName('value');
				if (value && (value.type === 'arrow_function' || value.type === 'function_expression')) {
					fnFrom(value, 'default', undefined, [], true);
				}
			}
		} else if (c.type === 'expression_statement') {
			const e = c.namedChildren[0];
			if (e?.type === 'call_expression') {
				route(e, facts, fnFrom);
			} else if (e?.type === 'assignment_expression') {
				// module.exports = router / exports.handler = (req, res) => {}
				const value = e.childForFieldName('right');
				const left = e.childForFieldName('left')?.text ?? '';
				if (value && (value.type === 'arrow_function' || value.type === 'function_expression')) {
					fnFrom(value, left.split('.').pop() ?? 'default', undefined, [], true);
				}
			}
		} else {
			declare(c, false);
		}
	}
	return facts;
}

type FnFrom = (n: TsNode, name: string, owner: TypeFact | undefined, anns: Ann[], exported: boolean) => FuncFact;

/** app.get('/x', auth, handler) / router.post('/x', (req, res) => {...}) / app.use('/api', router). True if it was one. */
function route(e: TsNode, facts: FileFacts, fnFrom: FnFrom): boolean {
	const f = e.childForFieldName('function');
	if (f?.type !== 'member_expression') {
		return false;
	}
	const verb = f.childForFieldName('property')?.text ?? '';
	const on = f.childForFieldName('object')?.text ?? '';
	const args = e.childForFieldName('arguments')?.namedChildren ?? [];
	const path = stringValue(args[0]);
	if (verb === 'use' && path !== undefined && args[1]) {
		facts.prefixes[args.at(-1)!.text] = path;
		return true;
	}
	// An HTTP client's request (`axios.post('/orders', body)`) has the same shape as a route; `api` stays a route (express.Router()).
	if (!VERBS.has(verb) || path === undefined || args.length < 2 || !/^\w+$/.test(on) || HTTP_CLIENT.test(on)) {
		return false;
	}
	const handler = args.at(-1)!;
	const v = verb === 'all' ? '*' : verb.toUpperCase();
	if (handler.type === 'arrow_function' || handler.type === 'function_expression' || handler.type === 'function') {
		const fn = fnFrom(handler, `${v} ${path}`, undefined, [], false);
		fn.inlineRoute = { verb: v, path };
		facts.routes.push({ verb: v, path, handler: fn.id, line: line(e), on });
	} else {
		facts.routes.push({ verb: v, path, handler: handler.text.replace(/\s+/g, ''), line: line(e), on });
	}
	return true;
}

function jsCalls(body: TsNode, fn: FuncFact, facts: FileFacts, fnFrom: FnFrom) {
	walk(body, n => {
		if (n.type === 'variable_declarator') {
			const name = n.childForFieldName('name')?.text ?? '';
			const value = n.childForFieldName('value');
			const ty = typeText(n.childForFieldName('type'));
			const str = stringValue(value);
			if (/^\w+$/.test(name) && str !== undefined) {
				fn.consts[name] = str;
			}
			if (/^\w+$/.test(name)) {
				if (ty.base) {
					fn.locals[name] = ty.base;
				} else if (value?.type === 'new_expression') {
					fn.locals[name] = splitType(value.childForFieldName('constructor')?.text ?? '').base;
				} else if (value?.type === 'await_expression' && value.namedChildren[0]?.type === 'new_expression') {
					fn.locals[name] = splitType(value.namedChildren[0].childForFieldName('constructor')?.text ?? '').base;
				}
			}
		} else if (n.type === 'call_expression') {
			const f = n.childForFieldName('function');
			const obj = f?.type === 'member_expression' ? f.childForFieldName('object') : undefined;
			if (obj?.type === 'call_expression' || (obj?.type === 'await_expression' && obj.namedChildren[0]?.type === 'call_expression')) {
				return true; // reported by the innermost call
			}
			// Routes registered inside a function (a router factory) still count; their inline handlers are their own functions.
			if (f?.type === 'member_expression' && route(n, facts, fnFrom)) {
				return false;
			}
			fn.calls.push(jsCall(n));
		} else if (n.type === 'new_expression') {
			const ctor = splitType(n.childForFieldName('constructor')?.text ?? '').base;
			if (ctor) {
				fn.calls.push({ name: '<init>', recv: ctor, line: line(n), strings: [] });
			}
		}
		return true;
	});
}

function jsCall(n: TsNode): CallFact {
	const f = n.childForFieldName('function');
	const args = n.childForFieldName('arguments');
	const strings = (a: TsNode | null) => (a?.namedChildren ?? []).map(x => stringValue(x)).filter((s): s is string => !!s?.trim());
	const call: CallFact = f?.type === 'member_expression'
		? { name: f.childForFieldName('property')?.text ?? '?', recv: receiverText(f.childForFieldName('object')), line: line(n), strings: strings(args) }
		: { name: f?.text ?? '?', line: line(n), strings: strings(args) };
	call.arg0 = args?.namedChildren[0]?.text;
	// prisma.user.findMany().then(...) / qb.where().getMany()
	const chain: string[] = [];
	let cur: TsNode = n;
	for (;;) {
		let up = cur.parent;
		if (up?.type === 'await_expression') {
			up = up.parent;
		}
		if (up?.type === 'member_expression' && up.parent?.type === 'call_expression' && (same(up.childForFieldName('object'), cur) || same(up.childForFieldName('object'), cur.parent))) {
			chain.push(up.childForFieldName('property')?.text ?? '?');
			cur = up.parent;
			call.strings.push(...strings(cur.childForFieldName('arguments')));
		} else {
			break;
		}
	}
	if (chain.length) {
		call.chain = chain;
	}
	return call;
}
