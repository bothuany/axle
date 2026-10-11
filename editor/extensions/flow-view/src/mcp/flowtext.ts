/*---------------------------------------------------------------------------------------------
 *  Axle agent bridge: a flow as compact indented text, so a model can understand a feature without
 *  reading dozens of files. Each line is one step: `-> L18 Class.method  path:start-end`, where L18
 *  is the line in the caller that makes the call. Database nodes read `[db] table`. Pure: no `vscode`.
 *--------------------------------------------------------------------------------------------*/

import type { FlowNode } from '../providers';

export interface FlowTextOptions {
	/** Call levels below the root that are shown (the root is level 0). */
	depth?: number;
	maxLines?: number;
	/** Path as shown to the model (relative to the workspace). */
	rel: (file: string) => string;
}

export interface FlowText {
	text: string;
	/** Tables the flow touches, in order of first appearance. */
	tables: string[];
	nodes: number;
	truncated: boolean;
}

const where = (n: FlowNode, rel: FlowTextOptions['rel']) => n.file ? `${rel(n.file)}:${n.startLine}${n.endLine > n.startLine ? `-${n.endLine}` : ''}` : '';

function describe(n: FlowNode, rel: FlowTextOptions['rel']): string {
	const loc = where(n, rel);
	if (n.kind === 'db') {
		return `[db] ${n.label}${n.sub ? ` (${n.sub})` : ''}`;
	}
	const tag = n.kind === 'external' ? ' (external)' : n.kind === 'ambiguous' ? ' (ambiguous: several candidates)' : '';
	// The entry's route is in `sub` for the roots of both backends ("GET /users/{id}"); lower down `sub` is a path or namespace.
	return `${n.label}${loc ? `  ${loc}` : n.sub ? `  ${n.sub}` : ''}${tag}`;
}

/** Callees (flow) or callers (the same tree built upwards): `direction` only changes the arrow. */
export function flowToText(root: FlowNode, opts: FlowTextOptions, direction: 'calls' | 'callers' = 'calls'): FlowText {
	const depth = Math.max(0, opts.depth ?? 6);
	const maxLines = opts.maxLines ?? 220;
	const lines: string[] = [];
	const tables: string[] = [];
	const shown = new Set<string>();
	let nodes = 0;
	let truncated = false;
	const arrow = direction === 'calls' ? '->' : '<-';
	const walk = (n: FlowNode, level: number, prefix: string) => {
		nodes++;
		if (lines.length >= maxLines) {
			truncated = true;
			return;
		}
		lines.push(prefix + describe(n, opts.rel));
		if (n.kind === 'db' && !tables.includes(n.label)) {
			tables.push(n.label);
		}
		const key = n.symbolId ?? `${n.file}:${n.startLine}`;
		const again = n.kind !== 'db' && n.children.length > 0 && shown.has(key);
		if (n.kind !== 'db') {
			shown.add(key);
		}
		if (again) {
			lines[lines.length - 1] += '  (expanded above)';
			return;
		}
		if (level >= depth) {
			if (n.children.length) {
				lines[lines.length - 1] += `  (+${n.children.length} deeper)`;
			}
			return;
		}
		for (const c of n.children) {
			if (lines.length >= maxLines) {
				truncated = true;
				return;
			}
			const kind = c.edgeKind === 'mediator' ? ' ~mediator' : c.edgeKind === 'impl' ? ' ~impl' : '';
			const guess = c.guess ? ' ~guess' : '';
			const at = c.callLine > 0 ? `L${c.callLine} ` : '';
			const start = lines.length;
			walk(c.node, level + 1, `${'  '.repeat(level + 1)}${arrow} ${at}`);
			if (lines.length > start && (kind || guess)) {
				lines[start] += `${kind}${guess}`;
			}
		}
	};
	walk(root, 0, '');
	if (truncated) {
		lines.push(`... output cut at ${maxLines} lines; pass a smaller depth or a more specific method.`);
	}
	return { text: lines.join('\n'), tables, nodes, truncated };
}
