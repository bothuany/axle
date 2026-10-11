/*---------------------------------------------------------------------------------------------
 *  Axle polyglot index: Java. Classes, fields, methods, annotations and the calls inside each
 *  method, with the declared types of locals and parameters so calls can be resolved by type.
 *--------------------------------------------------------------------------------------------*/

import type { Ann, CallFact, FieldFact, FileFacts, FuncFact, ParamFact, TypeFact } from './model';
import { endLine, line, receiverText, same, splitType, stringValue, walk, type TsNode } from './ts';

function annotations(mods: TsNode | null | undefined): Ann[] {
	if (!mods) {
		return [];
	}
	return mods.namedChildren.filter(c => c.type === 'annotation' || c.type === 'marker_annotation').map(annotation);
}

function annotation(a: TsNode): Ann {
	const full = a.childForFieldName('name')?.text ?? '';
	const ann: Ann = { name: full.split('.').pop() ?? full, full, named: {}, args: [] };
	const list = a.childForFieldName('arguments');
	for (const arg of list?.namedChildren ?? []) {
		if (arg.type === 'element_value_pair') {
			const key = arg.childForFieldName('key')?.text ?? '';
			const value = arg.childForFieldName('value');
			ann.named[key] = value?.text ?? '';
			if (key === 'value' || key === 'path') {
				ann.value ??= firstString(value);
			}
		} else {
			ann.args.push(arg.text);
			ann.value ??= firstString(arg);
		}
	}
	return ann;
}

/** `"/x"` or `{"/x", "/y"}` → "/x". */
function firstString(n: TsNode | null | undefined): string | undefined {
	if (!n) {
		return undefined;
	}
	const s = stringValue(n);
	if (s !== undefined) {
		return s;
	}
	if (n.type === 'element_value_array_initializer') {
		return firstString(n.namedChildren[0]);
	}
	return undefined;
}

function modifiers(n: TsNode) {
	return n.namedChildren.find(c => c.type === 'modifiers');
}

function typeOf(n: TsNode | null | undefined) {
	return n ? splitType(n.text) : { base: '', args: [] };
}

/** A type exactly as written, on one line. */
const rawType = (n: TsNode | null | undefined) => n?.text.replace(/\s+/g, ' ').trim();

/** UML visibility from the modifier keywords (annotations skipped); `fallback` is what the language implies when none is written. */
function visibilityOf(mods: TsNode | null | undefined, fallback: '+' | '-' | '#' | '~'): '+' | '-' | '#' | '~' {
	for (const c of mods?.children ?? []) {
		if (c.type === 'public') {
			return '+';
		}
		if (c.type === 'private') {
			return '-';
		}
		if (c.type === 'protected') {
			return '#';
		}
	}
	return fallback;
}

const hasModifier = (mods: TsNode | null | undefined, word: string) => !!mods?.children.some(c => c.type === word);

/** `<T extends Foo, U>` → ['T', 'U']. */
function typeParams(n: TsNode): string[] | undefined {
	const list = n.namedChildren.find(c => c.type === 'type_parameters');
	const names = (list?.namedChildren ?? []).filter(c => c.type === 'type_parameter').map(c => c.namedChildren.find(x => x.type === 'type_identifier')?.text ?? '').filter(Boolean);
	return names.length ? names : undefined;
}

/** Simple name of the type declaration around a nested one. */
function outerOf(n: TsNode): string | undefined {
	for (let p = n.parent; p; p = p.parent) {
		if (p.type === 'class_declaration' || p.type === 'interface_declaration' || p.type === 'enum_declaration' || p.type === 'record_declaration') {
			return p.childForFieldName('name')?.text;
		}
	}
	return undefined;
}

export function extractJava(root: TsNode, file: string, mtime: number): FileFacts {
	const facts: FileFacts = { file, lang: 'java', mtime, imports: {}, types: [], funcs: [], routes: [], prefixes: {}, globals: {} };
	for (const c of root.namedChildren) {
		if (c.type === 'package_declaration') {
			facts.module = c.namedChildren.find(x => x.type === 'scoped_identifier' || x.type === 'identifier')?.text;
		} else if (c.type === 'import_declaration') {
			const name = c.namedChildren.find(x => x.type === 'scoped_identifier' || x.type === 'identifier')?.text;
			if (name && !c.text.includes('*')) {
				facts.imports[name.split('.').pop()!] = name;
			} else if (name && !/^import\s+staticb/.test(c.text)) {
				(facts.starImports ??= []).push(name);
			}
		}
	}
	walk(root, n => {
		if (n.type === 'class_declaration' || n.type === 'interface_declaration' || n.type === 'enum_declaration' || n.type === 'record_declaration') {
			typeDecl(n, facts);
		}
	});
	return facts;
}

function typeDecl(n: TsNode, facts: FileFacts) {
	const name = n.childForFieldName('name')?.text ?? '?';
	const mods = modifiers(n);
	const t: TypeFact = {
		name, file: facts.file, line: line(n), endLine: endLine(n),
		kind: n.type === 'interface_declaration' ? 'interface' : n.type === 'enum_declaration' ? 'enum' : 'class',
		isAbstract: !!mods?.text.match(/\babstract\b/),
		supers: [], superArgs: {}, annotations: annotations(mods), fields: [], methods: [],
		declKind: n.type === 'record_declaration' ? 'record' : undefined,
		outer: outerOf(n), typeParams: typeParams(n), visibility: visibilityOf(mods, '~'),
	};
	const addSuper = (typeNode: TsNode) => {
		const { base, args } = typeOf(typeNode);
		if (base) {
			t.supers.push(base);
			if (args.length) {
				t.superArgs[base] = args;
			}
		}
	};
	const sc = n.childForFieldName('superclass');
	if (sc) {
		sc.namedChildren.forEach(addSuper);
	}
	for (const c of n.namedChildren) {
		if (c.type === 'super_interfaces' || c.type === 'extends_interfaces') {
			for (const list of c.namedChildren) {
				(list.type === 'type_list' ? list.namedChildren : [list]).forEach(addSuper);
			}
		}
	}
	const body = n.childForFieldName('body');
	// Record components act as fields.
	for (const p of n.childForFieldName('parameters')?.namedChildren ?? []) {
		const ty = typeOf(p.childForFieldName('type'));
		t.fields.push({ name: p.childForFieldName('name')?.text ?? '', type: ty.base, typeArgs: ty.args, annotations: annotations(modifiers(p)), line: line(p), typeText: rawType(p.childForFieldName('type')), visibility: '-', isFinal: true });
	}
	if (t.kind === 'enum') {
		for (const c of body?.namedChildren ?? []) {
			if (c.type === 'enum_constant') {
				(t.enumConstants ??= []).push(c.childForFieldName('name')?.text ?? '');
			}
		}
	}
	const inInterface = n.type === 'interface_declaration';
	for (const m of body?.namedChildren ?? []) {
		if (m.type === 'field_declaration' || m.type === 'constant_declaration') {
			const ty = typeOf(m.childForFieldName('type'));
			const anns = annotations(modifiers(m));
			const fmods = modifiers(m);
			for (const d of m.childrenForFieldName('declarator')) {
				const f: FieldFact = {
					name: d.childForFieldName('name')?.text ?? '', type: ty.base, typeArgs: ty.args, annotations: anns, line: line(m), init: d.childForFieldName('value')?.text,
					typeText: rawType(m.childForFieldName('type')), visibility: visibilityOf(fmods, inInterface ? '+' : '~'),
					isStatic: inInterface || hasModifier(fmods, 'static'), isFinal: inInterface || hasModifier(fmods, 'final'),
				};
				t.fields.push(f);
			}
		} else if (m.type === 'method_declaration' || m.type === 'constructor_declaration') {
			const fn = method(m, t, facts.file, inInterface);
			t.methods.push(fn.name);
			facts.funcs.push(fn);
		}
	}
	facts.types.push(t);
}

function method(m: TsNode, owner: TypeFact, file: string, inInterface: boolean): FuncFact {
	const mods = modifiers(m);
	const modText = mods?.text ?? '';
	const name = m.type === 'constructor_declaration' ? '<init>' : m.childForFieldName('name')?.text ?? '?';
	const fn: FuncFact = {
		id: `${file}#${owner.name}.${name}@${line(m)}`,
		name, owner: owner.name, file, line: line(m), endLine: endLine(m),
		params: {}, locals: {}, consts: {}, annotations: annotations(mods), calls: [],
		isPublic: /\bpublic\b/.test(modText) || inInterface,
		isStatic: /\bstatic\b/.test(modText),
		returns: m.childForFieldName('type')?.text,
		visibility: visibilityOf(mods, inInterface ? '+' : '~'),
		isAbstract: /\babstract\b/.test(modText) || (inInterface && !m.childForFieldName('body') && !/\b(default|static|private)\b/.test(modText)) || undefined,
		typeParams: typeParams(m),
	};
	const info: ParamFact[] = [];
	for (const p of m.childForFieldName('parameters')?.namedChildren ?? []) {
		if (p.type === 'formal_parameter' || p.type === 'spread_parameter') {
			const pname = p.childForFieldName('name')?.text ?? p.namedChildren.at(-1)?.text;
			const ptype = p.childForFieldName('type') ?? p.namedChildren.find(x => /type|identifier/.test(x.type));
			if (pname && ptype) {
				fn.params[pname] = typeOf(ptype).base;
				info.push({ name: pname, typeText: (rawType(ptype) ?? '') + (p.type === 'spread_parameter' ? '[]' : ''), anns: annotations(modifiers(p)).map(x => x.name) });
			}
		}
	}
	if (info.length) {
		fn.paramInfo = info;
	}
	const body = m.childForFieldName('body');
	if (body) {
		calls(body, fn);
	}
	return fn;
}

/** Calls in a body. A chain `repo.findAll().stream().map(..)` is one call on `repo` with the rest as its chain. */
function calls(body: TsNode, fn: FuncFact) {
	walk(body, n => {
		if (n.type === 'local_variable_declaration') {
			const ty = typeOf(n.childForFieldName('type'));
			for (const d of n.childrenForFieldName('declarator')) {
				const name = d.childForFieldName('name')?.text;
				// `var x = new Foo()` takes the constructed type.
				const init = d.childForFieldName('value');
				const type = ty.base === 'var' && init?.type === 'object_creation_expression' ? typeOf(init.childForFieldName('type')).base : ty.base;
				if (name) {
					fn.locals[name] = type;
					const str = stringValue(init);
					if (str !== undefined) {
						fn.consts[name] = str;
					}
				}
			}
		} else if (n.type === 'assignment_expression') {
			// sql += " where ..." / sql = "..."
			const left = n.childForFieldName('left')?.text;
			const str = stringValue(n.childForFieldName('right'));
			if (left && str !== undefined && /^\w+$/.test(left)) {
				fn.consts[left] = (n.text.includes('+=') ? fn.consts[left] ?? '' : '') + str;
			}
		} else if (n.type === 'enhanced_for_statement') {
			const name = n.childForFieldName('name')?.text;
			if (name) {
				fn.locals[name] = typeOf(n.childForFieldName('type')).base;
			}
		} else if (n.type === 'method_invocation') {
			const object = n.childForFieldName('object');
			if (object?.type === 'method_invocation') {
				return; // the innermost call of the chain reports it
			}
			fn.calls.push(invocation(n));
		} else if (n.type === 'object_creation_expression') {
			const ty = typeOf(n.childForFieldName('type')).base;
			const args = n.childForFieldName('arguments');
			fn.calls.push({ name: '<init>', recv: ty, line: line(n), strings: stringsIn(args), arg0: args?.namedChildren[0]?.text });
		}
	});
}

function invocation(n: TsNode): CallFact {
	const args = n.childForFieldName('arguments');
	const call: CallFact = {
		name: n.childForFieldName('name')?.text ?? '?',
		recv: receiverText(n.childForFieldName('object')),
		line: line(n),
		arg0: args?.namedChildren[0]?.text,
		strings: stringsIn(args),
	};
	// Walk outwards: this call's value is the object of the next one in the chain.
	const chain: string[] = [];
	let cur: TsNode = n;
	while (cur.parent?.type === 'method_invocation' && same(cur.parent.childForFieldName('object'), cur)) {
		cur = cur.parent;
		chain.push(cur.childForFieldName('name')?.text ?? '?');
		call.strings.push(...stringsIn(cur.childForFieldName('arguments')));
	}
	if (chain.length) {
		call.chain = chain;
	}
	return call;
}

function stringsIn(args: TsNode | null | undefined): string[] {
	const out: string[] = [];
	for (const a of args?.namedChildren ?? []) {
		const s = stringValue(a);
		if (s !== undefined && s.trim()) {
			out.push(s);
		}
	}
	return out;
}
