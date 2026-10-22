/*---------------------------------------------------------------------------------------------
 *  Insilode boards generated from code: the dependencies between modules (services) or packages as an architecture diagram. A
 *  box is a module or a package, an edge is "some type of this box refers to a type of that box" (a field, a parameter, a
 *  constructor injection, a base type) or "calls it" (from the flow index), counted. With two or more modules the board is
 *  the C4 container level (one boundary around the system); one module, or a module asked for, is the component level
 *  (its packages). Everything is read from the type graph: nothing is guessed, and what the graph cannot see (HTTP and
 *  message links between services, a database shared by two services) is said in the notes. Pure: no `vscode`.
 *--------------------------------------------------------------------------------------------*/

import { cut } from '../../types/boards';
import { byCode, type TypeGraph, type TypeInfo, type TypeLang } from '../../types/model';
import { skip, type GenBoard, type GenEdge, type GenGroup, type GenNode, type Generated } from './board';

export interface ArchScope {
	/** A module (service) name, or a package name: the packages of that module, or that package and what it depends on. Omit for the whole workspace. */
	module?: string;
}

export interface ArchOptions {
	/** Boxes drawn (default 30). */
	maxNodes?: number;
}

const TECH: Record<TypeLang, string> = { java: 'Java', js: 'JavaScript/TypeScript', python: 'Python', csharp: 'C#', go: 'Go', php: 'PHP', ruby: 'Ruby', rust: 'Rust' };
const idOf = (key: string) => `u_${key.replace(/[^A-Za-z0-9_]+/g, '_')}`;

interface Unit {
	key: string;
	label: string;
	module: string;
	types: TypeInfo[];
	external?: boolean;
}

export function architectureFromGraph(graph: TypeGraph, scope: ArchScope = {}, opts: ArchOptions = {}): Generated {
	const maxNodes = Math.max(2, opts.maxNodes ?? 30);
	const notes: string[] = [];
	if (!graph.types.length) {
		return skip('The type graph is empty: the code index is still building, or the workspace has no types in a supported language. Try again in a moment.');
	}
	const modules = [...new Set(graph.types.map(t => t.module))].sort(byCode);
	const asked = scope.module?.trim();
	let level: 'container' | 'component' = modules.length >= 2 ? 'container' : 'component';
	let focusModule: string | undefined;
	let focusPackage: string | undefined;
	if (asked) {
		const lower = asked.toLowerCase();
		focusModule = modules.find(m => m.toLowerCase() === lower);
		if (!focusModule) {
			const pkgs = [...new Set(graph.types.map(t => `${t.module}\u0000${t.packageName}`))].filter(k => {
				const p = k.split('\u0000')[1].toLowerCase();
				return p === lower || p.endsWith(`.${lower}`) || p.endsWith(`/${lower}`);
			});
			if (!pkgs.length) {
				return skip(`No module or package named "${asked}". Modules: ${modules.slice(0, 20).join(', ')}.`);
			}
			focusPackage = pkgs[0].split('\u0000')[1];
			focusModule = pkgs[0].split('\u0000')[0];
		}
		level = 'component';
	}

	// The boxes: modules at the container level, packages of one module at the component level (other modules the code reaches are one outside box each).
	const unitOf = (t: TypeInfo): Unit | undefined => {
		if (level === 'container') {
			return { key: t.module, label: t.module, module: t.module, types: [] };
		}
		const targetModule = focusModule ?? modules[0];
		if (t.module !== targetModule) {
			return { key: `ext:${t.module}`, label: t.module, module: t.module, types: [], external: true };
		}
		return { key: `${t.module}:${t.packageName}`, label: t.packageName || t.module, module: t.module, types: [] };
	};
	const units = new Map<string, Unit>();
	const unitFor = new Map<string, Unit>();
	for (const t of graph.types) {
		const u = unitOf(t);
		if (!u) {
			continue;
		}
		const unit = units.get(u.key) ?? u;
		unit.types.push(t);
		units.set(u.key, unit);
		unitFor.set(t.id, unit);
	}

	// Dependencies between boxes: every type reference and every call, counted.
	interface Link { from: Unit; to: Unit; refs: number; calls: number }
	const links = new Map<string, Link>();
	const bump = (a: string, b: string, kind: 'refs' | 'calls', n: number) => {
		const from = unitFor.get(a);
		const to = unitFor.get(b);
		if (!from || !to || from === to) {
			return;
		}
		const key = `${from.key}\u0000${to.key}`;
		const link = links.get(key) ?? { from, to, refs: 0, calls: 0 };
		link[kind] += n;
		links.set(key, link);
	};
	for (const e of graph.edges) {
		bump(e.from, e.to, 'refs', 1);
	}
	for (const c of graph.calls) {
		bump(c.from, c.to, 'calls', c.count);
	}

	let chosen = new Set([...units.values()].filter(u => !u.external).map(u => u.key));
	const keep = new Set<string>();
	if (focusPackage) {
		const seed = [...units.values()].find(u => !u.external && u.label === focusPackage)!;
		keep.add(seed.key);
		chosen = new Set([seed.key]);
		for (const l of links.values()) {
			if (l.from === seed) {
				chosen.add(l.to.key);
			} else if (l.to === seed) {
				chosen.add(l.from.key);
			}
		}
	} else {
		// Outside boxes only where a chosen box depends on them, or they on it.
		const inside = new Set(chosen);
		for (const l of links.values()) {
			if ((inside.has(l.from.key) && l.to.external) || (inside.has(l.to.key) && l.from.external)) {
				chosen.add(l.from.key);
				chosen.add(l.to.key);
			}
		}
	}
	const universe = chosen.size;
	const live = [...links.values()].filter(l => chosen.has(l.from.key) && chosen.has(l.to.key));
	if (chosen.size > maxNodes) {
		chosen = cut(chosen, live.map(l => ({ from: l.from.key, to: l.to.key })), maxNodes, keep);
		notes.push(`Showing ${maxNodes} of ${universe} boxes (the most connected). Pass \`scope.module\` with a module or package name to see its neighbourhood.`);
	}

	const boxes = [...units.values()].filter(u => chosen.has(u.key)).sort((a, b) => byCode(a.key, b.key));
	const nodes: GenNode[] = boxes.map(u => {
		const langs = [...new Set(u.types.map(t => TECH[t.lang]))].sort(byCode);
		const roles = new Map<string, number>();
		u.types.forEach(t => roles.set(t.role, (roles.get(t.role) ?? 0) + 1));
		const summary = [...roles].sort((a, b) => b[1] - a[1] || byCode(a[0], b[0])).slice(0, 3).map(([r, n]) => `${n} ${n === 1 ? r : r === 'entity' ? 'entities' : `${r}s`}`).join(', ');
		return {
			id: idOf(u.key),
			label: u.label,
			kind: u.external ? 'external' as const : 'service' as const,
			detail: `${u.types.length} type${u.types.length === 1 ? '' : 's'}${summary ? `: ${summary}` : ''}`,
			tech: langs.join(', '),
			shape: 'rect' as const,
			...(level === 'component' && !u.external ? { group: idOf(`module:${u.module}`) } : {}),
			...(u.external ? { group: undefined } : {}),
		};
	});
	const edges: GenEdge[] = live.filter(l => chosen.has(l.from.key) && chosen.has(l.to.key)).sort((a, b) => byCode(`${a.from.key}|${a.to.key}`, `${b.from.key}|${b.to.key}`)).map(l => ({
		from: idOf(l.from.key),
		to: idOf(l.to.key),
		kind: 'depends' as const,
		label: [l.refs ? `${l.refs} ref${l.refs === 1 ? '' : 's'}` : '', l.calls ? `${l.calls} call${l.calls === 1 ? '' : 's'}` : ''].filter(Boolean).join(', '),
	}));
	const groups: GenGroup[] = level === 'container'
		? [{ id: 'system', label: 'System', kind: 'boundary' }]
		: [{ id: idOf(`module:${focusModule ?? modules[0]}`), label: focusModule ?? modules[0], kind: 'boundary', tech: [...new Set(boxes.flatMap(b => b.types.map(t => TECH[t.lang])))].sort(byCode).join(', ') }];
	if (level === 'container') {
		nodes.forEach(n => { n.group = 'system'; });
	}
	if (!edges.length) {
		notes.push('No dependency between these boxes was found in the code: they may talk over HTTP or messages (not drawn) or not at all.');
	}
	notes.push('Dependencies are type references and calls the index resolved. Not drawn: HTTP and message links between services, a database two services share (use a flow or an ER board), and configuration-level wiring.');
	notes.push('Boxes are modules or packages, so they carry no single symbol or line; open a type through a flow or `find_symbol`.');
	const board: GenBoard = {
		version: 1,
		kind: 'architecture',
		level,
		title: focusPackage ? `Architecture: ${focusPackage}` : focusModule ? `Architecture: ${focusModule}` : level === 'container' ? 'Architecture: services' : 'Architecture: packages',
		description: `${nodes.length} ${level === 'container' ? 'service' : 'package'}${nodes.length === 1 ? '' : 's'}, ${edges.length} dependenc${edges.length === 1 ? 'y' : 'ies'}.${universe > nodes.length ? ` ${universe - nodes.length} more not shown.` : ''}`,
		direction: 'TB',
		nodes,
		edges,
		groups,
		...(focusPackage ? { focus: idOf(`${focusModule}:${focusPackage}`) } : {}),
	};
	return { board, notes };
}
