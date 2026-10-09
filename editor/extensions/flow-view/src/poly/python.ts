/*---------------------------------------------------------------------------------------------
 *  Flow polyglot index: Python. Classes (with class attributes, for SQLAlchemy and Django models),
 *  functions with their decorators (FastAPI, Flask, Celery), typed parameters, `self.x` fields,
 *  calls, module-level routers and Django url patterns.
 *--------------------------------------------------------------------------------------------*/

import type { Ann, CallFact, FieldFact, FileFacts, FuncFact, TypeFact } from './model';
import { endLine, line, receiverText, same, splitType, stringValue, walk, type TsNode } from './ts';

/** `Optional[User]`, `Annotated[Session, Depends(...)]`, `"User"` → User / Session. */
function pyType(text: string | undefined): string {
	if (!text) {
		return '';
	}
	const t = text.replace(/^["']|["']$/g, '').trim();
	const { base, args } = splitType(t.replace(/\[/, '<').replace(/\]$/, '>'));
	if (['Optional', 'Annotated', 'Union', 'Mapped', 'Type', 'type'].includes(base) && args.length) {
		return args[0];
	}
	if (t.includes('|')) {
		return pyType(t.split('|').map(x => x.trim()).find(x => x !== 'None'));
	}
	return base;
}

function decorator(d: TsNode): Ann {
	const expr = d.namedChildren[0];
	const target = expr?.type === 'call' ? expr.childForFieldName('function') : expr;
	const full = target?.text ?? '';
	const ann: Ann = { name: full.split('.').pop() ?? full, full, named: {}, args: [] };
	if (expr?.type === 'call') {
		for (const a of expr.childForFieldName('arguments')?.namedChildren ?? []) {
			if (a.type === 'keyword_argument') {
				ann.named[a.childForFieldName('name')?.text ?? ''] = a.childForFieldName('value')?.text ?? '';
			} else {
				ann.args.push(a.text);
				ann.value ??= stringValue(a);
			}
		}
	}
	return ann;
}

export function extractPython(root: TsNode, file: string, mtime: number, module: string): FileFacts {
	const facts: FileFacts = { file, lang: 'python', mtime, module, imports: {}, types: [], funcs: [], routes: [], prefixes: {}, globals: {} };
	for (const c of root.namedChildren) {
		statement(c, facts, undefined);
	}
	return facts;
}

function statement(c: TsNode, facts: FileFacts, owner: TypeFact | undefined) {
	if (c.type === 'import_statement') {
		for (const n of c.namedChildren) {
			const name = n.type === 'aliased_import' ? n.childForFieldName('name')?.text : n.text;
			const alias = n.type === 'aliased_import' ? n.childForFieldName('alias')?.text : name?.split('.')[0];
			if (name && alias) {
				facts.imports[alias] = name;
			}
		}
	} else if (c.type === 'import_from_statement') {
		const mod = resolveRelative(c.childForFieldName('module_name')?.text ?? '', facts.module ?? '');
		for (const n of c.childrenForFieldName('name')) {
			const name = n.type === 'aliased_import' ? n.childForFieldName('name')?.text : n.text;
			const alias = n.type === 'aliased_import' ? n.childForFieldName('alias')?.text : name;
			if (name && alias) {
				facts.imports[alias] = `${mod}:${name}`;
			}
		}
	} else if (c.type === 'decorated_definition') {
		const def = c.childForFieldName('definition');
		const anns = c.namedChildren.filter(x => x.type === 'decorator').map(decorator);
		if (def?.type === 'function_definition') {
			func(def, facts, owner, anns);
		} else if (def?.type === 'class_definition') {
			cls(def, facts, anns);
		}
	} else if (c.type === 'function_definition') {
		func(c, facts, owner, []);
	} else if (c.type === 'class_definition') {
		cls(c, facts, []);
	} else if (c.type === 'expression_statement' && !owner) {
		const e = c.namedChildren[0];
		if (e?.type === 'assignment') {
			moduleAssignment(e, facts);
		} else if (e?.type === 'call') {
			// app.include_router(router, prefix="/api"), app.register_blueprint(bp, url_prefix="/x")
			const fn = e.childForFieldName('function');
			const name = fn?.type === 'attribute' ? fn.childForFieldName('attribute')?.text : undefined;
			if (name === 'include_router' || name === 'register_blueprint') {
				const args = e.childForFieldName('arguments')?.namedChildren ?? [];
				const router = args[0]?.text;
				const prefix = args.find(a => a.type === 'keyword_argument' && /prefix/.test(a.childForFieldName('name')?.text ?? ''));
				if (router && prefix) {
					facts.prefixes[`include:${router}`] = stringValue(prefix.childForFieldName('value')) ?? '';
				}
			}
		}
	}
}

function resolveRelative(mod: string, current: string) {
	if (!mod.startsWith('.')) {
		return mod;
	}
	const dots = mod.match(/^\.+/)![0].length;
	const base = current.split('.').slice(0, -dots);
	const rest = mod.slice(dots);
	return [...base, ...(rest ? [rest] : [])].join('.');
}

function moduleAssignment(e: TsNode, facts: FileFacts) {
	const left = e.childForFieldName('left')?.text ?? '';
	const right = e.childForFieldName('right');
	if (right?.type === 'call') {
		const callee = right.childForFieldName('function')?.text ?? '';
		facts.globals[left] = callee.split('.').pop() ?? callee;
		for (const a of right.childForFieldName('arguments')?.namedChildren ?? []) {
			if (a.type === 'keyword_argument' && /^(prefix|url_prefix)$/.test(a.childForFieldName('name')?.text ?? '')) {
				facts.prefixes[left] = stringValue(a.childForFieldName('value')) ?? '';
			}
		}
	} else if (left === 'urlpatterns' && right) {
		djangoUrls(right, facts);
	}
}

/** urlpatterns = [path('users/', views.users), path('api/', include('app.urls')), re_path(...)] */
function djangoUrls(list: TsNode, facts: FileFacts) {
	walk(list, n => {
		if (n.type !== 'call') {
			return;
		}
		const fn = n.childForFieldName('function')?.text ?? '';
		if (!/^(path|re_path|url)$/.test(fn.split('.').pop() ?? '')) {
			return;
		}
		const args = n.childForFieldName('arguments')?.namedChildren ?? [];
		const route = stringValue(args[0]) ?? '';
		const handler = args[1];
		if (!handler) {
			return false;
		}
		if (handler.type === 'call' && /include$/.test(handler.childForFieldName('function')?.text ?? '')) {
			const target = stringValue(handler.childForFieldName('arguments')?.namedChildren[0]);
			if (target) {
				facts.routes.push({ verb: 'INCLUDE', path: route, handler: target, line: line(n) });
			}
		} else {
			facts.routes.push({ verb: '*', path: route, handler: handler.text.replace(/\s+/g, ''), line: line(n) });
		}
		return false;
	});
}

function cls(n: TsNode, facts: FileFacts, anns: Ann[]) {
	const t: TypeFact = {
		name: n.childForFieldName('name')?.text ?? '?', file: facts.file, line: line(n), endLine: endLine(n),
		kind: 'class', isAbstract: false, supers: [], superArgs: {}, annotations: anns, fields: [], methods: [],
	};
	for (const s of n.childForFieldName('superclasses')?.namedChildren ?? []) {
		if (s.type === 'keyword_argument') {
			continue;
		}
		const { base, args } = splitType(s.text.replace(/\[/, '<').replace(/\]$/, '>'));
		t.supers.push(base);
		if (s.text.includes('.')) {
			t.supers.push(s.text.replace(/\[.*$/, ''));
		}
		if (args.length) {
			t.superArgs[base] = args;
		}
		if (/^(ABC|Protocol)$/.test(base)) {
			t.isAbstract = true;
		}
	}
	for (const c of n.childForFieldName('body')?.namedChildren ?? []) {
		if (c.type === 'expression_statement' && c.namedChildren[0]?.type === 'assignment') {
			const a = c.namedChildren[0];
			const name = a.childForFieldName('left')?.text ?? '';
			const typeNode = a.childForFieldName('type');
			const right = a.childForFieldName('right');
			const callee = right?.type === 'call' ? right.childForFieldName('function')?.text ?? '' : '';
			const ty = typeNode ? splitType(typeNode.text.replace(/\[/, '<').replace(/\]$/, '>')) : { base: callee.split('.').pop() ?? '', args: [] };
			if (/^\w+$/.test(name)) {
				t.fields.push({ name, type: ty.base, typeArgs: ty.args, annotations: [], line: line(c), init: right?.text });
			}
		} else if (c.type === 'class_definition' && c.childForFieldName('name')?.text === 'Meta') {
			// Django: class Meta: db_table = "..."
			for (const m of c.childForFieldName('body')?.namedChildren ?? []) {
				const a = m.namedChildren[0];
				if (a?.type === 'assignment') {
					t.fields.push({ name: `Meta.${a.childForFieldName('left')?.text}`, type: '', typeArgs: [], annotations: [], line: line(m), init: a.childForFieldName('right')?.text });
				}
			}
		} else {
			statement(c, facts, t);
		}
	}
	// self.x = Thing(...) / self.x = param in __init__ gives x a type.
	const init = facts.funcs.find(f => f.owner === t.name && f.name === '__init__' && f.file === facts.file);
	if (init) {
		for (const [k, v] of Object.entries(init.locals)) {
			if (k.startsWith('self.') && !t.fields.some(f => f.name === k.slice(5))) {
				t.fields.push({ name: k.slice(5), type: v, typeArgs: [], annotations: [], line: init.line });
			}
		}
	}
	facts.types.push(t);
}

function func(n: TsNode, facts: FileFacts, owner: TypeFact | undefined, anns: Ann[]) {
	const name = n.childForFieldName('name')?.text ?? '?';
	const fn: FuncFact = {
		id: `${facts.file}#${owner ? owner.name + '.' : ''}${name}@${line(n)}`,
		name, owner: owner?.name, file: facts.file, line: line(n), endLine: endLine(n),
		params: {}, locals: {}, consts: {}, annotations: anns, calls: [],
		isPublic: !name.startsWith('_') || name === '__init__',
		isStatic: anns.some(a => a.name === 'staticmethod'),
		returns: n.childForFieldName('return_type')?.text,
		exported: !owner,
	};
	for (const p of n.childForFieldName('parameters')?.namedChildren ?? []) {
		const pname = p.type === 'identifier' ? p.text : (p.childForFieldName('name') ?? p.namedChildren.find(x => x.type === 'identifier'))?.text;
		const ptype = p.childForFieldName('type')?.text;
		if (pname && pname !== 'self' && pname !== 'cls') {
			fn.params[pname] = pyType(ptype);
		}
	}
	owner?.methods.push(name);
	const body = n.childForFieldName('body');
	if (body) {
		pyCalls(body, fn);
	}
	facts.funcs.push(fn);
}

function pyCalls(body: TsNode, fn: FuncFact) {
	walk(body, n => {
		if (n.type === 'function_definition' || n.type === 'class_definition') {
			return false; // nested definitions are their own story
		}
		if (n.type === 'assignment') {
			const left = n.childForFieldName('left')?.text.replace(/\s+/g, '');
			const right = n.childForFieldName('right');
			const typeNode = n.childForFieldName('type');
			const str = stringValue(right) ?? (right?.type === 'call' ? stringValue(right.childForFieldName('arguments')?.namedChildren[0]) : undefined);
			if (left && /^\w+$/.test(left) && str !== undefined) {
				fn.consts[left] = str;
			}
			if (left && /^(self\.)?\w+$/.test(left)) {
				if (typeNode) {
					fn.locals[left] = pyType(typeNode.text);
				} else if (right?.type === 'call') {
					const callee = right.childForFieldName('function')?.text ?? '';
					if (/^[A-Z]/.test(callee.split('.').pop() ?? '')) {
						fn.locals[left] = callee.split('.').pop()!;
					}
				} else if (right?.type === 'identifier' && fn.params[right.text]) {
					fn.locals[left] = fn.params[right.text];
				}
			}
		} else if (n.type === 'with_item') {
			// with Session() as s:
			const v = n.namedChildren[0];
			if (v?.type === 'as_pattern') {
				const call = v.namedChildren[0];
				const alias = v.childForFieldName('alias')?.text ?? v.namedChildren[1]?.text;
				if (call?.type === 'call' && alias) {
					fn.locals[alias] = (call.childForFieldName('function')?.text ?? '').split('.').pop()!;
				}
			}
		} else if (n.type === 'call') {
			const f = n.childForFieldName('function');
			if (f?.type === 'attribute' && f.childForFieldName('object')?.type === 'call') {
				return true; // reported by the innermost call of the chain
			}
			fn.calls.push(pyCall(n));
		}
		return true;
	});
}

function pyCall(n: TsNode): CallFact {
	const f = n.childForFieldName('function');
	const args = n.childForFieldName('arguments');
	const strings = (node: TsNode | null) => (node?.namedChildren ?? []).map(a => stringValue(a.type === 'keyword_argument' ? a.childForFieldName('value') : a)).filter((s): s is string => !!s?.trim());
	const call: CallFact = f?.type === 'attribute'
		? { name: f.childForFieldName('attribute')?.text ?? '?', recv: receiverText(f.childForFieldName('object')), line: line(n), strings: strings(args) }
		: { name: f?.text ?? '?', line: line(n), strings: strings(args) };
	call.arg0 = args?.namedChildren.find(a => a.type !== 'keyword_argument')?.text;
	const chain: string[] = [];
	let cur: TsNode = n;
	// call → attribute(object = call) → call
	while (cur.parent?.type === 'attribute' && same(cur.parent.childForFieldName('object'), cur) && cur.parent.parent?.type === 'call') {
		const attr = cur.parent;
		cur = attr.parent!;
		chain.push(attr.childForFieldName('attribute')?.text ?? '?');
		call.strings.push(...strings(cur.childForFieldName('arguments')));
	}
	if (chain.length) {
		call.chain = chain;
	}
	return call;
}

export type { FieldFact };
