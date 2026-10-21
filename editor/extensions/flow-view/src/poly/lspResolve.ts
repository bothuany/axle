/*---------------------------------------------------------------------------------------------
 *  Insilode polyglot index + language server: the hybrid. The tree-sitter index finds entry points and
 *  most calls without building anything. What it cannot resolve (a call it left `pending`, or a link
 *  it only guessed by name) is asked to the language server of that file, if one is running:
 *  go-to-definition for the callee, go-to-implementation when the definition is only a declaration.
 *  No server, no answer, or a slow one: the flow stays as the index drew it.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import type { FlowNode } from '../providers';

export interface Place { file: string; line: number }

/** What the resolver needs from a language server: places, 1-based lines, workspace files only. */
export interface Lsp {
	definitions(file: string, line: number, character: number): Promise<Place[]>;
	implementations(file: string, line: number, character: number): Promise<Place[]>;
}

/** What it needs from the polyglot index. */
export interface Index {
	functionAt(file: string, line: number): Promise<{ id: string; label: string } | undefined>;
	graph(id: string, depth?: number): Promise<FlowNode>;
}

type Child = FlowNode['children'][number];

/** The `pending` marks are for the resolver only: the canvas never sees them. */
export function stripPending(node: FlowNode): FlowNode {
	delete node.pending;
	node.children.forEach(c => stripPending(c.node));
	return node;
}

const MAX_LOOKUPS = 30;
const BUDGET_MS = 4000;
const SUBGRAPH_DEPTH = 2;
const MAX_DEPTH = 4;

/** One line ending in `;` (`List<User> findAll();`): a declaration, not a short function. */
function isDeclaration(node: FlowNode) {
	return node.endLine === node.startLine && /;\s*$/.test(node.code ?? '');
}

/** What one `refine()` call spends: the language server lookups, the time, and the counter that keys spliced-in subgraphs. */
interface Budget { lookups: number; deadline: number; spliced: number }

export class LspRefiner {
	private readonly lines = new Map<string, string[]>();

	constructor(private readonly index: Index, private readonly lsp: Lsp) { }

	/** Forget file contents read for column lookups (after a save). */
	reset() {
		this.lines.clear();
	}

	async refine(root: FlowNode): Promise<FlowNode> {
		const budget: Budget = { lookups: 0, deadline: Date.now() + BUDGET_MS, spliced: 0 };
		await this.walk(root, new Set(root.symbolId ? [root.symbolId] : []), budget, 0);
		return stripPending(root);
	}

	/** Spliced-in subgraphs come from separate `graph()` calls whose keys all start at p0: renamed so no two nodes share one (counted per refine call: calls may overlap). */
	private rekey(node: FlowNode, prefix: string) {
		node.key = `${prefix}${node.key}`;
		node.children.forEach(c => this.rekey(c.node, prefix));
	}

	private alive(b: Budget) {
		return b.lookups < MAX_LOOKUPS && Date.now() < b.deadline;
	}

	private async walk(node: FlowNode, ancestors: Set<string>, b: Budget, depth: number): Promise<void> {
		const pending = node.pending ?? [];
		delete node.pending;
		if (depth > MAX_DEPTH) {
			return;
		}
		if (node.file) {
			// Links the index only guessed by name: confirm or correct them.
			for (const child of node.children) {
				if (child.guess && this.alive(b)) {
					await this.verify(node, child, ancestors, b);
				}
			}
			for (const p of pending) {
				if (!this.alive(b)) {
					break;
				}
				await this.resolve(node, p.line, p.name, ancestors, b);
			}
		}
		for (const child of node.children) {
			const id = child.node.symbolId;
			if (id && ancestors.has(id)) {
				delete child.node.pending;
				continue;
			}
			await this.walk(child.node, id ? new Set([...ancestors, id]) : ancestors, b, depth + 1);
		}
	}

	/** Where the call's name sits on its line: the column the language server is asked about. */
	private column(file: string, line: number, name: string): number {
		let all = this.lines.get(file);
		if (!all) {
			try {
				all = fs.readFileSync(file, 'utf8').split('\n');
			} catch {
				all = [];
			}
			this.lines.set(file, all);
		}
		const text = all[line - 1] ?? '';
		const call = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[(<]`).exec(text);
		const at = call ? call.index : text.indexOf(name);
		return Math.max(at, 0);
	}

	private async ask(file: string, line: number, name: string, b: Budget): Promise<Place[]> {
		b.lookups++;
		try {
			return await this.lsp.definitions(file, line, this.column(file, line, name));
		} catch {
			return [];
		}
	}

	/** The function the language server says the call goes to, as a small subgraph; undefined if none. */
	private async target(from: FlowNode, place: Place, ancestors: Set<string>, b: Budget): Promise<FlowNode | undefined> {
		const hit = await this.index.functionAt(place.file, place.line).catch(() => undefined);
		if (!hit) {
			return undefined;
		}
		const sub = await this.index.graph(hit.id, SUBGRAPH_DEPTH).catch(() => undefined);
		if (!sub || (sub.symbolId && ancestors.has(sub.symbolId)) || (sub.file === from.file && sub.startLine === from.startLine)) {
			return undefined;
		}
		this.rekey(sub, `l${++b.spliced}-`);
		return sub;
	}

	private async resolve(node: FlowNode, line: number, name: string, ancestors: Set<string>, b: Budget) {
		const places = await this.ask(node.file!, line, name, b);
		const [first] = places;
		if (!first) {
			return;
		}
		const sub = await this.target(node, first, ancestors, b);
		if (!sub) {
			return;
		}
		node.children.push({ callLine: line, edgeKind: 'call', node: sub });
		// A declaration without a body (interface or abstract method): the language server knows its implementations.
		if (isDeclaration(sub) && this.alive(b)) {
			await this.implement(node, sub, line, name, ancestors, b);
		}
	}

	private async implement(node: FlowNode, decl: FlowNode, line: number, name: string, ancestors: Set<string>, b: Budget) {
		b.lookups++;
		const places = await this.lsp.implementations(node.file!, line, this.column(node.file!, line, name)).catch(() => [] as Place[]);
		const impls: FlowNode[] = [];
		for (const p of places.slice(0, 6)) {
			const sub = await this.target(node, p, ancestors, b);
			if (sub && sub.symbolId !== decl.symbolId) {
				impls.push(sub);
			}
		}
		if (impls.length === 1) {
			decl.children.push({ callLine: line, edgeKind: 'impl', node: impls[0] });
		} else if (impls.length > 1) {
			decl.kind = 'ambiguous';
			decl.sub = `${impls.length} implementations`;
			decl.children.push(...impls.map<Child>(n => ({ callLine: line, edgeKind: 'impl', node: n })));
		}
	}

	/** A name-only link: the language server agrees (guess cleared), disagrees (replaced), or does not know (kept). */
	private async verify(node: FlowNode, child: Child, ancestors: Set<string>, b: Budget) {
		const name = child.node.label.split('.').pop() ?? child.node.label;
		const [first] = await this.ask(node.file!, child.callLine, name, b);
		if (!first) {
			return;
		}
		const guessed = child.node;
		if (guessed.file === first.file && guessed.startLine <= first.line && first.line <= guessed.endLine) {
			delete child.guess;
			return;
		}
		const sub = await this.target(node, first, ancestors, b);
		if (sub) {
			child.node = sub;
			delete child.guess;
		}
	}
}
