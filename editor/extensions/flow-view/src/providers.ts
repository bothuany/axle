/*---------------------------------------------------------------------------------------------
 *  Axle: where a flow comes from. One provider per kind of target; the canvas only sees FlowNode.
 *--------------------------------------------------------------------------------------------*/

import type { Analyzer } from './analyzer';

/** Same shape the canvas lays out (custom-ide/ui/src/types.ts). */
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
	children: { callLine: number; edgeKind: 'call' | 'mediator' | 'impl' | 'db' | 'http'; guess?: boolean; node: FlowNode }[];
	/** Calls the static index could not resolve: the host asks the language server, then drops this field. */
	pending?: { line: number; name: string }[];
}

/** Opaque to the webview; each provider defines its own fields. */
export type FlowTarget =
	| { kind: 'roslyn'; id: string }
	| { kind: 'lsp'; uri: string; line: number; character: number }
	| { kind: 'poly'; id: string };

export interface FlowProvider {
	graph(target: FlowTarget): Promise<FlowNode>;
	callers(target: FlowTarget): Promise<FlowNode | null>;
	/** What breaks if this changes: entry points (or, without a framework adapter, root callers). */
	impact(target: FlowTarget): Promise<{ label: string; items: string[] }>;
}

/** C#/.NET: the Roslyn analyzer, which also resolves MediatR and DI hops. */
export class RoslynProvider implements FlowProvider {
	constructor(private readonly analyzer: Analyzer) { }

	private id(t: FlowTarget) {
		if (t.kind !== 'roslyn') {
			throw new Error('not a Roslyn target');
		}
		return encodeURIComponent(t.id);
	}

	graph(t: FlowTarget) {
		return this.analyzer.get<FlowNode>(`/api/graph?id=${this.id(t)}&depth=5`);
	}

	callers(t: FlowTarget) {
		return this.analyzer.get<FlowNode>(`/api/callers?id=${this.id(t)}&depth=3`);
	}

	async impact(t: FlowTarget) {
		return { label: 'endpoint', items: await this.analyzer.get<string[]>(`/api/impact?id=${this.id(t)}`) };
	}
}
