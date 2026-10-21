/*---------------------------------------------------------------------------------------------
 *  Insilode type model: what the cards of the flow canvas show about types. A card is found by the
 *  file and line its method starts at; its parameter and return types become chips when they
 *  are types of the workspace (collections, optionals and response wrappers unwrapped, see
 *  typeref.ts), and a chip opens into the type's fields, each of which can open again.
 *  Pure: no vscode.
 *--------------------------------------------------------------------------------------------*/

import { findType } from './graph';
import type { Collection, FuncSig, TypeGraph, TypeInfo } from './model';

/** The signature of a method as written: the declared types of its parameters and of what it returns. */
export interface Signature {
	params: { name: string; type: string }[];
	returns?: string;
}

/** A workspace type a chip names. */
export interface TypeLink {
	id: string;
	name: string;
	kind: string;
	role: string;
	file: string;
	line: number;
}

/** One chip: a parameter (`name` is its name) or the return value (`name` is empty). Only types of the workspace become chips. */
export interface ChipItem {
	name: string;
	/** The declared type, packages stripped: `Task<ActionResult<List<OrderDto>>>`. */
	ref: string;
	typeId: string;
	typeName: string;
	kind: string;
	role: string;
	file: string;
	line: number;
	collection: Collection;
}

export interface CardChips {
	params: ChipItem[];
	returns?: ChipItem;
}

export interface TreeField {
	name: string;
	type: string;
	card: Collection;
	/** The workspace type the field refers to (the first one when it holds several). */
	ref?: TypeLink;
	/** Its own tree, when `depth` asked for it and it is not a cycle. */
	child?: TypeTree;
}

export interface TypeTree extends TypeLink {
	/** Enum constants. */
	constants?: string[];
	moreConstants?: number;
	fields: TreeField[];
	/** Fields beyond the ones listed. */
	moreFields?: number;
}

const MAX_FIELDS = 40;
const MAX_CONSTANTS = 40;
/** How far a declaration's identifier may be below the line a card starts at (attributes and annotations sit above it). */
const DECL_WINDOW = 8;

const normFile = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, d => d.toLowerCase());

const indexes = new WeakMap<TypeGraph, Map<string, FuncSig[]>>();

function funcsOf(graph: TypeGraph, file: string): FuncSig[] {
	let index = indexes.get(graph);
	if (!index) {
		index = new Map();
		for (const f of graph.funcs) {
			const key = normFile(f.file);
			const list = index.get(key);
			if (list) {
				list.push(f);
			} else {
				index.set(key, [f]);
			}
		}
		indexes.set(graph, index);
	}
	return index.get(normFile(file)) ?? [];
}

/**
 * The method whose declaration starts at `line` of `file`. A card starts where its source does (the first annotation or attribute
 * line for C#), so a method whose name sits a few lines lower matches when its last line is the card's as well.
 */
export function findFunc(graph: TypeGraph, file: string, line: number, endLine?: number): FuncSig | undefined {
	const list = funcsOf(graph, file);
	const exact = list.find(f => f.line === line);
	if (exact) {
		return exact;
	}
	return list.filter(f => f.line > line && f.line - line <= DECL_WINDOW && (endLine === undefined || f.endLine === endLine)).sort((a, b) => a.line - b.line)[0];
}

/** The declared parameter and return types of the method that starts at `file:line`. */
export function signatureOf(graph: TypeGraph, file: string, line: number, endLine?: number): Signature | undefined {
	const f = findFunc(graph, file, line, endLine);
	return f && { params: f.params.map(p => ({ name: p.name, type: p.type })), returns: f.returns?.type || undefined };
}

const link = (t: TypeInfo): TypeLink => ({ id: t.id, name: t.name, kind: t.kind, role: t.role, file: t.file, line: t.line });

function item(graph: TypeGraph, name: string, s: { type: string; refs: string[]; collection: Collection }): ChipItem | undefined {
	const t = s.refs[0] ? graph.byId.get(s.refs[0]) : undefined;
	return t && { name, ref: s.type, typeId: t.id, typeName: t.name, kind: t.kind, role: t.role, file: t.file, line: t.line, collection: s.collection };
}

/** The chips of the method that starts at `file:line`, or undefined when no type of its signature is a workspace type. */
export function chipsOf(graph: TypeGraph, file: string, line: number, endLine?: number): CardChips | undefined {
	const f = findFunc(graph, file, line, endLine);
	if (!f) {
		return undefined;
	}
	const params = f.params.map(p => item(graph, p.name, p)).filter((x): x is ChipItem => !!x);
	const returns = f.returns && item(graph, '', f.returns);
	return params.length || returns ? { params, returns } : undefined;
}

/**
 * The fields of a type and, for those that refer to a workspace type, a link to it. `depth` more levels are expanded in place
 * (a type already on the way down is a link, never expanded again): the canvas asks for one level at a time, so a long chain
 * of DTOs is only read when it is opened.
 */
export function typeTree(graph: TypeGraph, ref: string, fromFile?: string, depth = 0): TypeTree | undefined {
	const root = findType(graph, ref, fromFile);
	if (!root) {
		return undefined;
	}
	const build = (t: TypeInfo, level: number, path: ReadonlySet<string>): TypeTree => {
		const here = new Set([...path, t.id]);
		const all = t.fields.filter(f => !f.isStatic);
		const fields: TreeField[] = all.slice(0, MAX_FIELDS).map(f => {
			const target = f.refs[0] ? graph.byId.get(f.refs[0]) : undefined;
			const field: TreeField = { name: f.name, type: f.type, card: f.collection };
			if (target) {
				field.ref = link(target);
				if (level < depth && !here.has(target.id)) {
					field.child = build(target, level + 1, here);
				}
			}
			return field;
		});
		const constants = t.constants?.slice(0, MAX_CONSTANTS);
		return {
			...link(t), constants, moreConstants: (t.constants?.length ?? 0) > MAX_CONSTANTS ? t.constants!.length - MAX_CONSTANTS : undefined,
			fields, moreFields: all.length > MAX_FIELDS ? all.length - MAX_FIELDS : undefined,
		};
	};
	return build(root, 0, new Set());
}
