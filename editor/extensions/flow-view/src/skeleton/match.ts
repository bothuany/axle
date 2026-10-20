/*---------------------------------------------------------------------------------------------
 *  Axle skeleton first: the plan an agent drew (a class or ER board) against the types the developer wrote (the type graph).
 *  Every planned type and member comes out as matches, missing or differs, with what the code has instead. The plan is
 *  the design and the code is the truth: nothing here changes either. Tolerant on purpose (see docs/design/skeleton-first.md):
 *  parameter names, packages, collection and optional wrappers do not count, extra helpers are fine, and a rename is
 *  reported as one. Pure: no vscode, no fs.
 *--------------------------------------------------------------------------------------------*/

import type { BoardMember, BoardNode, BoardSpec, CheckState } from '../board/spec';
import type { TypeEdge, TypeGraph, TypeInfo } from '../types/model';

export type { CheckState };

export interface MemberResult {
	/** The planned member, as drawn. */
	text: string;
	check: CheckState;
	/** Why it differs or is missing, for the developer and the agent. */
	note?: string;
	/** The member as the code has it: `name(params): ret` or `name: type`. */
	actual?: string;
	line?: number;
}

export interface RelationResult {
	to: string;
	kind: string;
	check: 'matches' | 'missing';
}

export interface NodeResult {
	id: string;
	label: string;
	check: CheckState;
	note?: string;
	/** The type it was matched to. */
	typeId?: string;
	name?: string;
	kind?: string;
	file?: string;
	line?: number;
	members: MemberResult[];
	relations: RelationResult[];
	/** Public members the plan does not name: fine, listed for the record. */
	extra: string[];
}

export interface SkeletonDiff {
	/** false while the code index or the analyzer is still loading: nothing is reported missing then. */
	ready: boolean;
	nodes: NodeResult[];
	counts: Record<CheckState, number>;
}

export interface MatchOptions {
	/** Files the developer changed since the design was drawn: a name that two types share goes to the one in such a file. */
	recent?: (file: string) => boolean;
	ready?: boolean;
}

/** Nodes that stand for a type of the code; notes, actors, steps and outside systems are not checked. */
const UNCHECKED_KINDS = new Set(['note', 'actor', 'step', 'decision', 'entry', 'external']);

export const isCheckedNode = (n: BoardNode) => !UNCHECKED_KINDS.has(n.kind ?? 'class');

// ── names and types ────────────────────────────────────────────────────────────────────────────

/** The type name a node label holds: `«interface» DiscountPolicy`, `Repository<T>`, `orders (table)` → the name alone. */
export function nodeName(n: Pick<BoardNode, 'label' | 'id'>): string {
	const label = n.label.replace(/«[^»]*»/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/<.*$/, ' ').trim();
	const word = /[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*/.exec(label)?.[0] ?? n.id;
	return word.split('.').pop()!;
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The keys a planned name may be written as: `orders` and `order_line` find `Order` and `OrderLine`. */
function nameKeys(name: string): string[] {
	const k = key(name);
	const out = new Set([k]);
	if (k.endsWith('ies')) {
		out.add(k.slice(0, -3) + 'y');
	} else if (k.endsWith('ses') || k.endsWith('xes')) {
		out.add(k.slice(0, -2));
	} else if (k.endsWith('s') && k.length > 2) {
		out.add(k.slice(0, -1));
	}
	for (const suffix of ['entity', 'model', 'record', 'table']) {
		if (k.endsWith(suffix) && k.length > suffix.length + 1) {
			out.add(k.slice(0, -suffix.length));
		}
	}
	return [...out];
}

/** How alike two names are, 0..1 (edit distance over the longer). */
export function similarity(a: string, b: string): number {
	const x = key(a);
	const y = key(b);
	if (!x || !y) {
		return 0;
	}
	if (x === y) {
		return 1;
	}
	const row = Array.from({ length: y.length + 1 }, (_, i) => i);
	for (let i = 1; i <= x.length; i++) {
		let prev = row[0];
		row[0] = i;
		for (let j = 1; j <= y.length; j++) {
			const cur = row[j];
			row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
			prev = cur;
		}
	}
	const ratio = 1 - row[y.length] / Math.max(x.length, y.length);
	// One name inside the other (Discount → DiscountPolicy) counts as alike as well.
	return x.includes(y) || y.includes(x) ? Math.max(ratio, 0.7) : ratio;
}

/** Wrappers that do not change what a type is about: collections (→ many), optionals, async results. */
const MANY = new Set(['list', 'ilist', 'ienumerable', 'enumerable', 'icollection', 'collection', 'set', 'iset', 'hashset', 'array', 'arraylist', 'linkedlist', 'sequence', 'iterable', 'readonlyarray', 'readonlylist', 'ireadonlylist', 'ireadonlycollection', 'vec', 'slice', 'stream', 'flux', 'iqueryable', 'queryset', 'tuple']);
const WRAP = new Set(['optional', 'nullable', 'maybe', 'option', 'promise', 'task', 'valuetask', 'mono', 'completablefuture', 'future', 'observable', 'awaitable', 'coroutine', 'responseentity', 'actionresult', 'iactionresult', 'result', 'readonly', 'final', 'const', 'mut', 'ref', 'out', 'in', 'params']);
const NOTHING = new Set(['null', 'undefined', 'none', 'nil']);
const CANON: Record<string, string> = {
	integer: 'int', long: 'int', short: 'int', i8: 'int', i16: 'int', i32: 'int', i64: 'int', u8: 'int', u16: 'int', u32: 'int', u64: 'int', usize: 'int', isize: 'int', int32: 'int', int64: 'int', uint: 'int', biginteger: 'int', bigint: 'int', byte: 'int',
	double: 'float', decimal: 'float', f32: 'float', f64: 'float', float32: 'float', float64: 'float', bigdecimal: 'float', real: 'float',
	str: 'string', char: 'string', charsequence: 'string', text: 'string',
	boolean: 'bool',
	unit: 'void',
	datetime: 'date', datetimeoffset: 'date', localdate: 'date', localdatetime: 'date', instant: 'date', timestamp: 'date', offsetdatetime: 'date',
	uuid: 'guid',
	object: 'any', unknown: 'any', dynamic: 'any',
	dict: 'map', dictionary: 'map', idictionary: 'map', hashmap: 'map', record: 'map',
};

interface TypeShape { tokens: string[]; many: boolean }

/** What a declared type is made of, as comparable tokens: `List<com.acme.OrderLine>?` → many of orderline. */
export function typeShape(type: string | undefined): TypeShape | undefined {
	if (!type || !type.trim()) {
		return undefined;
	}
	const many = /\[\s*\]|\.\.\.|\*\s*$/.test(type);
	const words = type.replace(/[\w$]+(?:\.[\w$]+)+/g, m => m.split('.').pop()!).match(/[A-Za-z_$][\w$]*/g) ?? [];
	let isMany = many;
	const tokens: string[] = [];
	for (const w of words) {
		const k = w.toLowerCase();
		if (MANY.has(k)) {
			isMany = true;
		} else if (!WRAP.has(k) && !NOTHING.has(k)) {
			tokens.push(CANON[k] ?? k);
		}
	}
	return tokens.length || isMany ? { tokens, many: isMany } : { tokens: ['void'], many: false };
}

const tokenMatch = (a: string, b: string) => a === b || ((a === 'number' || b === 'number') && /^(int|float|number)$/.test(a) && /^(int|float|number)$/.test(b)) || a === 'any' || b === 'any';

/** Whether two declared types say the same thing; an unknown side (untyped code, a plan without a type) never differs. */
export function sameType(a: string | undefined, b: string | undefined): boolean {
	const x = typeShape(a);
	const y = typeShape(b);
	if (!x || !y) {
		return true;
	}
	return x.many === y.many && x.tokens.length === y.tokens.length && x.tokens.every((t, i) => tokenMatch(t, y.tokens[i]));
}

// ── members ────────────────────────────────────────────────────────────────────────────────────

export interface ParsedMember {
	name: string;
	kind: 'method' | 'field';
	/** Parameter types; undefined entries are parameters without a type. */
	params?: (string | undefined)[];
	/** Return type (methods) or the field's type. */
	type?: string;
}

const MODIFIERS = /^(?:public|private|protected|internal|static|readonly|final|abstract|async|override|virtual|sealed|def|fun|func|fn|const|let|var|val|pub|get|set|required|open|suspend|export|default|new)\s+/;

/** Top-level comma split: `Map<K, V> a, int b` → two parts. */
function splitTop(s: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let cur = '';
	for (const ch of s) {
		if ('<([{'.includes(ch)) {
			depth++;
		} else if ('>)]}'.includes(ch)) {
			depth--;
		}
		if (ch === ',' && depth === 0) {
			out.push(cur);
			cur = '';
		} else {
			cur += ch;
		}
	}
	return cur.trim() ? [...out, cur] : out;
}

/** `name: T`, `T name`, `name` (and Python's `name: T = x`, TypeScript's `name?: T`) → its type, when it says one. */
function nameAndType(decl: string): { name: string; type?: string } | undefined {
	const s = decl.replace(/=.*$/s, '').replace(/^[@\w.]+\s*\([^)]*\)\s*/, '').trim().replace(/^(?:\*\*?|&)/, '');
	if (!s) {
		return undefined;
	}
	const colon = /^([A-Za-z_$][\w$]*)\??\s*:\s*(.+)$/.exec(s);
	if (colon) {
		return { name: colon[1], type: colon[2].trim() };
	}
	const words = s.replace(/\s*([<[,])\s*/g, '$1').replace(/\s+([>\]?])/g, '$1').split(/\s+/);
	if (words.length === 1) {
		return { name: words[0].replace(/[?!]$/, '') };
	}
	return { name: words[words.length - 1].replace(/[?!]$/, ''), type: words.slice(0, -1).join(' ') };
}

/** A member as written on a board or as the type graph spells it, in any of the usual notations. */
export function parseMember(text: string, kind?: BoardMember['kind']): ParsedMember | undefined {
	let s = text.trim().replace(/^[+\-#~]\s*/, '').replace(/;$/, '');
	while (MODIFIERS.test(s)) {
		s = s.replace(MODIFIERS, '');
	}
	const open = s.indexOf('(');
	if (open > 0 && kind !== 'field' && kind !== 'property') {
		let depth = 0;
		let close = -1;
		for (let i = open; i < s.length; i++) {
			if (s[i] === '(') {
				depth++;
			} else if (s[i] === ')' && --depth === 0) {
				close = i;
				break;
			}
		}
		const head = s.slice(0, open).trim().split(/\s+/);
		const name = head.pop()!.replace(/<.*$/, '');
		if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
			return undefined;
		}
		const inside = close > 0 ? s.slice(open + 1, close) : s.slice(open + 1);
		const params = splitTop(inside).map(p => nameAndType(p)).filter((p): p is { name: string; type?: string } => !!p && p.name !== 'self' && p.name !== 'cls' && p.name !== 'this').map(p => p.type);
		const rest = close > 0 ? s.slice(close + 1).trim() : '';
		const after = /^(?::|->|=>)\s*(.+)$/.exec(rest)?.[1]?.replace(/\{.*$/s, '').trim();
		const before = head.length ? head.join(' ') : undefined;
		return { name, kind: 'method', params, type: after || before };
	}
	const nt = nameAndType(s);
	return nt && /^[A-Za-z_$][\w$]*$/.test(nt.name) ? { name: nt.name, kind: 'field', type: nt.type } : undefined;
}

const CTOR_NAMES = new Set(['constructor', '__init__', 'init', 'new', '__construct', 'initialize']);

interface Actual { name: string; kind: 'method' | 'field'; parsed: ParsedMember; text: string; line?: number; isPublic: boolean; isPlumbing: boolean; isCtor?: boolean }

function actualMembers(t: TypeInfo): Actual[] {
	const fields: Actual[] = t.fields.map(f => ({ name: f.name, kind: 'field', parsed: { name: f.name, kind: 'field', type: f.type }, text: `${f.name}: ${f.type}`, line: f.line, isPublic: f.visibility === '+', isPlumbing: false }));
	const methods: Actual[] = t.methods.map(m => {
		const parsed = parseMember(`${m.name}${m.signature}`, 'method') ?? { name: m.name, kind: 'method' as const };
		return { name: m.name, kind: 'method', parsed, text: `${m.name}${m.signature}`, line: m.line, isPublic: m.visibility === '+', isPlumbing: !!m.isConstructor || !!m.isAccessor, isCtor: !!m.isConstructor };
	});
	const constants: Actual[] = (t.constants ?? []).map(c => ({ name: c, kind: 'field', parsed: { name: c, kind: 'field' }, text: c, isPublic: true, isPlumbing: false }));
	return [...fields, ...methods, ...constants];
}

const sameName = (a: string, b: string) => key(a) === key(b);

/** A planned property also matches a getter: `name` ↔ `getName()` / `isName()`. */
const getterOf = (planned: string, actual: string) => key(actual) === 'get' + key(planned) || key(actual) === 'is' + key(planned);

function describeParsed(p: ParsedMember) {
	return p.kind === 'method' ? `${p.name}(${(p.params ?? []).map(x => x ?? '?').join(', ')})${p.type ? `: ${p.type}` : ''}` : `${p.name}${p.type ? `: ${p.type}` : ''}`;
}

/** What differs between a planned and an actual member of the same name; nothing when they agree. */
function memberDifference(plan: ParsedMember, actual: ParsedMember): string | undefined {
	if (plan.kind === 'method' && actual.kind === 'method') {
		const pp = plan.params ?? [];
		const ap = actual.params ?? [];
		if (pp.length !== ap.length) {
			return `takes ${ap.length} parameter${ap.length === 1 ? '' : 's'}, the plan says ${pp.length}`;
		}
		const i = pp.findIndex((t, j) => !sameType(t, ap[j]));
		if (i >= 0) {
			return `parameter ${i + 1} is ${ap[i]}, the plan says ${pp[i]}`;
		}
		if (!sameType(plan.type, actual.type)) {
			return `returns ${actual.type ?? 'nothing'}, the plan says ${plan.type}`;
		}
		return undefined;
	}
	if (plan.kind === 'method' && actual.kind === 'field') {
		return 'written as a field, the plan has a method';
	}
	if (plan.kind === 'field' && actual.kind === 'method') {
		// A planned property written as a getter is the same thing in Java.
		return plan.type && actual.type && !sameType(plan.type, actual.type) ? `is ${actual.type}, the plan says ${plan.type}` : undefined;
	}
	return sameType(plan.type, actual.type) ? undefined : `is ${actual.type}, the plan says ${plan.type}`;
}

/** Same shape, for spotting a rename: same kind and, for methods, the same parameter count and compatible types. */
function sameShape(plan: ParsedMember, actual: ParsedMember) {
	if (plan.kind !== actual.kind) {
		return false;
	}
	return memberDifference(plan, actual) === undefined && (plan.kind === 'field' ? !!plan.type && !!actual.type : true);
}

function matchMembers(planned: BoardMember[], t: TypeInfo): { members: MemberResult[]; extra: string[] } {
	const actual = actualMembers(t);
	const used = new Set<Actual>();
	const results: (MemberResult | undefined)[] = [];
	const pending: { i: number; p: ParsedMember; text: string }[] = [];
	planned.forEach((m, i) => {
		const p = parseMember(m.text, m.kind);
		if (!p) {
			results[i] = { text: m.text, check: 'matches', note: 'not a member the check can read' };
			return;
		}
		// A planned constructor is the type's constructor whatever the language calls it (constructor, __init__, the type's name).
		const ctor = p.kind === 'method' && (CTOR_NAMES.has(p.name) || sameName(p.name, t.name));
		const hit = (ctor ? actual.find(a => !used.has(a) && a.isCtor) : undefined)
			?? actual.find(a => !used.has(a) && sameName(a.name, p.name))
			?? (p.kind === 'field' ? actual.find(a => !used.has(a) && a.kind === 'method' && getterOf(p.name, a.name)) : undefined);
		if (!hit) {
			pending.push({ i, p, text: m.text });
			return;
		}
		used.add(hit);
		const why = memberDifference(p, hit.parsed);
		results[i] = why ? { text: m.text, check: 'differs', note: why, actual: hit.text, line: hit.line } : { text: m.text, check: 'matches', actual: hit.text, line: hit.line };
	});
	// What is left: a member with the same shape under another name is a rename, the rest is missing.
	for (const { i, p, text } of pending) {
		const candidates = actual.filter(a => !used.has(a) && !a.isPlumbing && sameShape(p, a.parsed));
		const best = candidates.sort((a, b) => similarity(b.name, p.name) - similarity(a.name, p.name))[0];
		if (best && (candidates.length === 1 || similarity(best.name, p.name) >= 0.4)) {
			used.add(best);
			results[i] = { text, check: 'differs', note: `named ${best.name} in the code (renamed?)`, actual: best.text, line: best.line };
		} else {
			results[i] = { text, check: 'missing', note: `no ${p.kind} ${describeParsed(p)} yet` };
		}
	}
	const extra = actual.filter(a => !used.has(a) && a.isPublic && !a.isPlumbing && t.kind !== 'enum').map(a => a.text);
	return { members: results as MemberResult[], extra };
}

// ── types ──────────────────────────────────────────────────────────────────────────────────────

/** Whether the planned kind of a node allows the kind of type written for it. */
function kindDifference(plan: BoardNode, t: TypeInfo): string | undefined {
	const want = plan.kind ?? 'class';
	if (want === 'interface' && t.kind !== 'interface') {
		return `the plan has an interface, the code has ${t.isAbstract ? 'an abstract ' : 'a '}${t.kind}`;
	}
	if (want === 'enum' && t.kind !== 'enum') {
		return `the plan has an enum, the code has a ${t.kind}`;
	}
	if (want !== 'enum' && t.kind === 'enum') {
		return `the code has an enum, the plan has a ${want}`;
	}
	if (want === 'class' && t.kind === 'interface') {
		return 'the plan has a class, the code has an interface';
	}
	return undefined;
}

/** How many planned member names a type has: the tie-breaker between types of one name, and the test for a renamed type. */
function overlap(planned: BoardMember[], t: TypeInfo) {
	const names = new Set(actualMembers(t).map(a => key(a.name)));
	return planned.map(m => parseMember(m.text, m.kind)).filter(p => p && (names.has(key(p.name)) || names.has('get' + key(p.name)))).length;
}

const RELATION_EDGES: Record<string, TypeEdge['via'][] | 'super'> = {
	extends: 'super', implements: 'super',
	has: ['field', 'ctor', 'generic'], 'has-many': ['field', 'ctor', 'generic'],
	uses: ['field', 'method', 'ctor', 'generic'], depends: ['field', 'method', 'ctor', 'generic'], calls: ['field', 'method', 'ctor', 'generic'],
};

export function matchPlan(plan: BoardSpec, graph: Pick<TypeGraph, 'types' | 'edges'>, opts: MatchOptions = {}): SkeletonDiff {
	const ready = opts.ready ?? true;
	const nodes = plan.nodes.filter(isCheckedNode);
	const byKey = new Map<string, TypeInfo[]>();
	for (const t of graph.types) {
		const k = key(t.name);
		byKey.set(k, [...(byKey.get(k) ?? []), t]);
	}
	const taken = new Set<string>();
	const found = new Map<string, { t: TypeInfo; note?: string; renamed?: boolean }>();
	// Exact names first, so a rename never takes the type another node is called.
	for (const n of nodes) {
		const name = nodeName(n);
		const all = nameKeys(name).flatMap(k => byKey.get(k) ?? []).filter((t, i, a) => a.indexOf(t) === i && !taken.has(t.id));
		if (!all.length) {
			continue;
		}
		const fit = (t: TypeInfo) => (kindDifference(n, t) ? 0 : 1000) + overlap(n.members ?? [], t) * 10 + (key(t.name) === key(name) ? 1 : 0);
		const score = (t: TypeInfo) => fit(t) * 2 + (opts.recent?.(t.file) ? 1 : 0);
		const ranked = [...all].sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : 1));
		const t = ranked[0];
		taken.add(t.id);
		// Equally good matches are named, so the developer sees which one was checked and why.
		const others = ranked.slice(1).filter(o => fit(o) === fit(t));
		const why = opts.recent?.(t.file) && !others.every(o => opts.recent?.(o.file)) ? ', the one changed since the design was drawn' : '';
		found.set(n.id, { t, note: others.length ? `${others.length + 1} types are called ${t.name}; checked the one in ${t.file}${why}` : undefined });
	}
	// Then renames: an unplanned type of a similar name that has most of the planned members.
	for (const n of nodes) {
		if (found.has(n.id)) {
			continue;
		}
		const name = nodeName(n);
		const planned = n.members ?? [];
		const candidates = graph.types.filter(t => !taken.has(t.id) && similarity(t.name, name) >= 0.6 && (planned.length === 0 || overlap(planned, t) * 2 >= planned.length));
		const t = candidates.sort((a, b) => similarity(b.name, name) - similarity(a.name, name) || (opts.recent?.(b.file) ? 1 : 0) - (opts.recent?.(a.file) ? 1 : 0))[0];
		if (t) {
			taken.add(t.id);
			found.set(n.id, { t, renamed: true });
		}
	}
	const typeOf = (nodeId: string) => found.get(nodeId)?.t;
	const results: NodeResult[] = nodes.map(n => {
		const hit = found.get(n.id);
		const relations = plan.edges.filter(e => e.from === n.id && RELATION_EDGES[e.kind ?? 'uses'] && isCheckedNode(plan.nodes.find(x => x.id === e.to) ?? n)).map((e): RelationResult => {
			const from = typeOf(e.from);
			const to = typeOf(e.to);
			const toLabel = nodeName(plan.nodes.find(x => x.id === e.to)!);
			const via = RELATION_EDGES[e.kind ?? 'uses'];
			let ok = false;
			if (from && to) {
				ok = via === 'super'
					? from.supers.some(s => s.id === to.id || sameName(s.name, to.name))
					: graph.edges.some(g => ((g.from === from.id && g.to === to.id) || (g.from === to.id && g.to === from.id)) && via.includes(g.via))
					|| from.supers.some(s => s.id === to.id);
			}
			return { to: toLabel, kind: e.kind ?? 'uses', check: ok ? 'matches' : 'missing' };
		});
		if (!hit) {
			return { id: n.id, label: n.label, check: 'missing', note: ready ? `no type called ${nodeName(n)} in the code yet` : 'the code index is still loading', members: (n.members ?? []).map(m => ({ text: m.text, check: 'missing' as const })), relations, extra: [] };
		}
		const { t } = hit;
		const { members, extra } = matchMembers(n.members ?? [], t);
		const kindWhy = kindDifference(n, t);
		const notes = [hit.renamed ? `named ${t.name} in the code (renamed?)` : undefined, kindWhy, hit.note].filter(Boolean);
		const differs = hit.renamed || !!kindWhy || members.some(m => m.check === 'differs');
		const missing = members.some(m => m.check === 'missing') || relations.some(r => r.check === 'missing');
		if (!differs && missing) {
			const have = members.filter(m => m.check !== 'missing').length;
			notes.push(members.length ? `${have} of ${members.length} members written` : 'a relation is not written yet');
		}
		return {
			id: n.id, label: n.label, check: differs ? 'differs' : missing ? 'missing' : 'matches', note: notes.join('; ') || undefined,
			typeId: t.id, name: t.name, kind: t.kind, file: t.file, line: t.line, members, relations, extra,
		};
	});
	const counts: Record<CheckState, number> = { matches: 0, missing: 0, differs: 0 };
	results.forEach(r => counts[r.check]++);
	return { ready, nodes: results, counts };
}

// ── output ─────────────────────────────────────────────────────────────────────────────────────

/** A one-line summary: "3 match · 2 missing · 1 differs". */
export function countsText(diff: SkeletonDiff): string {
	if (!diff.ready) {
		return 'not checked yet: the code index is still loading';
	}
	const c = diff.counts;
	return `${c.matches} match${c.matches === 1 ? 'es' : ''} · ${c.missing} missing · ${c.differs} differ${c.differs === 1 ? 's' : ''}`;
}

/** The plan board with the check painted on: the plan itself is not changed. */
export function decorate(plan: BoardSpec, diff: SkeletonDiff, warnings: { owner: string; name?: string; text: string }[] = []): BoardSpec {
	const byId = new Map(diff.nodes.map(r => [r.id, r]));
	const nodes = plan.nodes.map(n => {
		const r = byId.get(n.id);
		const warnHere = warnings.filter(w => r?.name && sameName(w.owner, r.name));
		if (!r || !diff.ready) {
			return n;
		}
		const members = (n.members ?? []).map((m, i): BoardMember => {
			const mr = r.members[i];
			const p = parseMember(m.text, m.kind);
			const w = p ? warnHere.find(x => x.name && sameName(x.name, p.name)) : undefined;
			return { ...m, check: mr?.check, checkNote: [mr?.note, mr?.actual && mr.check !== 'matches' ? `code: ${mr.actual}` : undefined].filter(Boolean).join('\n') || undefined, warn: w?.text };
		});
		const typeWarn = warnHere.find(w => !w.name);
		return {
			...n, members, check: r.check, checkNote: r.note, warn: typeWarn?.text ?? (warnHere.length && !members.some(m => m.warn) ? warnHere[0].text : undefined),
			file: n.file ?? r.file, line: n.file ? n.line : r.line,
		};
	});
	const summary = `Plan vs code: ${countsText(diff)}.`;
	return { ...plan, nodes, description: [summary, plan.description].filter(Boolean).join(' ') };
}

const MARK: Record<CheckState, string> = { matches: 'matches', missing: 'MISSING', differs: 'DIFFERS' };

/** The diff as text for the agent: one line per type, indented lines for members and relations that need a word. */
export function diffText(diff: SkeletonDiff, title: string, rel: (file: string) => string = f => f): string {
	const lines = [`Skeleton check of "${title}": ${countsText(diff)}.`];
	if (!diff.ready) {
		return lines.join('\n');
	}
	for (const r of diff.nodes) {
		const where = r.file ? ` (${r.kind} at ${rel(r.file)}:${r.line})` : '';
		lines.push(`${MARK[r.check]} ${nodeName(r)}${where}${r.note ? `: ${r.note}` : ''}`);
		for (const m of r.members) {
			if (m.check !== 'matches' || r.check === 'differs') {
				lines.push(`  ${MARK[m.check]} ${m.text}${m.note ? `: ${m.note}` : ''}${m.actual && m.check !== 'matches' ? ` [code: ${m.actual}]` : ''}`);
			}
		}
		for (const x of r.relations.filter(x => x.check === 'missing')) {
			lines.push(`  MISSING relation ${x.kind} → ${x.to}`);
		}
		if (r.extra.length) {
			lines.push(`  extra (fine): ${r.extra.slice(0, 8).join(', ')}${r.extra.length > 8 ? ` and ${r.extra.length - 8} more` : ''}`);
		}
	}
	return lines.join('\n');
}
