/*---------------------------------------------------------------------------------------------
 *  Flow polyglot index: the project. Resolves every call to what it reaches (a method through the
 *  declared type of its receiver, an interface through its implementations, a table through the
 *  ORM or the SQL it runs), finds the entry points of each framework, and answers the canvas:
 *  the flow from a function, its callers, and the entry points a change would touch.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { isSpringRepo, isWrite, javaSchema, jsSchema, looksLikeSql, opsOf, pythonSchema, sqlTables, unq, type PrismaModel } from './db';
import type { CallFact, DbSchema, EntryPoint, FileFacts, FuncFact, RouteFact, TypeFact } from './model';

/** Same shape as the canvas (custom-ide/ui/src/types.ts); `guess` marks a link made by name alone. */
export interface FlowNode {
	key: string;
	symbolId: string | null;
	label: string;
	sub: string;
	kind: 'controller' | 'handler' | 'method' | 'db' | 'ambiguous' | 'external';
	file: string | null;
	startLine: number;
	endLine: number;
	code: string | null;
	children: { callLine: number; edgeKind: 'call' | 'mediator' | 'impl' | 'db'; guess?: boolean; node: FlowNode }[];
	schema?: DbSchema;
}

export interface Axis2Service {
	name: string;
	cls: string;
	/** SpringBeanName: the service object is a Spring bean. */
	bean?: string;
	operations: string[];
	file: string;
}

type Target =
	| { kind: 'fn'; fn: FuncFact; edge: 'call' | 'impl'; guess?: boolean }
	| { kind: 'ambiguous'; label: string; options: FuncFact[] }
	| { kind: 'db'; schema: DbSchema; label: string; file: string | null; line: number };

interface Entry extends EntryPoint {
	fn: FuncFact;
}

/** Names too common to link by name alone. */
const COMMON = new Set(['get', 'set', 'add', 'put', 'map', 'filter', 'find', 'push', 'pop', 'call', 'apply', 'bind', 'then', 'catch', 'log', 'info', 'warn', 'error', 'debug', 'toString', 'equals', 'hashCode', 'append', 'format', 'join', 'split', 'replace', 'trim', 'keys', 'values', 'items', 'update', 'remove', 'delete', 'clear', 'close', 'open', 'read', 'write', 'send', 'emit', 'on', 'off', 'run', 'start', 'stop', 'init', 'main', 'render', 'next', 'json', 'parse', 'stringify', 'length', 'size', 'isEmpty', 'contains', 'includes', 'indexOf', 'slice', 'sort', 'reduce', 'forEach', 'some', 'every', 'concat', 'execute', 'handle', 'process', 'validate', 'create', 'save', 'load', 'print', 'printf', 'println', 'valueOf', 'of', 'from', 'to', 'build', 'builder', 'getId', 'setId', 'getName', 'setName', '<init>', '__init__', 'constructor', 'super', 'require', 'isNull', 'isNotNull', 'notNull', 'assert', 'assertEquals', 'compareTo', 'iterator', 'stream', 'collect', 'getValue', 'setValue', 'getMessage', 'printStackTrace', 'currentTimeMillis', 'now', 'sleep', 'wait', 'notify', 'lock', 'unlock', 'exists', 'match', 'test', 'exec', 'query', 'fetch', 'request', 'response', 'status', 'text', 'redirect', 'append', 'appendChild', 'setAttribute', 'getAttribute', 'addEventListener', 'dispatch', 'subscribe', 'pipe', 'resolve', 'reject', 'all', 'any', 'race', 'is', 'has', 'hasNext', 'size', 'list', 'dict', 'len', 'str', 'int', 'float', 'bool', 'print', 'range', 'enumerate', 'zip', 'isinstance', 'getattr', 'setattr', 'hasattr', 'sorted', 'min', 'max', 'sum', 'abs', 'round', 'open', 'type', 'id']);

const HTTP_ANN: Record<string, string> = { GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT', DeleteMapping: 'DELETE', PatchMapping: 'PATCH', GET: 'GET', POST: 'POST', PUT: 'PUT', DELETE: 'DELETE', PATCH: 'PATCH', HEAD: 'HEAD', OPTIONS: 'OPTIONS', Get: 'GET', Post: 'POST', Put: 'PUT', Delete: 'DELETE', Patch: 'PATCH', All: '*', Head: 'HEAD', Options: 'OPTIONS' };
const PY_VERBS: Record<string, string> = { get: 'GET', post: 'POST', put: 'PUT', delete: 'DELETE', patch: 'PATCH', head: 'HEAD', options: 'OPTIONS', websocket: 'WS' };
const MAX_NODES = 220;

/** A record lookup that ignores Object.prototype (an import named `toString` is not a function). */
function own<T>(rec: Record<string, T> | undefined, key: string): T | undefined {
	return rec && Object.prototype.hasOwnProperty.call(rec, key) ? rec[key] : undefined;
}

const joinPath = (...parts: (string | undefined)[]) => {
	const p = parts.filter(x => x !== undefined && x !== '').map(x => x!.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
	return '/' + p;
};

export class Project {
	readonly files = new Map<string, FileFacts>();
	prisma: PrismaModel[] = [];
	axis2: Axis2Service[] = [];
	/** Page → the bean methods it triggers (JSF EL in .xhtml / .jsp). */
	readonly pageRefs = new Map<string, [string, string][]>();
	/** Spring XML: bean id → class FQN. */
	readonly xmlBeans = new Map<string, string>();
	private dirty = true;
	private typesByName = new Map<string, TypeFact[]>();
	private funcsById = new Map<string, FuncFact>();
	private methodsByOwner = new Map<string, FuncFact[]>();
	private funcsByName = new Map<string, FuncFact[]>();
	private fileByModule = new Map<string, string>();
	private impls = new Map<string, TypeFact[]>();
	private schemas = new Map<string, DbSchema & { orm: string }>();
	private schemaByTable = new Map<string, DbSchema & { orm: string }>();
	private entries: Entry[] = [];
	private callersOf: Map<string, { from: string; line: number }[]> | undefined;
	private resolved = new Map<string, Target[][]>();
	private sources = new Map<string, string[]>();

	constructor(private readonly roots: string[]) { }

	set(f: FileFacts) {
		this.files.set(f.file, f);
		this.dirty = true;
		this.sources.delete(f.file);
	}

	delete(file: string) {
		this.files.delete(file);
		this.dirty = true;
		this.sources.delete(file);
	}

	touched() {
		this.dirty = true;
	}

	private build() {
		if (!this.dirty) {
			return;
		}
		this.dirty = false;
		this.typesByName.clear();
		this.funcsById.clear();
		this.methodsByOwner.clear();
		this.funcsByName.clear();
		this.fileByModule.clear();
		this.impls.clear();
		this.schemas.clear();
		this.schemaByTable.clear();
		this.resolved.clear();
		this.callersOf = undefined;
		for (const f of this.files.values()) {
			if (f.module) {
				// Java: package → each type's FQN. Python: the dotted module and its suffixes.
				if (f.lang === 'java') {
					for (const t of f.types) {
						this.fileByModule.set(`${f.module}.${t.name}`, f.file);
					}
				} else {
					const parts = f.module.split('.');
					for (let i = 0; i < parts.length; i++) {
						const key = parts.slice(i).join('.');
						if (!this.fileByModule.has(key) || i === 0) {
							this.fileByModule.set(key, f.file);
						}
					}
				}
			}
			for (const t of f.types) {
				this.push(this.typesByName, t.name, t);
			}
			for (const fn of f.funcs) {
				this.funcsById.set(fn.id, fn);
				this.push(this.funcsByName, fn.name, fn);
				if (fn.owner) {
					this.push(this.methodsByOwner, `${fn.file}|${fn.owner}`, fn);
				}
			}
		}
		// Implementations: classes listing an interface (or abstract class) among their supers, transitively.
		for (const list of this.typesByName.values()) {
			for (const t of list) {
				const seen = new Set<string>();
				const queue = [...t.supers];
				while (queue.length) {
					const s = queue.shift()!;
					if (seen.has(s)) {
						continue;
					}
					seen.add(s);
					if (t.kind === 'class') {
						this.push(this.impls, s, t);
					}
					for (const st of this.typesByName.get(s) ?? []) {
						queue.push(...st.supers);
					}
				}
			}
		}
		this.buildSchemas();
		this.buildEntries();
	}

	private push<K, V>(m: Map<K, V[]>, k: K, v: V) {
		const list = m.get(k);
		if (list) {
			list.push(v);
		} else {
			m.set(k, [v]);
		}
	}

	private buildSchemas() {
		const add = (s: (Omit<DbSchema, 'ops' | 'writes' | 'context'>) | undefined, orm: string) => {
			if (!s) {
				return;
			}
			const full = { ...s, ops: [], writes: false, context: orm, orm };
			this.schemas.set(s.entity, full);
			this.schemaByTable.set(s.table.toLowerCase(), full);
			this.schemaByTable.set(s.table.toLowerCase().split('.').pop()!, full);
		};
		for (const f of this.files.values()) {
			for (const t of f.types) {
				if (f.lang === 'java') {
					add(javaSchema(t, this.inheritedFields(t)), 'JPA');
				} else if (f.lang === 'python') {
					const s = pythonSchema(t, f.module);
					add(s, s?.orm ?? '');
				} else {
					add(jsSchema(t), 'TypeORM');
				}
			}
		}
		for (const m of this.prisma) {
			add({ entity: m.name, table: m.table, dbSchemaName: null, columns: m.columns, relations: m.relations, file: m.file, line: m.line }, 'Prisma');
		}
	}

	private inheritedFields(t: TypeFact) {
		const out = [];
		let cur: TypeFact | undefined = t;
		for (let i = 0; i < 4 && cur; i++) {
			const sup: TypeFact | undefined = cur.supers.map(s => this.type(s, cur!.file)).find(x => x && x.kind === 'class');
			if (sup) {
				out.unshift(...sup.fields);
			}
			cur = sup;
		}
		return out;
	}

	/** The type a name means from a file: same file first, then an import, then the only one. */
	private type(name: string, from: string): TypeFact | undefined {
		const list = this.typesByName.get(name);
		if (!list?.length) {
			return undefined;
		}
		if (list.length === 1) {
			const imp = own(this.files.get(from)?.imports, name);
			if (imp && this.files.get(from)?.lang === 'java' && !this.fileByModule.has(imp)) {
				return undefined;
			}
			return list[0];
		}
		const local = list.find(t => t.file === from);
		if (local) {
			return local;
		}
		const facts = this.files.get(from);
		const imp = own(facts?.imports, name);
		if (imp) {
			const file = this.importFile(facts!, imp);
			const hit = file && list.find(t => t.file === file);
			if (hit) {
				return hit;
			}
		}
		if (facts?.lang === 'java' && imp && !this.fileByModule.has(imp)) {
			return undefined; // imported from a library (java.util.Locale), not the project's own type
		}
		// Java: same package
		const dir = path.dirname(from);
		return list.find(t => path.dirname(t.file) === dir) ?? list[0];
	}

	/** Where an import points: Java FQN, Python `module:name`, JS `./path:name`. */
	private importFile(facts: FileFacts, imp: string): string | undefined {
		if (facts.lang === 'java') {
			return this.fileByModule.get(imp);
		}
		const [mod] = imp.split(':');
		if (facts.lang === 'python') {
			return this.fileByModule.get(mod) ?? this.fileByModule.get(`${mod}.__init__`);
		}
		if (mod.startsWith('.') || mod.startsWith('@/') || mod.startsWith('~/')) {
			const base = mod.startsWith('.') ? path.resolve(path.dirname(facts.file), mod) : this.aliasPath(mod, facts.file);
			for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js']) {
				if (this.files.has(base + ext)) {
					return base + ext;
				}
			}
		}
		return undefined;
	}

	private aliasPath(mod: string, from: string) {
		const root = this.roots.find(r => from.startsWith(r)) ?? this.roots[0];
		const rel = mod.replace(/^[@~]\//, '');
		for (const dir of ['src', 'app', '']) {
			const p = path.join(root, dir, rel);
			for (const ext of ['.ts', '.tsx', '.js', '/index.ts']) {
				if (this.files.has(p + ext)) {
					return p;
				}
			}
		}
		return path.join(root, 'src', rel);
	}

	// ── Resolution ──────────────────────────────────────────────────────────────

	private methods(t: TypeFact, name: string): FuncFact[] {
		return (this.methodsByOwner.get(`${t.file}|${t.name}`) ?? []).filter(m => m.name === name);
	}

	/** A method by name on a type or its superclasses. */
	private lookup(t: TypeFact, name: string, depth = 0): FuncFact | undefined {
		const own = this.methods(t, name)[0];
		if (own || depth > 5) {
			return own;
		}
		for (const s of t.supers) {
			const st = this.type(s, t.file);
			const hit = st && this.lookup(st, name, depth + 1);
			if (hit) {
				return hit;
			}
		}
		return undefined;
	}

	private field(t: TypeFact, name: string, depth = 0): { type: string; args: string[] } | undefined {
		const f = t.fields.find(x => x.name === name);
		if (f) {
			return { type: f.type, args: f.typeArgs };
		}
		if (depth > 5) {
			return undefined;
		}
		for (const s of t.supers) {
			const st = this.type(s, t.file);
			const hit = st && this.field(st, name, depth + 1);
			if (hit) {
				return hit;
			}
		}
		return undefined;
	}

	private ownerOf(fn: FuncFact) {
		return fn.owner ? this.files.get(fn.file)?.types.find(t => t.name === fn.owner) : undefined;
	}

	/** The declared type of a receiver: local, parameter, field, module global; or the type itself (static call). */
	private recvType(fn: FuncFact, recv: string): { type: string; args: string[]; isType?: boolean } | undefined {
		const owner = this.ownerOf(fn);
		const facts = this.files.get(fn.file)!;
		const parts = recv.split('.');
		let head = parts[0];
		let rest = parts.slice(1);
		let cur: { type: string; args: string[]; isType?: boolean } | undefined;
		if ((head === 'this' || head === 'self') && owner) {
			if (!rest.length) {
				return { type: owner.name, args: [] };
			}
			head = rest[0];
			rest = rest.slice(1);
			cur = this.field(owner, head);
		} else {
			const local = own(fn.locals, head) ?? own(fn.params, head);
			if (local) {
				cur = { type: local, args: [] };
			} else if (owner && facts.lang === 'java') {
				cur = this.field(owner, head);
			}
			const global = own(facts.globals, head);
			if (!cur && global) {
				cur = { type: global, args: [] };
			}
			if (!cur && this.type(head, fn.file)) {
				cur = { type: head, args: [], isType: true };
			}
		}
		for (const seg of rest) {
			const t = cur && this.type(cur.type, fn.file);
			cur = t ? this.field(t, seg) : undefined;
		}
		return cur && cur.type ? cur : undefined;
	}

	private resolveCall(fn: FuncFact, c: CallFact): Target[] {
		const db = this.dbCall(fn, c);
		if (db) {
			return [db];
		}
		if (c.name === '<init>') {
			return [];
		}
		const facts = this.files.get(fn.file)!;
		const owner = this.ownerOf(fn);
		// Bare call: a method of this class (Java/self-less), a function in this module, or an imported one.
		if (!c.recv || c.recv === 'this' || c.recv === 'self' || c.recv === 'super') {
			if (owner && (facts.lang === 'java' || c.recv)) {
				const start = c.recv === 'super' ? owner.supers.map(s => this.type(s, fn.file)).find(Boolean) : owner;
				const m = start && this.lookup(start, c.name);
				if (m) {
					return this.viaType(start!, m, c.name);
				}
			}
			if (!c.recv) {
				const local = facts.funcs.find(f => !f.owner && f.name === c.name);
				if (local) {
					return [{ kind: 'fn', fn: local, edge: 'call' }];
				}
				const imp = own(facts.imports, c.name);
				if (imp) {
					const file = this.importFile(facts, imp);
					const name = imp.split(':')[1];
					const target = file && this.files.get(file)?.funcs.find(f => !f.owner && (f.name === name || (name === 'default' && f.exported)));
					if (target) {
						return [{ kind: 'fn', fn: target, edge: 'call' }];
					}
				}
			}
			return this.guess(fn, c);
		}
		// Module receiver (Python `import services`, JS `import * as svc`).
		const imp = own(facts.imports, c.recv);
		if (imp && (facts.lang !== 'java')) {
			const file = this.importFile(facts, imp.endsWith(':*') || facts.lang === 'python' ? imp : imp);
			const target = file && this.files.get(file)?.funcs.find(f => f.name === c.name && (!f.owner || facts.lang === 'js'));
			if (target) {
				return [{ kind: 'fn', fn: target, edge: 'call' }];
			}
			// JS: imported instance/class (`import userService from './user.service'`)
			const t = file && this.files.get(file)?.types[0];
			if (t) {
				const m = this.lookup(t, c.name);
				if (m) {
					return this.viaType(t, m, c.name);
				}
			}
		}
		const rt = this.recvType(fn, c.recv);
		const t = rt && this.type(rt.type, fn.file);
		if (t) {
			const m = this.lookup(t, c.name);
			if (m || t.kind === 'interface' || t.isAbstract) {
				return this.viaType(t, m, c.name);
			}
			return [];
		}
		return this.guess(fn, c);
	}

	/** A call through a type: an interface or abstract method resolves to its implementations. */
	private viaType(t: TypeFact, m: FuncFact | undefined, name: string): Target[] {
		const abstract = t.kind === 'interface' || (m && this.isAbstractMethod(m));
		if (!abstract) {
			return m ? [{ kind: 'fn', fn: m, edge: 'call' }] : [];
		}
		const impls = (this.impls.get(t.name) ?? []).map(i => this.lookup(i, name)).filter((x): x is FuncFact => !!x && !this.isAbstractMethod(x));
		const unique = [...new Map(impls.map(i => [i.id, i])).values()];
		if (unique.length === 1) {
			return [{ kind: 'fn', fn: unique[0], edge: 'impl' }];
		}
		if (unique.length > 1) {
			return [{ kind: 'ambiguous', label: `${t.name}.${name}`, options: unique }];
		}
		return m ? [{ kind: 'fn', fn: m, edge: 'call' }] : [];
	}

	private isAbstractMethod(m: FuncFact) {
		// No body: the extractor saw no calls and the declaration spans one line, or the owner is an interface.
		const owner = this.ownerOf(m);
		return owner?.kind === 'interface' || (m.endLine === m.line && m.calls.length === 0 && !!owner?.isAbstract);
	}

	/** Dynamic languages: link by a name found once in the whole project, and say it was a guess. */
	private guess(fn: FuncFact, c: CallFact): Target[] {
		// Java declares every type: a call we could not resolve is a library call, not a guess.
		if (this.files.get(fn.file)?.lang === 'java' || COMMON.has(c.name) || c.name.length < 4 || c.name.startsWith('_')) {
			return [];
		}
		const same = (this.funcsByName.get(c.name) ?? []).filter(f => f.id !== fn.id && !f.inlineRoute);
		if (same.length === 1) {
			return [{ kind: 'fn', fn: same[0], edge: 'call', guess: true }];
		}
		return [];
	}

	// ── Databases ───────────────────────────────────────────────────────────────

	private schema(entity: string | undefined, ops: string[], context: string, fn?: FuncFact): Target | undefined {
		if (!entity) {
			return undefined;
		}
		const s = this.schemas.get(entity);
		const writes = isWrite(ops, fn);
		if (s) {
			return { kind: 'db', schema: { ...s, ops, writes, context: context || s.orm }, label: s.table, file: s.file, line: s.line };
		}
		return { kind: 'db', schema: { entity, table: entity, dbSchemaName: null, context, columns: [], relations: [], ops, writes, file: null, line: 0 }, label: entity, file: null, line: 0 };
	}

	private sqlTarget(sql: string, ops: string[], context: string): Target | undefined {
		const { tables, writes, verb } = sqlTables(sql);
		if (!tables.length) {
			return undefined;
		}
		const name = tables[0];
		const known = this.schemaByTable.get(name.toLowerCase()) ?? this.schemaByTable.get(name.toLowerCase().split('.').pop()!) ?? this.schemas.get(name);
		// The SQL verb says what ran; prepareStatement / executeQuery / query are only how.
		const opList = [verb || ops[0], ...ops.slice(1)].filter(Boolean);
		const also = tables.slice(1).map(t => `joins ${t}`);
		if (known) {
			return { kind: 'db', schema: { ...known, ops: [...opList, ...also], writes: writes || isWrite(ops), context }, label: known.table, file: known.file, line: known.line };
		}
		return { kind: 'db', schema: { entity: name, table: name, dbSchemaName: name.includes('.') ? name.split('.')[0] : null, context, columns: [], relations: [], ops: [...opList, ...also], writes: writes || isWrite(ops), file: null, line: 0 }, label: name, file: null, line: 0 };
	}

	private sqlOf(fn: FuncFact, c: CallFact): string | undefined {
		const owner = this.ownerOf(fn);
		const fromVar = (v: string | undefined) => {
			if (!v) {
				return undefined;
			}
			const name = v.replace(/^this\./, '');
			if (own(fn.consts, name)) {
				return own(fn.consts, name);
			}
			const f = owner?.fields.find(x => x.name === name);
			return f?.init ? unq(f.init.replace(/"\s*\+\s*"/g, '')) : undefined;
		};
		return [...c.strings, fromVar(c.arg0) ?? ''].find(s => looksLikeSql(s));
	}

	private dbCall(fn: FuncFact, c: CallFact): Target | undefined {
		const lang = this.files.get(fn.file)!.lang;
		const ops = opsOf(c);
		const rt = c.recv ? this.recvType(fn, c.recv) : undefined;
		const rtype = rt && this.type(rt.type, fn.file);
		// Spring Data: repository.findByEmail(...)
		const repoEntity = isSpringRepo(rtype);
		if (repoEntity) {
			const m = rtype && this.lookup(rtype, c.name);
			const q = m?.annotations.find(a => a.name === 'Query');
			if (q?.value && looksLikeSql(q.value)) {
				const native = /nativeQuery\s*=\s*true/.test(Object.entries(q.named).map(([k, v]) => `${k}=${v}`).join());
				const t = native ? this.sqlTarget(q.value, ops, rtype!.name) : undefined;
				if (t) {
					return t;
				}
			}
			return this.schema(repoEntity, ops, rtype!.name, m);
		}
		const recvType = rt?.type ?? '';
		// TypeORM Repository<User> / MikroORM EntityRepository<User>
		if (/^(Repository|EntityRepository|MongoRepository|TreeRepository)$/.test(recvType)) {
			return this.schema(rt!.args[0] ?? this.fieldArg(fn, c.recv!), ops, 'TypeORM');
		}
		if (c.name === 'getRepository' && c.arg0) {
			return this.schema(c.arg0.replace(/\.class$/, ''), ops.slice(1), 'TypeORM');
		}
		// JPA / Hibernate / JDBC
		if (lang === 'java') {
			if (/^(EntityManager|Session|StatelessSession|HibernateTemplate|JdbcTemplate|NamedParameterJdbcTemplate|Connection|Statement|PreparedStatement|SqlSession|DSLContext|JdbcClient)$/.test(recvType) || /^(createQuery|createNativeQuery|createNamedQuery|prepareStatement|executeQuery|executeUpdate|queryForObject|queryForList|queryForMap|batchUpdate)$/.test(c.name)) {
				const sql = this.sqlOf(fn, c);
				if (sql) {
					if (c.name === 'createQuery' || c.name === 'createNamedQuery' || /^\s*(from|select\s+\w+\s+from)\s+[A-Z]/.test(sql)) {
						const entity = sql.match(/\b(?:from|join|update|delete\s+from)\s+([A-Z]\w*)/i)?.[1];
						if (entity && this.schemas.has(entity)) {
							return this.schema(entity, [sqlTables(sql).verb || 'SELECT', ...ops.slice(1)], recvType || 'JPA');
						}
					}
					return this.sqlTarget(sql, ops, recvType || 'JDBC');
				}
				if (/^(find|getReference|persist|merge|remove|get|load|save|update|delete|saveOrUpdate|refresh|detach)$/.test(c.name) && c.arg0) {
					const entity = c.arg0.match(/^(\w+)\.class$/)?.[1] ?? (own(fn.locals, c.arg0) ?? own(fn.params, c.arg0));
					if (entity && this.schemas.has(entity)) {
						return this.schema(entity, ops, recvType || 'JPA');
					}
				}
				if ((recvType === 'EntityManager' || recvType === 'Session') && !/^(getDelegate|unwrap|getMetamodel|getProperties|setProperty|isOpen|close|getTransaction|joinTransaction|contains|detach|clear|getEntityManagerFactory|setFlushMode|getFlushMode|getCriteriaBuilder|getSessionFactory)$/.test(c.name)) {
					return { kind: 'db', schema: { entity: '?', table: `${recvType}.${c.name}`, dbSchemaName: null, context: recvType, columns: [], relations: [], ops, writes: isWrite(ops), file: null, line: 0 }, label: `${recvType}.${c.name}`, file: null, line: 0 };
				}
			}
			return undefined;
		}
		if (lang === 'python') {
			// SQLAlchemy: session.query(User).filter(...).first() / select(User) / session.add(obj)
			if (c.name === 'query' && c.arg0 && this.schemas.has(c.arg0.split('.').pop()!)) {
				return this.schema(c.arg0.split('.').pop(), ops, 'SQLAlchemy');
			}
			if ((c.name === 'select' || c.name === 'insert' || c.name === 'update' || c.name === 'delete') && !c.recv && c.arg0 && this.schemas.has(c.arg0)) {
				return this.schema(c.arg0, [c.name, ...(c.chain ?? [])], 'SQLAlchemy');
			}
			if (/^(add|delete|merge)$/.test(c.name) && c.arg0 && /session|db/i.test(c.recv ?? '')) {
				const entity = own(fn.locals, c.arg0) ?? own(fn.params, c.arg0);
				if (entity && this.schemas.has(entity)) {
					return this.schema(entity, ops, 'SQLAlchemy');
				}
			}
			// Django: User.objects.filter(...)
			const m = c.recv?.match(/^(\w+)\.objects$/);
			if (m && this.schemas.has(m[1])) {
				return this.schema(m[1], ops, 'Django ORM');
			}
			if (c.recv && /^(save|delete|refresh_from_db)$/.test(c.name)) {
				const entity = own(fn.locals, c.recv) ?? own(fn.params, c.recv);
				if (entity && this.schemas.get(entity)?.orm === 'Django ORM') {
					return this.schema(entity, ops, 'Django ORM');
				}
			}
			if (/^(execute|executemany|exec_driver_sql|raw|fetch|fetchrow|fetchval)$/.test(c.name)) {
				const sql = this.sqlOf(fn, c);
				return sql ? this.sqlTarget(sql, ops, 'SQL') : undefined;
			}
			return undefined;
		}
		// JS: prisma.user.findMany() / this.prisma.order.create()
		if (c.recv) {
			const seg = c.recv.split('.');
			const model = seg.at(-1)!;
			const p = this.prisma.find(x => x.name.toLowerCase() === model.toLowerCase());
			if (p && seg.length >= 2 && /prisma|db|client/i.test(seg.at(-2)!)) {
				return this.schema(p.name, ops, 'Prisma');
			}
		}
		if (/^(query|execute|raw|run|all|get|prepare)$/.test(c.name) || c.name === 'sql') {
			const sql = this.sqlOf(fn, c);
			return sql ? this.sqlTarget(sql, ops, c.recv?.split('.').pop() ?? 'SQL') : undefined;
		}
		return undefined;
	}

	private fieldArg(fn: FuncFact, recv: string) {
		const owner = this.ownerOf(fn);
		const name = recv.replace(/^this\./, '');
		const f = owner?.fields.find(x => x.name === name);
		// @InjectRepository(User) private repo: Repository<User>
		return f?.typeArgs[0] ?? f?.annotations.find(a => a.name === 'InjectRepository')?.args[0];
	}

	// ── Entry points ────────────────────────────────────────────────────────────

	private buildEntries() {
		const out: Entry[] = [];
		const add = (fn: FuncFact, verb: string, route: string, controller?: string) => {
			out.push({ id: `poly:${fn.id}${out.some(e => e.fn.id === fn.id) ? `|${verb}` : ''}`, controller: controller ?? fn.owner ?? path.basename(fn.file).replace(/\.\w+$/, ''), action: fn.inlineRoute ? route : fn.name, http: `${verb} ${route}`, file: fn.file, line: fn.line, fn });
		};
		// Axis2 services and JSF pages name Spring/JSF beans; each becomes the class behind it.
		const axis2 = new Map<string, Axis2Service>();
		for (const s of this.axis2) {
			const t = s.cls ? this.typesByName.get(s.cls.split('.').pop()!)?.[0] : s.bean ? this.beanClass(s.bean) : undefined;
			if (t) {
				axis2.set(`${t.file}|${t.name}`, s);
			}
		}
		const seenJsf = new Set<string>();
		for (const [page, refs] of this.pageRefs) {
			for (const [bean, method] of refs) {
				const t = this.beanClass(bean);
				const m = t && this.lookup(t, method);
				if (m && !seenJsf.has(m.id)) {
					seenJsf.add(m.id);
					add(m, 'JSF', `#{${bean}.${method}}`, `${t!.name} · ${path.basename(page)}`);
				}
			}
		}
		for (const f of this.files.values()) {
			for (const t of f.types) {
				const anns = new Set(t.annotations.map(a => a.name));
				const methods = f.funcs.filter(fn => fn.owner === t.name);
				const classRoute = t.annotations.find(a => a.name === 'RequestMapping' || a.name === 'Path' || a.name === 'Controller' || a.name === 'Route')?.value;
				if (f.lang === 'java') {
					const spring = anns.has('RestController') || anns.has('Controller');
					const jaxrs = anns.has('Path');
					const soap = anns.has('WebService') && t.kind === 'class' ? t.name : undefined;
					const axis = axis2.get(`${t.file}|${t.name}`);
					const servlet = t.supers.includes('HttpServlet');
					for (const m of methods) {
						const ma = m.annotations;
						const verbAnn = ma.find(a => HTTP_ANN[a.name] && (spring ? /Mapping$/.test(a.name) : jaxrs ? /^[A-Z]+$/.test(a.name) : false));
						const reqMap = ma.find(a => a.name === 'RequestMapping');
						if (spring && (verbAnn || reqMap)) {
							const verb = verbAnn ? HTTP_ANN[verbAnn.name] : (reqMap!.named.method?.match(/(GET|POST|PUT|DELETE|PATCH)/)?.[1] ?? '*');
							add(m, verb, joinPath(classRoute, (verbAnn ?? reqMap)!.value));
						} else if (jaxrs && verbAnn) {
							add(m, HTTP_ANN[verbAnn.name], joinPath(classRoute, ma.find(a => a.name === 'Path')?.value));
						} else if (servlet && /^do(Get|Post|Put|Delete|Patch)$/.test(m.name)) {
							const ws = t.annotations.find(a => a.name === 'WebServlet');
							add(m, m.name.slice(2).toUpperCase(), ws?.value ?? `/${t.name}`);
						} else if ((axis || soap) && m.isPublic && !m.isStatic && m.name !== '<init>' && !/^(get|set|is)[A-Z]/.test(m.name) && (!axis?.operations.length || axis.operations.includes(m.name))) {
							add(m, 'SOAP', `${axis?.name ?? soap}/${m.name}`);
						} else if (ma.some(a => a.name === 'Scheduled')) {
							add(m, 'JOB', ma.find(a => a.name === 'Scheduled')!.named.cron ? unq(ma.find(a => a.name === 'Scheduled')!.named.cron)! : 'scheduled');
						} else if (ma.some(a => /^(KafkaListener|JmsListener|RabbitListener|SqsListener|StreamListener)$/.test(a.name))) {
							const l = ma.find(a => /Listener$/.test(a.name))!;
							add(m, 'MSG', unq(l.named.topics ?? l.named.destination ?? l.named.queues) ?? l.name);
						}
					}
				} else if (f.lang === 'js') {
					// NestJS: @Controller('users') + @Get(':id')
					if (anns.has('Controller')) {
						for (const m of methods) {
							const v = m.annotations.find(a => HTTP_ANN[a.name] && /^[A-Z][a-z]+$/.test(a.name));
							if (v) {
								add(m, HTTP_ANN[v.name], joinPath(classRoute, v.value));
							}
						}
					}
					for (const m of methods) {
						const l = m.annotations.find(a => /^(Cron|Interval|MessagePattern|EventPattern|Process|OnEvent)$/.test(a.name));
						if (l) {
							add(m, /Cron|Interval/.test(l.name) ? 'JOB' : 'MSG', l.value ?? l.name);
						}
					}
				} else if (f.lang === 'python') {
					// Django class-based views are added through urls; DRF ViewSets list their actions.
				}
			}
			if (f.lang === 'python') {
				for (const fn of f.funcs) {
					for (const a of fn.annotations) {
						const on = a.full.split('.')[0];
						const routerLike = /^(app|router|api|bp|blueprint|\w*_router|\w*_bp|\w*_app)$/i.test(on) || /^(FastAPI|APIRouter|Flask|Blueprint|Sanic|Quart)$/.test(own(f.globals, on) ?? '');
						if (routerLike && a.full.includes('.') && (PY_VERBS[a.name] || a.name === 'route' || a.name === 'api_route')) {
							const verbs = PY_VERBS[a.name] ? [PY_VERBS[a.name]] : (a.named.methods?.match(/[A-Z]+/g) ?? ['GET']);
							for (const v of verbs) {
								add(fn, v, joinPath(...this.pyPrefixes(f, on), a.value));
							}
						} else if (/^(shared_task|task|periodic_task|job|scheduled_job)$/.test(a.name)) {
							add(fn, 'JOB', a.full);
						} else if (a.name === 'api_view' && !f.routes.length) {
							// DRF function view: its path comes from urls.py
						}
					}
				}
			}
			for (const r of f.routes) {
				this.routeEntries(f, r, '', add, 0);
			}
			// Next.js app router: app/**/route.ts exports GET/POST…
			const rel = f.file.replace(/\\/g, '/');
			const appRoute = rel.match(/\/app\/(.*)\/route\.(m?[jt]sx?)$/);
			const pagesApi = rel.match(/\/pages\/api\/(.*)\.(m?[jt]sx?)$/);
			if (f.lang === 'js' && (appRoute || pagesApi)) {
				for (const fn of f.funcs.filter(x => x.exported && !x.owner)) {
					if (appRoute && /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/.test(fn.name)) {
						add(fn, fn.name, '/' + appRoute[1].replace(/\([^)]*\)\/?/g, '').replace(/\[([^\]]+)\]/g, ':$1'), 'route');
					} else if (pagesApi && fn.name === 'default') {
						add(fn, '*', '/api/' + pagesApi[1].replace(/\/index$/, '').replace(/\[([^\]]+)\]/g, ':$1'), 'api');
					}
				}
			}
		}
		this.entries = out;
	}

	/** The class behind a bean name: Spring XML, @Service("x") / @Named("x") / @ManagedBean(name = "x"), or the class name. */
	private beanClass(bean: string): TypeFact | undefined {
		const fqn = this.xmlBeans.get(bean);
		if (fqn) {
			const file = this.fileByModule.get(fqn);
			const t = file && this.files.get(file)?.types.find(x => x.name === fqn.split('.').pop());
			if (t) {
				return t;
			}
		}
		const named = /^(Service|Component|Controller|RestController|Repository|ManagedBean|Named)$/;
		let byName: TypeFact | undefined;
		for (const list of this.typesByName.values()) {
			for (const t of list) {
				const a = t.annotations.find(x => named.test(x.name));
				if (a && (unq(a.named.name) ?? a.value) === bean) {
					return t;
				}
				if (!byName && t.kind === 'class' && t.name.charAt(0).toLowerCase() + t.name.slice(1) === bean) {
					byName = t;
				}
			}
		}
		if (byName) {
			return byName;
		}
		const cap = bean.charAt(0).toUpperCase() + bean.slice(1);
		return this.typesByName.get(`${cap}Impl`)?.[0] ?? (this.impls.get(cap) ?? [])[0];
	}

	/** FastAPI / Flask prefixes: the router's own (`APIRouter(prefix=)`) and where another file includes it. */
	private pyPrefixes(f: FileFacts, on: string): (string | undefined)[] {
		const mine = own(f.prefixes, on);
		for (const g of this.files.values()) {
			for (const [k, v] of Object.entries(g.prefixes)) {
				if (!k.startsWith('include:')) {
					continue;
				}
				const ref = k.slice(8);
				const [head, tail] = ref.includes('.') ? [ref.split('.')[0], ref.split('.').slice(1).join('.')] : [ref, undefined];
				const imp = own(g.imports, head);
				if (!imp) {
					continue;
				}
				const file = this.importFile(g, tail ? imp.replace(/:.*$/, '') + (imp.includes(':') ? '.' + imp.split(':')[1] : '') : imp);
				if (file === f.file && (tail ?? imp.split(':')[1]) === on) {
					return [v, mine];
				}
			}
		}
		return [mine];
	}

	private routeEntries(f: FileFacts, r: RouteFact, prefix: string, add: (fn: FuncFact, verb: string, route: string, controller?: string) => void, depth: number) {
		if (depth > 4) {
			return;
		}
		if (r.verb === 'INCLUDE') {
			const file = this.fileByModule.get(r.handler);
			const g = file ? this.files.get(file) : undefined;
			for (const sub of g?.routes ?? []) {
				this.routeEntries(g!, sub, joinPath(prefix, r.path), add, depth + 1);
			}
			return;
		}
		if (f.lang === 'python' && depth === 0 && this.isIncluded(f)) {
			return; // reached through the urls.py that includes it
		}
		const route = f.lang === 'js' ? joinPath(this.jsPrefix(f, r.on), r.path) : joinPath(prefix, r.path);
		const inline = this.funcsById.get(r.handler);
		const fn = inline ? [inline] : this.handlerFn(f, r.handler);
		if (fn.length === 0) {
			return;
		}
		for (const x of fn) {
			const verb = r.verb === '*' && f.lang === 'python' && x.owner && PY_VERBS[x.name] ? PY_VERBS[x.name] : r.verb;
			add(x, verb, route, x.owner);
		}
	}

	private isIncluded(f: FileFacts) {
		for (const g of this.files.values()) {
			if (g.routes.some(r => r.verb === 'INCLUDE' && this.fileByModule.get(r.handler) === f.file)) {
				return true;
			}
		}
		return false;
	}

	private jsPrefix(f: FileFacts, on: string | undefined) {
		if (!on) {
			return '';
		}
		if (own(f.prefixes, on) !== undefined) {
			return own(f.prefixes, on);
		}
		// app.use('/api/users', usersRouter) in another file, where usersRouter is this file's export.
		for (const g of this.files.values()) {
			for (const [k, v] of Object.entries(g.prefixes)) {
				const imp = own(g.imports, k);
				if (imp && this.importFile(g, imp) === f.file) {
					return v;
				}
			}
		}
		return '';
	}

	/** A route handler as written: fn, views.fn, ctrl.method, View.as_view(). */
	private handlerFn(f: FileFacts, handler: string): FuncFact[] {
		const h = handler.replace(/\.as_view\(.*\)$/, '').replace(/\.bind\(.*\)$/, '');
		const parts = h.split('.');
		const name = parts.at(-1)!;
		if (parts.length === 1) {
			const local = f.funcs.find(x => !x.owner && x.name === name);
			if (local) {
				return [local];
			}
			const t = f.types.find(x => x.name === name) ?? this.type(name, f.file);
			if (t) {
				// class-based view: its HTTP methods
				return f.lang === 'python' ? (this.methodsByOwner.get(`${t.file}|${t.name}`) ?? []).filter(m => PY_VERBS[m.name]) : [];
			}
			const imp = own(f.imports, name);
			const file = imp && this.importFile(f, imp);
			const target = file && this.files.get(file)?.funcs.find(x => !x.owner && (x.name === imp.split(':')[1] || (imp.endsWith(':default') && x.exported)));
			return target ? [target] : [];
		}
		const head = parts[0];
		const imp = own(f.imports, head);
		const file = imp ? this.importFile(f, imp.includes(':') || f.lang !== 'python' ? imp : imp) ?? this.fileByModule.get(imp.replace(':', '.')) : undefined;
		const g = file ? this.files.get(file) : f;
		if (!g) {
			return [];
		}
		const fn = g.funcs.find(x => x.name === name && (!x.owner || parts.length === 2));
		if (fn) {
			return [fn];
		}
		const t = g.types.find(x => x.name === name);
		if (t && f.lang === 'python') {
			return (this.methodsByOwner.get(`${t.file}|${t.name}`) ?? []).filter(m => PY_VERBS[m.name]);
		}
		return [];
	}

	// ── Queries from the canvas ─────────────────────────────────────────────────

	entryPoints(): EntryPoint[] {
		this.build();
		return this.entries.map(({ fn: _fn, ...e }) => e);
	}

	private fnFor(id: string): FuncFact | undefined {
		this.build();
		const raw = id.replace(/^poly:/, '').replace(/\|[A-Z*]+$/, '');
		return this.funcsById.get(raw) ?? this.relocate(raw);
	}

	/** An id from before an edit (its line moved): find the function by file, owner and name. */
	private relocate(id: string) {
		const m = id.match(/^(.*)#(?:(\w+)\.)?([^@]+)@\d+$/);
		if (!m) {
			return undefined;
		}
		const [, file, owner, name] = m;
		return this.files.get(file)?.funcs.find(f => f.name === name && (f.owner ?? undefined) === (owner ?? undefined));
	}

	/** getName() { return name; }: plumbing, not flow. */
	private isAccessor(fn: FuncFact) {
		return /^(get|set|is|has)[A-Z]/.test(fn.name) && fn.calls.length === 0 && fn.endLine - fn.line <= 4;
	}

	private targets(fn: FuncFact): Target[][] {
		let t = this.resolved.get(fn.id);
		if (!t) {
			t = fn.calls.map(c => this.resolveCall(fn, c).filter(x => x.kind !== 'fn' || !this.isAccessor(x.fn)));
			this.resolved.set(fn.id, t);
		}
		return t;
	}

	private code(fn: { file: string; line: number; endLine: number }) {
		let lines = this.sources.get(fn.file);
		if (!lines) {
			try {
				lines = fs.readFileSync(fn.file, 'utf8').split('\n');
			} catch {
				lines = [];
			}
			this.sources.set(fn.file, lines);
			if (this.sources.size > 300) {
				this.sources.delete(this.sources.keys().next().value!);
			}
		}
		return lines.slice(fn.line - 1, fn.endLine).join('\n');
	}

	private entryOf(fn: FuncFact) {
		return this.entries.find(e => e.fn.id === fn.id);
	}

	graph(id: string, depth = 5): FlowNode {
		const root = this.fnFor(id);
		if (!root) {
			throw new Error('This function is no longer in the index. Save the file and try again.');
		}
		let key = 0;
		let count = 0;
		const node = (fn: FuncFact, kind: FlowNode['kind'], d: number, trail: Set<string>): FlowNode => {
			count++;
			const entry = this.entryOf(fn);
			const n: FlowNode = {
				key: `p${key++}`,
				symbolId: `poly:${fn.id}`,
				label: fn.inlineRoute ? `${fn.inlineRoute.verb} ${fn.inlineRoute.path}` : fn.owner ? `${fn.owner}.${fn.name}` : fn.name,
				sub: entry ? entry.http : path.basename(fn.file),
				kind,
				file: fn.file,
				startLine: fn.line,
				endLine: fn.endLine,
				code: this.code(fn),
				children: [],
			};
			if (d >= depth || count > MAX_NODES) {
				return n;
			}
			const seen = new Set<string>();
			const all = this.targets(fn);
			fn.calls.forEach((c, i) => {
				for (const t of all[i]) {
					if (count > MAX_NODES) {
						return;
					}
					if (t.kind === 'db') {
						const k = `db:${t.label}:${t.schema.ops.join('.')}`;
						if (seen.has(k)) {
							continue;
						}
						seen.add(k);
						count++;
						n.children.push({ callLine: c.line, edgeKind: 'db', node: { key: `p${key++}`, symbolId: null, label: t.label, sub: t.schema.context, kind: 'db', file: t.file, startLine: t.line, endLine: t.line, code: null, children: [], schema: t.schema } });
					} else if (t.kind === 'ambiguous') {
						if (seen.has(t.label)) {
							continue;
						}
						seen.add(t.label);
						count++;
						const amb: FlowNode = { key: `p${key++}`, symbolId: null, label: t.label, sub: `${t.options.length} implementations`, kind: 'ambiguous', file: null, startLine: 0, endLine: 0, code: null, children: [] };
						for (const o of t.options.slice(0, 6)) {
							if (!trail.has(o.id)) {
								amb.children.push({ callLine: c.line, edgeKind: 'impl', node: node(o, 'method', d + 1, new Set([...trail, o.id])) });
							}
						}
						n.children.push({ callLine: c.line, edgeKind: 'call', node: amb });
					} else {
						if (seen.has(t.fn.id) || trail.has(t.fn.id)) {
							continue;
						}
						seen.add(t.fn.id);
						n.children.push({ callLine: c.line, edgeKind: t.edge, ...(t.guess ? { guess: true } : {}), node: node(t.fn, 'method', d + 1, new Set([...trail, t.fn.id])) });
					}
				}
			});
			return n;
		};
		return node(root, this.entryOf(root) ? 'controller' : 'method', 0, new Set([root.id]));
	}

	private buildCallers() {
		if (this.callersOf) {
			return this.callersOf;
		}
		const map = new Map<string, { from: string; line: number }[]>();
		for (const fn of this.funcsById.values()) {
			const all = this.targets(fn);
			fn.calls.forEach((c, i) => {
				for (const t of all[i]) {
					const ids = t.kind === 'fn' ? [t.fn.id] : t.kind === 'ambiguous' ? t.options.map(o => o.id) : [];
					for (const id of ids) {
						this.push(map, id, { from: fn.id, line: c.line });
					}
				}
			});
		}
		this.callersOf = map;
		return map;
	}

	callers(id: string, depth = 3): FlowNode | null {
		const root = this.fnFor(id);
		if (!root) {
			return null;
		}
		this.build();
		const map = this.buildCallers();
		let key = 0;
		const node = (fn: FuncFact, d: number, trail: Set<string>): FlowNode => {
			const entry = this.entryOf(fn);
			const n: FlowNode = { key: `c${key++}`, symbolId: `poly:${fn.id}`, label: fn.owner ? `${fn.owner}.${fn.name}` : fn.name, sub: entry?.http ?? path.basename(fn.file), kind: entry ? 'controller' : 'method', file: fn.file, startLine: fn.line, endLine: fn.endLine, code: this.code(fn), children: [] };
			if (d >= depth) {
				return n;
			}
			const seen = new Set<string>();
			for (const c of map.get(fn.id) ?? []) {
				const from = this.funcsById.get(c.from);
				if (!from || seen.has(from.id) || trail.has(from.id)) {
					continue;
				}
				seen.add(from.id);
				n.children.push({ callLine: c.line, edgeKind: 'call', node: node(from, d + 1, new Set([...trail, from.id])) });
			}
			return n;
		};
		return node(root, 0, new Set([root.id]));
	}

	/** Entry points that reach this function (or, when none do, the top-most callers). */
	impact(id: string): { label: string; items: string[] } {
		const root = this.fnFor(id);
		if (!root) {
			return { label: 'entry point', items: [] };
		}
		this.build();
		const map = this.buildCallers();
		const found = new Set<string>();
		const tops = new Set<string>();
		const seen = new Set<string>([root.id]);
		const queue = [root.id];
		while (queue.length && seen.size < 5000) {
			const cur = queue.shift()!;
			const fn = this.funcsById.get(cur)!;
			const e = this.entryOf(fn);
			if (e) {
				found.add(`${e.http} ${e.controller}.${e.action}`);
			}
			const up = map.get(cur) ?? [];
			if (!up.length && cur !== root.id) {
				tops.add(fn.owner ? `${fn.owner}.${fn.name}` : fn.name);
			}
			for (const c of up) {
				if (!seen.has(c.from)) {
					seen.add(c.from);
					queue.push(c.from);
				}
			}
		}
		return found.size ? { label: 'entry point', items: [...found].sort() } : { label: 'caller', items: [...tops].sort() };
	}

	/** The innermost function around a line, for "flow at cursor" and follow mode. */
	functionAt(file: string, line: number): { id: string; label: string } | undefined {
		this.build();
		const f = this.files.get(file);
		const hit = f?.funcs.filter(fn => fn.line <= line && line <= fn.endLine).sort((a, b) => (a.endLine - a.line) - (b.endLine - b.line))[0];
		return hit && { id: `poly:${hit.id}`, label: hit.inlineRoute ? `${hit.inlineRoute.verb} ${hit.inlineRoute.path}` : hit.owner ? `${hit.owner}.${hit.name}` : hit.name };
	}

	/** Functions in a file, for the ◆ Flow lenses. */
	methodsIn(file: string): { id: string; name: string; line: number; isEntry: boolean }[] {
		this.build();
		return (this.files.get(file)?.funcs ?? []).filter(fn => !fn.inlineRoute || true).map(fn => ({ id: `poly:${fn.id}`, name: fn.owner ? `${fn.owner}.${fn.name}` : fn.name, line: fn.line, isEntry: !!this.entryOf(fn) }));
	}

	stats() {
		this.build();
		let funcs = 0;
		for (const f of this.files.values()) {
			funcs += f.funcs.length;
		}
		return { files: this.files.size, funcs, entries: this.entries.length, tables: new Set([...this.schemas.values()].map(s => s.table)).size };
	}
}
