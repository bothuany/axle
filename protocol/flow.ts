// The shapes the flow-view extension host sends to the canvas webview, declared once. Both sides import this file
// type-only (`import type` / `export type`), so it is erased from both bundles: it must stay types only and import
// nothing (checked by `npm run arch`).

export type Kind = 'controller' | 'handler' | 'method' | 'db' | 'ambiguous' | 'external';
export type EdgeKind = 'call' | 'mediator' | 'impl' | 'db' | 'http';

export interface FlowNode {
	key: string;
	symbolId: string | null;
	label: string;
	sub: string;
	kind: Kind;
	file: string | null;
	startLine: number;
	endLine: number;
	code: string | null;
	children: FlowEdge[];
	/** Agent change inside this method (current-file line numbers), when Axle is tracking one. */
	diff?: { added: number[]; removed: { after: number; lines: string[] }[]; plus: number; minus: number };
	/** Database cards: the table a query touches, read from the entity and its ORM configuration. */
	schema?: DbSchema;
	/** Calls the static index could not resolve: the host asks the language server, then drops this field. */
	pending?: { line: number; name: string }[];
}

export interface FlowEdge {
	callLine: number;
	edgeKind: EdgeKind;
	/** The link was made by name alone (the polyglot index found no declared type to follow). */
	guess?: boolean;
	node: FlowNode;
}

export interface EntryPoint {
	id: string;
	controller: string;
	action: string;
	http: string;
	file: string;
	line: number;
}

export interface DbColumn {
	name: string;
	column: string;
	type: string;
	key: boolean;
	nullable: boolean;
	maxLength: number | null;
}

export interface DbSchema {
	entity: string;
	table: string;
	dbSchemaName: string | null;
	context: string;
	columns: DbColumn[];
	relations: string[];
	/** Query operators in the order they run: AsNoTracking, Where, Select, FirstOrDefaultAsync… */
	ops: string[];
	writes: boolean;
	file: string | null;
	line: number;
}
