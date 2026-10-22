/*---------------------------------------------------------------------------------------------
 *  Insilode boards generated from code: an enum and the transitions between its values as a state diagram. The index records calls,
 *  not assignments or conditions, so transitions are read from the source text of methods and only where the code is clear:
 *  a method assigns one of the enum's values (`x.status = Status.PAID`, `setStatus(Status.PAID)`) and the same method checks
 *  the state it comes from (`status == Status.NEW`, `case Status.NEW`, `.equals(Status.NEW)`). An assignment without such a
 *  check, or several states assigned under several checks, is not drawn and is listed. When no transition is clear the
 *  answer is a reason, not a board. Pure: the caller reads the files. No `vscode`.
 *--------------------------------------------------------------------------------------------*/

import { byCode, type TypeGraph, type TypeInfo } from '../../types/model';
import { MAX_LIST, skip, type GenBoard, type GenEdge, type GenNode, type Generated } from './board';

export interface StateScope {
	/** The enum: `OrderStatus`, or `Order.status` (the field's type). Omit to let Insilode look for the one enum with clear transitions. */
	enum?: string;
}

export interface StateInput {
	graph: TypeGraph;
	/** The text of a source file, or undefined when it cannot be read (outside the workspace, deleted). */
	readSource(file: string): string | undefined;
}

export interface StateOptions {
	/** Source files read (default 400). */
	maxFiles?: number;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Found {
	edges: Map<string, { from: string; to: string; via: Set<string>; file: string; line: number }>;
	initial: Set<string>;
	unguarded: string[];
	ambiguous: string[];
	files: number;
	cutFiles: boolean;
}

/** The text of a method, comment-only lines dropped. */
function bodyOf(lines: string[], start: number, end: number): string {
	return lines.slice(Math.max(0, start - 1), Math.max(start, end)).filter(l => !/^\s*(\/\/|#|\*|\/\*)/.test(l)).join('\n');
}

function transitionsOf(graph: TypeGraph, e: TypeInfo, read: StateInput['readSource'], maxFiles: number): Found {
	const consts = new Set(e.constants ?? []);
	const q = esc(e.name);
	const assign = new RegExp(String.raw`(?:^|[\s;{(.])(?:this\.|self\.)?([A-Za-z_]\w*)\s*=\s*${q}\.([A-Za-z_]\w*)\b`, 'g');
	const setter = new RegExp(String.raw`\bset([A-Z]\w*)\(\s*${q}\.([A-Za-z_]\w*)\s*\)`, 'g');
	const guards = [
		new RegExp(String.raw`(?<![!<>=])===?\s*${q}\.([A-Za-z_]\w*)\b`, 'g'),
		new RegExp(String.raw`\b${q}\.([A-Za-z_]\w*)\s*(?:===?(?!=)|\.equals\()`, 'g'),
		new RegExp(String.raw`\.equals\(\s*${q}\.([A-Za-z_]\w*)\s*\)`, 'g'),
		new RegExp(String.raw`\bcase\s+${q}\.([A-Za-z_]\w*)\b`, 'g'),
		new RegExp(String.raw`\bis\s+${q}\.([A-Za-z_]\w*)\b`, 'g'),
	];
	const found: Found = { edges: new Map(), initial: new Set(), unguarded: [], ambiguous: [], files: 0, cutFiles: false };
	const byFile = new Map<string, TypeInfo[]>();
	for (const t of graph.types) {
		if (t.lang === e.lang && t.id !== e.id) {
			byFile.set(t.file, [...byFile.get(t.file) ?? [], t]);
		}
	}
	// Files with functions but no type (a FastAPI or Express module) are known from their endpoints and function signatures.
	const ext = (f: string) => f.slice(f.lastIndexOf('.'));
	for (const f of [...graph.endpoints.map(x => x.file), ...graph.funcs.map(x => x.file)]) {
		if (ext(f) === ext(e.file) && !byFile.has(f)) {
			byFile.set(f, []);
		}
	}
	// One method or function: the values it assigns, and the states it checks before.
	const scan = (where: string, body: string, constructor: boolean, file: string, line: number) => {
		if (!body.includes(`${e.name}.`)) {
			return;
		}
		const targets = new Set<string>();
		for (const re of [assign, setter]) {
			re.lastIndex = 0;
			for (let x = re.exec(body); x; x = re.exec(body)) {
				if (consts.has(x[2])) {
					targets.add(x[2]);
				}
			}
		}
		if (!targets.size) {
			return;
		}
		const from = new Set<string>();
		for (const g of guards) {
			g.lastIndex = 0;
			for (let x = g.exec(body); x; x = g.exec(body)) {
				if (consts.has(x[1])) {
					from.add(x[1]);
				}
			}
		}
		// A check on the state the method assigns is an "already there" guard, not the state it comes from.
		const sources = [...from].filter(f => !targets.has(f));
		if (constructor) {
			targets.forEach(x => found.initial.add(x));
			return;
		}
		if (!sources.length) {
			found.unguarded.push(`${where} -> ${[...targets].join(', ')}`);
			return;
		}
		if (targets.size > 1 && sources.length > 1) {
			found.ambiguous.push(`${where}: assigns ${[...targets].join(', ')} under checks on ${sources.join(', ')}`);
			return;
		}
		for (const f of sources) {
			for (const to of targets) {
				const key = `${f}|${to}`;
				const edge = found.edges.get(key) ?? { from: f, to, via: new Set<string>(), file, line };
				edge.via.add(where);
				found.edges.set(key, edge);
			}
		}
	};
	for (const [file, types] of [...byFile].sort((a, b) => byCode(a[0], b[0]))) {
		if (found.files >= maxFiles) {
			found.cutFiles = true;
			break;
		}
		const text = read(file);
		found.files++;
		if (!text || !text.includes(`${e.name}.`)) {
			continue;
		}
		const lines = text.split(/\r?\n/);
		for (const t of types) {
			const inMethods = new Set<number>();
			for (const m of t.methods) {
				if (!m.line) {
					continue;
				}
				const end = m.endLine ?? m.line;
				for (let i = m.line; i <= end; i++) {
					inMethods.add(i);
				}
				scan(`${t.name}.${m.name}`, bodyOf(lines, m.line, end), !!m.isConstructor || m.name === '__init__' || m.name === 'constructor', t.file, m.line);
			}
			// A field initialised with a value (`Status status = Status.NEW;`) is the initial state.
			for (let i = t.line; i <= t.endLine; i++) {
				if (!inMethods.has(i)) {
					const x = new RegExp(String.raw`=\s*${q}\.([A-Za-z_]\w*)\s*;?\s*$`).exec(lines[i - 1] ?? '');
					if (x && consts.has(x[1])) {
						found.initial.add(x[1]);
					}
				}
			}
		}
		// Functions outside any type (Python and JS modules): found by their `def` or `function` at the start of a line, up to the next one.
		const starts: { name: string; line: number }[] = [];
		lines.forEach((l, i) => {
			const m = /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|def\s+(\w+))/.exec(l);
			if (m) {
				starts.push({ name: m[1] ?? m[2], line: i + 1 });
			}
		});
		for (const f of starts) {
			// The body ends at the next line that starts in column 0 (another definition, a decorator, a class), except a closing bracket.
			let end = f.line;
			while (end < lines.length && !(/^\S/.test(lines[end]) && !/^[})\]]/.test(lines[end]))) {
				end++;
			}
			scan(f.name, bodyOf(lines, f.line, end), false, file, f.line);
		}
	}
	return found;
}

export function stateFromEnum(input: StateInput, scope: StateScope = {}, opts: StateOptions = {}): Generated {
	const { graph } = input;
	const maxFiles = Math.max(1, opts.maxFiles ?? 400);
	const enums = graph.types.filter(t => t.kind === 'enum' && (t.constants?.length ?? 0) >= 2);
	const used = new Set(graph.edges.filter(x => x.via === 'field').map(x => x.to));
	let candidates = enums.filter(t => used.has(t.id));
	const asked = scope.enum?.trim();
	if (asked) {
		// The enum by name or qualified name (`com.acme.OrderStatus`, `app.models.Status`) first; failing that `Owner.field`, the enum a
		// field holds, where the owner may be qualified too (`com.acme.Order.status`).
		let hit = enums.filter(t => t.name === asked || t.qualifiedName === asked);
		const dot = asked.lastIndexOf('.');
		if (!hit.length && dot > 0) {
			const owner = asked.slice(0, dot);
			const field = asked.slice(dot + 1);
			const ownerType = graph.types.find(t => t.name === owner) ?? graph.types.find(t => t.qualifiedName === owner);
			const ref = ownerType?.fields.find(f => f.name === field)?.refs.map(r => graph.byId.get(r)).find(t => t?.kind === 'enum');
			hit = ref ? [ref] : [];
		}
		if (!hit.length) {
			return skip(`No enum "${asked}" with two or more values. Enums used as a field type: ${candidates.slice(0, 20).map(t => t.name).sort(byCode).join(', ') || 'none'}.`);
		}
		candidates = hit.slice(0, 1);
	}
	if (!candidates.length) {
		return skip('No enum with two or more values is used as a field type here, so there is no state to draw.');
	}
	const results = candidates.slice(0, 8).map(e => ({ e, found: transitionsOf(graph, e, input.readSource, maxFiles) }));
	const clear = results.filter(r => r.found.edges.size > 0);
	if (!clear.length) {
		const r = results[0];
		return skip(`${results.length === 1 ? r.e.name : `${results.length} enums (${results.map(x => x.e.name).join(', ')})`}: no transition is clear in the code. The code must assign a value and check the state it comes from in the same method (e.g. "if (o.status == ${r.e.name}.${r.e.constants![0]}) o.status = ${r.e.name}.${r.e.constants![1]}")${r.found.unguarded.length ? `. Found ${r.found.unguarded.length} assignment(s) without such a check: ${r.found.unguarded.slice(0, 5).join('; ')}` : ''}. Describe the lifecycle in a plan or draw it yourself with draw_board and mark it as your reading, not the code's.`);
	}
	if (clear.length > 1 && !asked) {
		return skip(`${clear.length} enums have clear transitions (${clear.map(r => `${r.e.name}: ${r.found.edges.size}`).join(', ')}); pass \`scope.enum\` with the one you want.`);
	}
	const { e, found } = clear[0];
	const notes: string[] = [];
	const constants = (e.constants ?? []).slice(0, 30);
	if ((e.constants?.length ?? 0) > constants.length) {
		notes.push(`${e.constants!.length - constants.length} further enum values are not drawn.`);
	}
	const nodes: GenNode[] = constants.map(c => ({ id: c, label: c, kind: 'step' as const, shape: 'round' as const, symbol: `${e.name}.${c}`, file: e.file, line: e.line, detail: 'state' }));
	const edges: GenEdge[] = [];
	const known = new Set(constants);
	if (found.initial.size) {
		nodes.unshift({ id: '_start', label: 'start', kind: 'step', shape: 'initial' });
		[...found.initial].filter(c => known.has(c)).sort(byCode).forEach(c => edges.push({ from: '_start', to: c, kind: 'next' }));
	}
	for (const x of [...found.edges.values()].sort((a, b) => byCode(`${a.from}|${a.to}`, `${b.from}|${b.to}`))) {
		if (known.has(x.from) && known.has(x.to)) {
			const via = [...x.via].sort(byCode);
			edges.push({ from: x.from, to: x.to, kind: 'next', label: via.slice(0, 2).join(', ') + (via.length > 2 ? `, +${via.length - 2}` : '') });
		}
	}
	const touched = new Set(edges.flatMap(x => [x.from, x.to]));
	const loose = constants.filter(c => !touched.has(c));
	if (loose.length) {
		notes.push(`No clear transition into or out of: ${loose.slice(0, MAX_LIST).join(', ')}. They are listed as states, unconnected.`);
	}
	if (found.unguarded.length) {
		notes.push(`${found.unguarded.length} assignment(s) were not drawn because the method does not check the state it comes from: ${found.unguarded.slice(0, 6).join('; ')}${found.unguarded.length > 6 ? '; ...' : ''}.`);
	}
	if (found.ambiguous.length) {
		notes.push(`Not drawn, the pairing of from and to states is unclear: ${found.ambiguous.slice(0, 4).join('; ')}.`);
	}
	if (found.cutFiles) {
		notes.push(`Only the first ${maxFiles} source files were read.`);
	}
	notes.push('Transitions are read from the source text (an assignment plus a check of the previous state in one method), not from a resolved model: a state changed by a framework, a database update or a state-machine library is not seen.');
	const board: GenBoard = {
		version: 1,
		kind: 'state',
		title: `States: ${e.name}`,
		description: `${constants.length} states, ${edges.length} transition${edges.length === 1 ? '' : 's'} read from the code (${found.files} files scanned).`,
		direction: 'LR',
		nodes,
		edges,
	};
	return { board, notes };
}
