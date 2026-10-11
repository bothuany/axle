/*---------------------------------------------------------------------------------------------
 *  Axle type model: one TypeGraph from the two sources. The code index's facts (Java, Python,
 *  JS/TS, Go, PHP, Ruby, Rust) and the C# analyzer's types are both turned into one raw shape,
 *  every field, method and constructor type is resolved to workspace types (collections and
 *  response wrappers seen through), roles and DTOs are decided, and the edges are collected.
 *  Pure: no vscode, no fs; the module of a file comes in as a function.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import type { FileFacts, FuncFact, TypeFact } from '../poly/model';
import { dtoOwnReason, roleOf, BEHAVIOUR_ROLES, classifyOptions, type ClassifyFacts } from './classify';
import { byCode, type ClassifyOptions, type Collection, type EndpointTypes, type FieldInfo, type FuncSig, type MethodInfo, type ModuleInfo, type SuperRef, type TypeCallEdge, type TypeEdge, type TypeGraph, type TypeInfo, type TypeKind, type TypeLang, type TypeRole, type Visibility } from './model';
import { collectionOf, displayType, parseType, unwrap } from './typeref';
import type { CsMember, CsMethod, CsParam, CsType, CsTypesResponse, PolyEntryFact, PolyTypeFacts } from './wire';

export interface TypeSources {
	poly?: PolyTypeFacts;
	csharp?: CsTypesResponse;
	/** The module (microservice, project) a source file belongs to; the default is the first folder of its path. */
	moduleOf?: (file: string) => { name: string; root?: string };
	options?: Partial<ClassifyOptions>;
}

// ── raw types: one shape for every source ─────────────────────────────────────────────────────────

interface RawParam {
	name: string;
	type: string;
	anns: string[];
	/** Already resolved qualified names (C#): the analyzer knows better than a name lookup. */
	pre?: string[];
	many?: boolean;
	nullable?: boolean;
	source?: string;
}

interface RawField {
	name: string;
	type: string;
	visibility: Visibility;
	isStatic: boolean;
	isFinal?: boolean;
	optional?: boolean;
	line?: number;
	anns: string[];
	init?: string;
	pre?: string[];
	many?: boolean;
	nullable?: boolean;
}

interface RawMethod {
	name: string;
	params: RawParam[];
	returns?: string;
	returnPre?: string[];
	returnMany?: boolean;
	visibility: Visibility;
	isStatic: boolean;
	isAbstract: boolean;
	isCtor: boolean;
	isAccessor: boolean;
	line?: number;
	endLine?: number;
	anns: string[];
	/** Prebuilt (C#): `(string name): UserDto`. */
	signature?: string;
}

interface Raw {
	id: string;
	lang: TypeLang;
	name: string;
	qualifiedName: string;
	packageName: string;
	kind: TypeKind;
	alias: boolean;
	file: string;
	line: number;
	endLine: number;
	module: string;
	isAbstract: boolean;
	annotations: string[];
	/** Supers as written: `qualified` when the source wrote or knows the qualified name. */
	supers: { name: string; qualified?: string; relation?: 'extends' | 'implements' }[];
	superArgs: Record<string, string[]>;
	typeParams: string[];
	fields: RawField[];
	methods: RawMethod[];
	constants?: string[];
	imports: Record<string, string>;
	starImports: string[];
	generatedAccessors: boolean;
	lombokCtor?: 'required' | 'all';
	cs?: boolean;
}

const POLY_LANG: Record<string, TypeLang> = { java: 'java', python: 'python', js: 'js', go: 'go', php: 'php', ruby: 'ruby', rust: 'rust' };
const CTOR_NAMES = new Set(['<init>', 'constructor', '__init__', '__construct', 'initialize']);
const INJECT_ANN = new Set(['Autowired', 'Inject', 'Resource', 'Inject', 'InjectRepository', 'InjectModel', 'InjectQueue', 'InjectEntityManager', 'InjectConnection', 'Value']);
const PY_SKIP_SUPERS = new Set(['object', 'ABC', 'Protocol', 'Generic', 'Exception', 'Enum', 'IntEnum', 'StrEnum']);

const norm = (p: string) => p.replace(/\\/g, '/');
const stripExt = (p: string) => p.replace(/\.(d\.)?[mc]?[jt]sx?$/, '');
const dirOf = (p: string) => path.posix.dirname(norm(p));

function visibilityOf(v: string | undefined): Visibility {
	switch (v) {
		case '+': case '-': case '#': case '~': return v;
		case 'public': return '+';
		case 'private': return '-';
		case 'protected': case 'private protected': return '#';
		default: return '~';
	}
}

const isAccessorName = (name: string) => /^(get|set|is|has)[A-Z]/.test(name);

// ── from the code index ───────────────────────────────────────────────────────────────────────────

function defaultModule(file: string): { name: string; root?: string } {
	const parts = norm(file).split('/').filter(Boolean);
	return { name: parts.length > 1 ? parts[parts.length - 2] : 'workspace' };
}

function polyRaws(poly: PolyTypeFacts, moduleOf: (file: string) => { name: string; root?: string }): Raw[] {
	const out: Raw[] = [];
	const moduleCache = new Map<string, { name: string; root?: string }>();
	const modOf = (file: string) => {
		let m = moduleCache.get(file);
		if (!m) {
			m = moduleOf(file);
			moduleCache.set(file, m);
		}
		return m;
	};
	for (const f of poly.files) {
		const lang = POLY_LANG[f.lang];
		if (!lang || !f.types.length) {
			continue;
		}
		const mod = modOf(f.file);
		const funcsByOwner = new Map<string, FuncFact[]>();
		for (const fn of f.funcs) {
			if (fn.owner) {
				const list = funcsByOwner.get(fn.owner) ?? [];
				list.push(fn);
				funcsByOwner.set(fn.owner, list);
			}
		}
		for (const t of f.types) {
			if (t.stub) {
				continue;
			}
			out.push(polyRaw(f, t, lang, mod, funcsByOwner.get(t.name) ?? []));
		}
	}
	return out;
}

function qualifiedFor(f: FileFacts, t: TypeFact, lang: TypeLang, mod: { name: string; root?: string }): { qualified: string; pkg: string } {
	const outer = t.outer ? `${t.outer}.` : '';
	switch (lang) {
		case 'java':
			return { qualified: `${f.module ? f.module + '.' : ''}${outer}${t.name}`, pkg: f.module ?? '' };
		case 'python':
			return { qualified: `${f.module ? f.module + '.' : ''}${t.name}`, pkg: f.module ?? '' };
		default: {
			// A file-based home for the other languages: the path below the module folder.
			const rel = mod.root && norm(f.file).startsWith(norm(mod.root) + '/') ? norm(f.file).slice(norm(mod.root).length + 1) : norm(f.file).split('/').slice(-2).join('/');
			const dir = path.posix.dirname(rel);
			return { qualified: `${stripExt(rel)}#${t.name}`, pkg: dir === '.' ? '' : dir };
		}
	}
}

function polyRaw(f: FileFacts, t: TypeFact, lang: TypeLang, mod: { name: string; root?: string }, funcs: FuncFact[]): Raw {
	const { qualified, pkg } = qualifiedFor(f, t, lang, mod);
	const anns = t.annotations.map(a => a.name);
	const kind: TypeKind = t.declKind === 'record' ? 'record' : t.declKind === 'struct' ? 'struct' : t.kind;
	const supers = [...t.supers.map(s => ({ name: s }))]
		.filter(s => !(lang === 'python' && PY_SKIP_SUPERS.has(s.name)));
	// Python keeps both `Base` and `models.Base` for a qualified base: one is enough.
	const dedup = supers.filter(s => !(lang === 'python' && s.name.includes('.') && supers.some(o => o !== s && s.name.endsWith(`.${o.name}`))));
	const raw: Raw = {
		id: '', lang, name: t.name, qualifiedName: qualified, packageName: pkg, kind, alias: t.declKind === 'alias', file: f.file, line: t.line, endLine: t.endLine,
		module: mod.name, isAbstract: t.isAbstract && t.kind !== 'interface', annotations: anns,
		supers: dedup.map(s => (s.name.includes('.') ? { name: s.name.split('.').pop()!, qualified: s.name } : s)), superArgs: t.superArgs, typeParams: t.typeParams ?? [],
		fields: t.fields.filter(x => x.name && !x.name.includes('.')).map((x): RawField => ({
			name: x.name,
			type: x.typeText ?? (x.typeArgs.length ? `${x.type}<${x.typeArgs.join(', ')}>` : x.type),
			visibility: x.visibility ?? (lang === 'python' && x.name.startsWith('_') ? '-' : '+'),
			isStatic: !!x.isStatic, isFinal: x.isFinal, optional: x.optional, line: x.line, anns: x.annotations.map(a => a.name), init: x.init,
		})),
		methods: [],
		constants: t.enumConstants,
		imports: f.imports, starImports: f.starImports ?? [],
		generatedAccessors: anns.some(a => a === 'Data' || a === 'Getter' || a === 'Value') && lang === 'java',
		lombokCtor: anns.includes('AllArgsConstructor') ? 'all' : anns.includes('RequiredArgsConstructor') || anns.includes('Value') ? 'required' : undefined,
	};
	for (const fn of funcs) {
		if (fn.inlineRoute) {
			continue;
		}
		const isCtor = CTOR_NAMES.has(fn.name);
		const params: RawParam[] = fn.paramInfo?.length
			? fn.paramInfo.map(p => ({ name: p.name, type: p.typeText, anns: p.anns }))
			: Object.entries(fn.params).map(([name, type]) => ({ name, type, anns: [] }));
		raw.methods.push({
			name: isCtor ? t.name : fn.name, params, returns: fn.returns?.replace(/^\s*(->|:)\s*/, '').replace(/\s+/g, ' ').trim() || undefined,
			visibility: fn.visibility ?? (fn.isPublic ? '+' : '-'), isStatic: fn.isStatic, isAbstract: !!fn.isAbstract, isCtor,
			isAccessor: fn.isAccessor ?? (isAccessorName(fn.name) && fn.calls.length === 0 && fn.endLine - fn.line <= 4),
			line: fn.line, endLine: fn.endLine, anns: fn.annotations.map(a => a.name),
		});
	}
	return raw;
}

// ── from the C# analyzer ──────────────────────────────────────────────────────────────────────────

const csParam = (p: CsParam): RawParam => ({ name: p.name, type: p.type, anns: [], pre: p.refs, many: p.isCollection, nullable: p.nullable, source: p.source });

function csField(m: CsMember): RawField {
	return { name: m.name, type: m.type, visibility: visibilityOf(m.visibility), isStatic: m.isStatic, line: m.line, anns: [], pre: m.refs, many: m.isCollection, nullable: m.nullable };
}

function csMethod(m: CsMethod): RawMethod {
	return {
		name: m.name, params: m.parameters.map(csParam), returns: m.returnType, returnPre: m.returnRefs, returnMany: m.returnIsCollection, visibility: visibilityOf(m.visibility), isStatic: m.isStatic,
		isAbstract: !!m.isAbstract, isCtor: false, isAccessor: false, line: m.line, endLine: m.endLine, anns: m.attributes ?? [], signature: m.signature,
	};
}

function csRaw(t: CsType): Raw {
	const supers: Raw['supers'] = [];
	if (t.baseType && !/^(object|System\.Object|ValueType|System\.ValueType|Enum|System\.Enum)$/.test(t.baseType)) {
		supers.push({ name: t.baseType.split('.').pop()!, qualified: t.baseType, relation: 'extends' });
	}
	for (const i of t.interfaces) {
		supers.push({ name: i.split('.').pop()!.replace(/<.*$/, ''), qualified: i.replace(/<.*$/, ''), relation: 'implements' });
	}
	const raw: Raw = {
		id: '', lang: 'csharp', name: t.name, qualifiedName: t.fqn, packageName: t.namespace, kind: t.kind, alias: false, file: t.file, line: t.line, endLine: t.endLine, module: t.project || 'workspace',
		isAbstract: t.isAbstract, annotations: t.attributes, supers, superArgs: {}, typeParams: t.typeParameters, fields: t.fields.map(csField), methods: t.methods.map(csMethod),
		constants: t.enumMembers.length ? t.enumMembers : undefined, imports: {}, starImports: [], generatedAccessors: false, cs: true,
	};
	if (t.constructorParameters.length) {
		raw.methods.push({ name: t.name, params: t.constructorParameters.map(csParam), visibility: '+', isStatic: false, isAbstract: false, isCtor: true, isAccessor: false, anns: [] });
	}
	return raw;
}

// ── resolution ────────────────────────────────────────────────────────────────────────────────────

interface Resolver {
	/** The id of the workspace type `name` (qualified as written) means, seen from `from`. */
	(from: Raw, name: string, qualified: string): string | undefined;
	byId: Map<string, Raw>;
	byQualified: Map<string, Raw>;
}

function makeResolver(raws: Raw[]): Resolver {
	const byName = new Map<string, Raw[]>();
	const byQualified = new Map<string, Raw>();
	const byId = new Map<string, Raw>();
	for (const r of raws) {
		byId.set(r.id, r);
		byQualified.set(`${r.lang}:${r.qualifiedName}`, r);
		const list = byName.get(r.name) ?? [];
		list.push(r);
		byName.set(r.name, list);
	}
	const sameFamily = (a: TypeLang, b: TypeLang) => a === b;
	/** How well a candidate fits what the file imports: Infinity when it is the very type imported, -1 when the file imports another thing of that name. */
	const importFit = (from: Raw, cand: Raw, name: string): number => {
		const imp = from.imports[name];
		if (!imp) {
			if (from.lang === 'java' && from.starImports.includes(cand.packageName)) {
				return 80;
			}
			return 0;
		}
		if (from.lang === 'java') {
			return imp === cand.qualifiedName || imp === `${cand.packageName}.${cand.name}` ? 90 : -1;
		}
		const sep = imp.lastIndexOf(':');
		const mod = sep >= 0 ? imp.slice(0, sep) : imp;
		if (from.lang === 'python') {
			return cand.packageName === mod || cand.packageName.startsWith(`${mod}.`) ? 90 : -1;
		}
		if (from.lang === 'js') {
			if (mod.startsWith('.')) {
				const target = path.posix.normalize(`${dirOf(from.file)}/${mod}`);
				const cf = stripExt(norm(cand.file));
				return cf === target || cf === `${target}/index` ? 90 : -1;
			}
			// An alias path (`@/users/dto`) points into the workspace; a package name does not.
			if (/^(@\/|~\/|src\/|\$lib\/|#)/.test(mod)) {
				return stripExt(norm(cand.file)).endsWith(mod.replace(/^(@\/|~\/|src\/|\$lib\/|#)/, '/')) ? 90 : 0;
			}
			return -1;
		}
		return 0;
	};
	const resolve = ((from: Raw, name: string, qualified: string): string | undefined => {
		if (!name || from.typeParams.includes(name)) {
			return undefined;
		}
		if (qualified.includes('.')) {
			const exact = byQualified.get(`${from.lang}:${qualified}`);
			if (exact) {
				return exact.id;
			}
			if (from.lang === 'java' || from.lang === 'csharp') {
				const tail = byName.get(name)?.find(r => sameFamily(r.lang, from.lang) && (r.qualifiedName === qualified || r.qualifiedName.endsWith(`.${qualified}`)));
				if (tail) {
					return tail.id;
				}
			}
		}
		const cands = (byName.get(name) ?? []).filter(r => sameFamily(r.lang, from.lang));
		if (!cands.length) {
			return undefined;
		}
		let best: Raw | undefined;
		let bestScore = -Infinity;
		for (const c of cands) {
			const fit = importFit(from, c, name);
			if (fit < 0) {
				continue;
			}
			const score = fit + (c.file === from.file ? 100 : 0) + (c.packageName === from.packageName ? 60 : 0) + (c.module === from.module ? 30 : 0);
			if (score > bestScore || (score === bestScore && best && c.id < best.id)) {
				best = c;
				bestScore = score;
			}
		}
		// A file that imports the name from somewhere else (a framework type) is not the workspace type of the same name.
		return best?.id;
	}) as Resolver;
	resolve.byId = byId;
	resolve.byQualified = byQualified;
	return resolve;
}

interface Resolved {
	refs: string[];
	collection: Collection;
	nullable: boolean;
}

const NONE: Resolved = { refs: [], collection: 'one', nullable: false };

function resolveText(r: Resolver, from: Raw, text: string | undefined, pre?: string[], many?: boolean, nullable?: boolean, optional?: boolean): Resolved {
	if (pre) {
		const refs = [...new Set(pre.map(q => r.byQualified.get(`${from.lang}:${q}`)?.id).filter((x): x is string => !!x))];
		const collection: Collection = many ? 'many' : nullable || optional ? 'optional' : 'one';
		return { refs, collection, nullable: !!nullable || !!optional };
	}
	if (!text) {
		return NONE;
	}
	// A Python forward reference is a string: `list["UserOut"]`.
	const expr = parseType(from.lang === 'python' ? text.replace(/["']([A-Za-z_][\w.]*)["']/g, '$1') : text);
	const leaves = unwrap(expr, (name, qualified) => r(from, name, qualified));
	const refs = [...new Set(leaves.map(l => l.id))];
	let collection = collectionOf(leaves, expr);
	if (collection === 'one' && optional) {
		collection = 'optional';
	}
	return { refs, collection, nullable: collection === 'optional' || leaves.some(l => l.optional) || expr.nullable || !!optional };
}

// ── graph ─────────────────────────────────────────────────────────────────────────────────────────

function signatureOf(raw: Raw, m: RawMethod, ret: string): string {
	if (m.signature) {
		return m.signature;
	}
	const typed = raw.lang === 'java';
	const ps = m.params.map(p => {
		const t = displayType(p.type);
		return !t ? p.name : typed ? `${t} ${p.name}` : `${p.name}: ${t}`;
	}).join(', ');
	return m.isCtor ? `(${ps})` : `(${ps})${ret ? `: ${ret}` : ''}`;
}

/** A signature for the chips of a card; one that names no workspace type is not kept. */
function pushSig(out: FuncSig[], file: string, line: number, endLine: number | undefined, name: string, owner: string | undefined, params: { name: string; type: string; rs: Resolved }[], returns: { type: string; rs: Resolved } | undefined) {
	if (!params.some(p => p.rs.refs.length) && !returns?.rs.refs.length) {
		return;
	}
	out.push({
		file, line, endLine, name, owner,
		params: params.map(p => ({ name: p.name, type: displayType(p.type), refs: p.rs.refs, collection: p.rs.collection })),
		returns: returns ? { type: displayType(returns.type), refs: returns.rs.refs, collection: returns.rs.collection } : undefined,
	});
}

/** Parameters bound from the request body, wherever the framework says so. */
const BODY_ONLY = new Set(['RequestBody', 'Body', 'FromBody']);

export function buildTypeGraph(src: TypeSources): TypeGraph {
	const options: ClassifyOptions = classifyOptions(src.options);
	const moduleOf = src.moduleOf ?? defaultModule;
	const raws: Raw[] = [];
	if (src.poly) {
		raws.push(...polyRaws(src.poly, moduleOf));
	}
	if (src.csharp) {
		raws.push(...src.csharp.types.map(csRaw));
	}
	raws.sort((a, b) => byCode(`${a.lang}:${a.qualifiedName}`, `${b.lang}:${b.qualifiedName}`) || byCode(a.file, b.file) || a.line - b.line);
	const taken = new Set<string>();
	for (const r of raws) {
		let id = `${r.lang}:${r.qualifiedName}`;
		for (let n = 2; taken.has(id); n++) {
			id = `${r.lang}:${r.qualifiedName}~${n}`;
		}
		taken.add(id);
		r.id = id;
	}
	// The resolver keys types by their qualified name: a duplicate keeps its first id there, a real ambiguity the name lookup scores.
	const resolve = makeResolver(raws);

	// Fields, methods and constructor parameters to ids.
	interface Done {
		raw: Raw;
		fields: (FieldInfo & { anns: string[]; init?: string; isFinal?: boolean })[];
		methods: MethodInfo[];
		ctorDeps: { id: string; names: string[] }[];
		superRefs: SuperRef[];
		superGenerics: string[];
	}
	const done = new Map<string, Done>();
	const funcs: FuncSig[] = [];
	for (const raw of raws) {
		const fields = raw.fields.map(f => {
			const rs = resolveText(resolve, raw, f.type, f.pre, f.many, f.nullable, f.optional);
			return { name: f.name, type: displayType(f.type), visibility: f.visibility, isStatic: f.isStatic, refs: rs.refs, collection: rs.collection, nullable: rs.nullable || undefined, line: f.line, anns: f.anns, init: f.init, isFinal: f.isFinal };
		});
		const methods: MethodInfo[] = [];
		const ctorDeps = new Map<string, string[]>();
		const addDep = (id: string, by: string) => {
			if (id !== raw.id) {
				ctorDeps.set(id, [...(ctorDeps.get(id) ?? []), by]);
			}
		};
		for (const m of raw.methods) {
			const params = m.params.map(p => ({ p, rs: resolveText(resolve, raw, p.type, p.pre, p.many, p.nullable) }));
			const ret = resolveText(resolve, raw, m.returns, m.returnPre, m.returnMany);
			if (m.line !== undefined) {
				pushSig(funcs, raw.file, m.line, m.endLine, m.name, raw.name, params.map(x => ({ name: x.p.name, type: x.p.type, rs: x.rs })), m.returns ? { type: m.returns, rs: ret } : undefined);
			}
			const paramRefs = [...new Set(params.flatMap(x => x.rs.refs))];
			const bodyRefs = [...new Set(params.filter(x => x.p.anns.some(a => BODY_ONLY.has(a)) || x.p.source === 'FromBody' || x.p.source === 'body').flatMap(x => x.rs.refs))];
			if (m.isCtor) {
				for (const x of params) {
					x.rs.refs.forEach(id => addDep(id, x.p.name));
				}
			}
			methods.push({
				name: m.name, signature: signatureOf(raw, m, displayType(m.returns)), visibility: m.visibility, isStatic: m.isStatic,
				refs: [...new Set([...paramRefs, ...ret.refs])], paramRefs, returnRefs: ret.refs,
				returnCollection: ret.refs.length ? ret.collection : undefined, bodyRefs: bodyRefs.length ? bodyRefs : undefined,
				line: m.line, endLine: m.endLine, annotations: m.anns.length ? m.anns : undefined, isConstructor: m.isCtor || undefined, isAbstract: m.isAbstract || undefined,
				isAccessor: m.isAccessor || undefined,
			});
		}
		// Constructor injection written differently: Lombok, and @Autowired / @Inject / @InjectRepository fields.
		const hasCtor = raw.methods.some(m => m.isCtor && m.params.length);
		for (const f of fields) {
			const injected = f.anns.some(a => INJECT_ANN.has(a)) && !f.anns.every(a => a === 'Value');
			const lombok = !hasCtor && raw.lombokCtor && !f.isStatic && (raw.lombokCtor === 'all' || (f.isFinal && !f.init));
			if (injected || lombok) {
				f.refs.forEach(id => addDep(id, f.name));
			}
		}
		const superRefs: SuperRef[] = raw.supers.map(s => {
			const id = resolve(raw, s.name, s.qualified ?? s.name);
			return { name: s.name, id: id && id !== raw.id ? id : undefined, relation: s.relation ?? 'extends' };
		});
		const superGenerics = new Set<string>();
		for (const [sup, args] of Object.entries(raw.superArgs)) {
			void sup;
			for (const a of args) {
				const id = resolve(raw, a.replace(/<.*$/, ''), a);
				if (id && id !== raw.id) {
					superGenerics.add(id);
				}
			}
		}
		done.set(raw.id, { raw, fields, methods, ctorDeps: [...ctorDeps].map(([id, names]) => ({ id, names })), superRefs, superGenerics: [...superGenerics] });
	}

	// Entities named by the ORM context: DbSet<Order> in an EF Core DbContext.
	const mapped = new Set<string>();
	for (const d of done.values()) {
		if (d.superRefs.some(s => /DbContext$/.test(s.name))) {
			for (const f of d.fields) {
				if (/^(DbSet|IDbSet|DbQuery)\b/.test(f.type)) {
					f.refs.forEach(id => mapped.add(id));
				}
			}
		}
	}

	// Endpoints: what each takes and returns.
	const endpoints: EndpointTypes[] = [];
	const ownerOf = new Map<string, Raw>();
	for (const r of raws) {
		ownerOf.set(`${r.file}|${r.name}`, r);
	}
	const endpointOwners = new Set<string>();
	const ctxOf = (file: string, owner: Raw | undefined, lang: TypeLang): Raw => owner ?? {
		id: '', lang, name: '', qualifiedName: '', packageName: '', kind: 'class', alias: false, file, line: 0, endLine: 0, module: moduleOf(file).name, isAbstract: false, annotations: [], supers: [], superArgs: {}, typeParams: [], fields: [], methods: [],
		imports: src.poly?.files.find(f => f.file === file)?.imports ?? {}, starImports: [], generatedAccessors: false,
	};
	for (const e of src.poly?.entries ?? []) {
		endpoints.push(polyEndpoint(e, ownerOf.get(`${e.file}|${e.owner ?? ''}`), resolve, ctxOf, src.poly!.files));
	}
	// Functions of no type of the workspace (module functions, inline handlers, a class the index did not list): their parameters are read with the imports of their file.
	for (const f of src.poly?.files ?? []) {
		const lang = POLY_LANG[f.lang];
		const free = lang ? f.funcs.filter(fn => fn.inlineRoute || !fn.owner || !ownerOf.has(`${f.file}|${fn.owner}`)) : [];
		const ctx = free.length ? ctxOf(f.file, undefined, lang) : undefined;
		for (const fn of free) {
			const owner = fn.owner ? ownerOf.get(`${f.file}|${fn.owner}`) : undefined;
			const from = owner ?? ctx!;
			const ps = fn.paramInfo?.length ? fn.paramInfo.map(p => ({ name: p.name, type: p.typeText })) : Object.entries(fn.params).map(([name, type]) => ({ name, type }));
			const returns = fn.returns?.replace(/^s*(->|:)s*/, '').replace(/s+/g, ' ').trim();
			pushSig(funcs, f.file, fn.line, fn.endLine, fn.name, fn.owner, ps.map(p => ({ ...p, rs: resolveText(resolve, from, p.type) })), returns ? { type: returns, rs: resolveText(resolve, from, returns) } : undefined);
		}
	}
	for (const e of src.csharp?.entries ?? []) {
		const owner = raws.find(r => r.cs && r.qualifiedName === e.controller);
		const ret = resolveText(resolve, owner ?? ctxOf(e.file, undefined, 'csharp'), e.returnType, e.returnRefs, e.returnIsCollection);
		endpoints.push({
			id: e.id, owner: owner?.id, controller: e.controller.split('.').pop() ?? e.controller, action: e.action, http: e.http, file: e.file, line: e.line,
			params: e.parameters.map(p => {
				const rs = resolveText(resolve, owner ?? ctxOf(e.file, undefined, 'csharp'), p.type, p.refs, p.isCollection, p.nullable);
				return { name: p.name, type: displayType(p.type), refs: rs.refs, collection: rs.collection, body: p.source === 'FromBody' || undefined };
			}),
			returnType: displayType(e.returnType), returnRefs: ret.refs, returnCollection: ret.collection,
		});
	}
	for (const e of endpoints) {
		if (e.owner) {
			endpointOwners.add(e.owner);
		}
	}

	// Roles and DTOs.
	const facts = (d: Done): ClassifyFacts => ({
		name: d.raw.name, kind: d.raw.kind, lang: d.raw.lang, alias: d.raw.alias, isAbstract: d.raw.isAbstract,
		annotations: d.raw.annotations, supers: d.raw.supers.map(s => s.name),
		fields: d.fields.map(f => ({ name: f.name, visibility: f.visibility, isStatic: f.isStatic })),
		methods: d.methods.filter(m => !m.isConstructor).map(m => m.name),
		injects: d.ctorDeps.length > 0, hasEndpoints: endpointOwners.has(d.raw.id), mappedEntity: mapped.has(d.raw.id),
		ormFields: d.fields.some(f => f.anns.some(a => /^(Column|PrimaryGeneratedColumn|ManyToOne|OneToMany|OneToOne|ManyToMany|JoinColumn|Id)$/.test(a)) || /^(?:\w+\.)?(Column|mapped_column|relationship|ForeignKey|\w+Field)\(/.test(f.init ?? '')),
	});
	const role = new Map<string, TypeRole>();
	const dtoWhy = new Map<string, string>();
	for (const d of done.values()) {
		const f = facts(d);
		const r = roleOf(f);
		role.set(d.raw.id, r);
		const why = dtoOwnReason(f, r, options);
		if (why) {
			dtoWhy.set(d.raw.id, why);
		}
	}
	// Types an endpoint takes or returns, and what their fields refer to.
	const queue: string[] = [];
	const mark = (id: string, why: string): boolean => {
		const d = done.get(id);
		const r = role.get(id);
		if (!d || !r || dtoWhy.has(id) || BEHAVIOUR_ROLES.includes(r) || r === 'entity' || r === 'enum') {
			return false;
		}
		if (r === 'interface' && d.methods.some(m => !m.isConstructor)) {
			return false;
		}
		dtoWhy.set(id, why);
		return true;
	};
	for (const e of endpoints) {
		const via = `${e.controller}.${e.action}`;
		for (const p of e.params) {
			for (const id of p.refs) {
				if (mark(id, `${p.body ? '@RequestBody' : 'parameter'} of ${via}`)) {
					queue.push(id);
				}
			}
		}
		for (const id of e.returnRefs) {
			if (mark(id, `returned by ${via}`)) {
				queue.push(id);
			}
		}
	}
	// Seeds that are DTOs by shape take their field types along too.
	queue.push(...dtoWhy.keys());
	const seen = new Set<string>();
	for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
		if (seen.has(id)) {
			continue;
		}
		seen.add(id);
		const d = done.get(id);
		for (const f of d?.fields ?? []) {
			for (const t of f.refs) {
				if (mark(t, `referenced by ${d!.raw.name}`)) {
					queue.push(t);
				}
			}
		}
	}

	// A type of nothing but fields that only entities refer to is a child entity (an EF owned type, a JPA embeddable written without the annotation), not a DTO.
	const owners = new Map<string, Set<string>>();
	for (const d of done.values()) {
		for (const f of d.fields) {
			for (const id of f.refs) {
				owners.set(id, (owners.get(id) ?? new Set()).add(d.raw.id));
			}
		}
	}
	const endpointRefs = new Set(endpoints.flatMap(e => [...e.returnRefs, ...e.params.flatMap(p => p.refs)]));
	const ownedBy = new Map<string, string>();
	const types: TypeInfo[] = [];
	for (const d of done.values()) {
		const { raw } = d;
		let r = role.get(raw.id)!;
		let why = dtoWhy.get(raw.id);
		if (why && /only fields|only public properties/.test(why) && !endpointRefs.has(raw.id)) {
			const by = [...(owners.get(raw.id) ?? [])].filter(id => id !== raw.id);
			if (by.length && by.every(id => role.get(id) === 'entity')) {
				r = 'entity';
				why = undefined;
				ownedBy.set(raw.id, done.get(by[0])!.raw.name);
			}
		}
		if (why && (r === 'class' || r === 'interface')) {
			r = 'dto';
		}
		const isDto = !!why && r === 'dto';
		types.push({
			id: raw.id, name: raw.name, qualifiedName: raw.qualifiedName, kind: raw.kind, lang: raw.lang, file: raw.file, line: raw.line, endLine: raw.endLine,
			module: raw.module, packageName: raw.packageName, role: r, isDto,
			dtoReason: isDto ? why! : r === 'entity' ? `entity (${ownedBy.has(raw.id) ? `owned by ${ownedBy.get(raw.id)}` : raw.annotations.find(a => /^(Entity|Table|MappedSuperclass|Document|Embeddable)$/.test(a)) ? '@' + raw.annotations.find(a => /^(Entity|Table|MappedSuperclass|Document|Embeddable)$/.test(a)) : mapped.has(raw.id) ? 'DbSet' : 'ORM model'})` : `not a DTO (${r})`,
			isAbstract: raw.isAbstract, supers: d.superRefs, typeParams: raw.typeParams, annotations: raw.annotations,
			fields: d.fields.map(({ anns: _a, init: _i, isFinal: _f, ...f }) => f), methods: d.methods, constants: raw.constants,
			ctorDeps: d.ctorDeps.map(x => x.id).sort(byCode), generatedAccessors: raw.generatedAccessors || undefined,
		});
	}
	types.sort((a, b) => byCode(a.id, b.id));
	const byId = new Map(types.map(t => [t.id, t]));

	// Edges.
	const edgeMap = new Map<string, TypeEdge>();
	const addEdge = (from: string, to: string, via: TypeEdge['via'], name: string, collection: Collection) => {
		if (from === to && via !== 'field') {
			return;
		}
		const key = `${from}|${to}|${via}${via === 'field' ? `|${name}` : ''}`;
		const hit = edgeMap.get(key);
		if (hit) {
			if (!hit.names.includes(name)) {
				hit.names.push(name);
			}
			if (collection === 'many' || (collection === 'optional' && hit.collection === 'one')) {
				hit.collection = collection;
			}
		} else {
			edgeMap.set(key, { from, to, via, names: name ? [name] : [], collection });
		}
	};
	for (const t of types) {
		const d = done.get(t.id)!;
		for (const s of t.supers) {
			if (s.id) {
				const target = byId.get(s.id)!;
				const relation = s.relation === 'implements' || (t.kind !== 'interface' && target.kind === 'interface') ? 'implements' : 'extends';
				s.relation = relation;
				addEdge(t.id, s.id, relation, '', 'one');
			}
		}
		for (const dep of d.ctorDeps) {
			addEdge(t.id, dep.id, 'ctor', dep.names.join(', '), 'one');
		}
		for (const f of t.fields) {
			for (const id of f.refs) {
				addEdge(t.id, id, 'field', f.name, f.collection);
			}
		}
		for (const m of t.methods) {
			if (!m.isConstructor) {
				for (const id of m.refs) {
					addEdge(t.id, id, 'method', m.name, 'one');
				}
			}
		}
		for (const id of d.superGenerics) {
			addEdge(t.id, id, 'generic', '', 'one');
		}
	}
	const edges = [...edgeMap.values()].sort((a, b) => byCode(a.from, b.from) || byCode(a.to, b.to) || byCode(a.via, b.via));

	// Modules.
	const modules = new Map<string, ModuleInfo>();
	for (const t of types) {
		const m = modules.get(t.module) ?? { name: t.module, types: 0 };
		m.types++;
		modules.set(t.module, m);
	}
	for (const f of src.poly?.files ?? []) {
		const m = modules.get(moduleOf(f.file).name);
		if (m && !m.root) {
			m.root = moduleOf(f.file).root;
		}
	}

	// Calls between classes, from the index.
	const calls: TypeCallEdge[] = [];
	const idOf = (file: string, name: string) => ownerOf.get(`${file}|${name}`)?.id;
	for (const c of src.poly?.calls ?? []) {
		const from = idOf(c.fromFile, c.fromOwner);
		const to = idOf(c.toFile, c.toOwner);
		if (from && to && from !== to) {
			calls.push({ from, to, count: c.count });
		}
	}
	calls.sort((a, b) => byCode(a.from, b.from) || byCode(a.to, b.to));

	return { options, types, byId, edges, modules: [...modules.values()].sort((a, b) => byCode(a.name, b.name)), calls, endpoints: endpoints.sort((a, b) => byCode(a.file, b.file) || a.line - b.line), funcs: funcs.sort((a, b) => byCode(a.file, b.file) || a.line - b.line) };
}

function polyEndpoint(e: PolyEntryFact, owner: Raw | undefined, resolve: Resolver, ctxOf: (file: string, owner: Raw | undefined, lang: TypeLang) => Raw, files: FileFacts[]): EndpointTypes {
	const lang = POLY_LANG[files.find(f => f.file === e.file)?.lang ?? 'java'] ?? 'java';
	const ctx = ctxOf(e.file, owner, lang);
	const params = e.params.map(p => {
		const rs = resolveText(resolve, ctx, p.typeText);
		return { name: p.name, type: displayType(p.typeText), refs: rs.refs, collection: rs.collection, body: p.anns.some(a => BODY_ONLY.has(a)) || undefined };
	});
	const ret = resolveText(resolve, ctx, e.returns);
	return {
		id: e.id, owner: owner?.id, controller: e.controller, action: e.action, http: e.http, file: e.file, line: e.line, params,
		returnType: e.returns ? displayType(e.returns) : undefined, returnRefs: ret.refs, returnCollection: ret.collection,
	};
}

// ── lookups ───────────────────────────────────────────────────────────────────────────────────────

/** A type by id, qualified name or simple name; when several share a simple name, the one nearest `fromFile` (same file, folder, module). */
export function findType(graph: TypeGraph, ref: string, fromFile?: string): TypeInfo | undefined {
	const direct = graph.byId.get(ref);
	if (direct) {
		return direct;
	}
	const name = ref.replace(/<.*$/, '').trim();
	const cands = graph.types.filter(t => t.id.endsWith(`:${name}`) || t.qualifiedName === name || t.name === name || t.qualifiedName.endsWith(`.${name}`) || t.qualifiedName.endsWith(`#${name}`));
	if (cands.length <= 1 || !fromFile) {
		return cands[0];
	}
	const dir = dirOf(fromFile);
	const score = (t: TypeInfo) => (t.file === fromFile ? 100 : 0) + (dirOf(t.file) === dir ? 50 : 0) + (norm(t.file).startsWith(dir.split('/').slice(0, -1).join('/')) ? 10 : 0) + (t.name === name ? 5 : 0);
	return [...cands].sort((a, b) => score(b) - score(a) || byCode(a.id, b.id))[0];
}
