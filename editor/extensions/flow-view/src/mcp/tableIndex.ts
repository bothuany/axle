/*---------------------------------------------------------------------------------------------
 *  Axle: from a table to the endpoints that read or write it. The polyglot index (worker) and the C# analyzer each
 *  walk the flow of every entry point and note the database cards it reaches; this joins their answers with the entry
 *  list, and answers "which endpoints use this table" for a table name, an entity class, or the entity an edit changed.
 *
 *  Nothing is cached here: the worker and the analyzer cache their walks and start over when the index or the solution
 *  changes (graph.ts `tableUses`, Tables.cs). A walk that does not finish within its budget is continued by the next
 *  question, and the answer says how far it got. The analyzer is only asked when it is already ready, so a table
 *  question never starts a solution load. Pure (no `vscode`), so it is tested on its own.
 *--------------------------------------------------------------------------------------------*/

import type { Entry } from '../backends';
import { tableKey } from '../poly/db';
import type { TableEntity, TablesFact, TableUseFact } from '../poly/model';
import type { LineRange } from './changedMethods';

/** An entry point as a table answer names it (the same id, label and name `turnImpact` gives a flow). */
export interface TableEndpoint {
	id: string;
	/** The verb and route ("POST /orders"). */
	label: string;
	/** What `flow.showEntry` takes as the label: "Orders.Place". */
	name: string;
	source: 'roslyn' | 'poly';
}

/** One endpoint's way to one table: the database card it reaches, and the method that makes the call. */
export interface TableUse {
	endpoint: TableEndpoint;
	mode: 'read' | 'write';
	/** The table comes from ORM metadata and the card was resolved through a typed repository or DbSet; false: a naming default or a raw SQL string. */
	certain: boolean;
	card: string;
	from: string;
	file: string | null;
	line: number;
	ops: string[];
}

/** Who uses a table, as far as the walk got. */
export interface TableUses {
	table: string;
	entity?: string;
	/** The mapping from the entity to this table name is itself a guess (a naming default). */
	guess: boolean;
	uses: TableUse[];
	/** Distinct endpoints, writers and readers (one that does both counts in each). */
	endpoints: number;
	writers: number;
	readers: number;
	/** Entry points walked, of how many; fewer than all means the answer is partial. */
	checked: number;
	of: number;
	/** Why the answer may be incomplete. */
	notes: string[];
}

/** What a changed entity file resolved to. */
export interface ChangedTable extends TableUses {
	entity: string;
	file: string;
	line: number;
}

export interface TableDeps {
	entries(): Entry[];
	poly: { isReady: boolean; entities(): Promise<TableEntity[]>; tables(budgetMs: number): Promise<TablesFact> };
	analyzer: { isReady: boolean; entities(): Promise<{ entities: TableEntity[] } | undefined>; tables(budgetMs: number): Promise<TablesFact | undefined> };
}

/** What a table answer cannot see, always said: the index follows ORM calls and string SQL only. */
export const NOT_CHECKED = 'dynamic SQL, views, stored procedures and triggers; other services or reports that read the same database; migrations (not mapped yet); endpoints in languages without schema cards (Go, PHP, Ruby, Rust)';

const same = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
const nameOf = (e: Entry) => `${e.controller.replace(/Controller$/, '')}.${e.action}`;

/**
 * The entity declarations an edit's lines overlap: all of a file's when the lines are not known. With the file's `text` a span is only
 * trusted when it still holds the entity's name there: a span from a copy of the file older than the disk (the analyzer re-reads a file
 * a moment after it changes) cannot place an edit, so that entity counts as changed.
 */
export function entitiesTouched(list: TableEntity[], file: string, ranges: LineRange[] | undefined, text?: string): { entity: TableEntity; line: number }[] {
	const hit: { entity: TableEntity; line: number }[] = [];
	const lines = text?.split(/\r?\n/);
	for (const e of list) {
		const span = e.spans.find(s => same(s.file, file) && (!ranges || (lines && !lines.slice(s.line - 1, s.endLine).join('\n').includes(e.entity)) || ranges.some(r => s.line <= r.end && r.start <= s.endLine)));
		if (span) {
			hit.push({ entity: e, line: span.line });
		}
	}
	return hit;
}

export class TableIndex {
	constructor(private readonly d: TableDeps) { }

	/** The entities the backends know; `cs` / `other` say which backends the question is about. A backend that is not ready is named in `notes`. */
	async entities(want: { cs: boolean; other: boolean } = { cs: true, other: true }): Promise<{ list: TableEntity[]; notes: string[] }> {
		const list: TableEntity[] = [];
		const notes: string[] = [];
		if (want.other) {
			if (this.d.poly.isReady) {
				list.push(...await this.d.poly.entities().catch(() => []));
			} else {
				notes.push('the code index is not ready');
			}
		}
		if (want.cs) {
			const found = this.d.analyzer.isReady ? await this.d.analyzer.entities().catch(() => undefined) : undefined;
			if (found) {
				list.push(...found.entities);
			} else if (this.d.entries().some(e => e.source === 'roslyn')) {
				notes.push('the C# analyzer is not loaded, so C# entities and endpoints are not checked');
			}
		}
		return { list, notes };
	}

	/**
	 * Every database card reached so far, from both backends, with how many entry points were walked. Each backend continues where
	 * its last walk stopped, so asking again after a partial answer gets further.
	 */
	async facts(budgetMs: number): Promise<{ uses: (TableUseFact & { source: 'roslyn' | 'poly' })[]; checked: number; of: number; notes: string[] }> {
		const entries = this.d.entries();
		const notes: string[] = [];
		const [poly, roslyn] = await Promise.all([
			this.d.poly.isReady ? this.d.poly.tables(budgetMs).catch(() => undefined) : undefined,
			this.d.analyzer.isReady ? this.d.analyzer.tables(budgetMs).catch(() => undefined) : undefined,
		]);
		const polyEntries = entries.filter(e => e.source === 'poly').length;
		const roslynEntries = entries.filter(e => e.source === 'roslyn').length;
		if (!poly && polyEntries) {
			notes.push('the code index is not ready');
		}
		if (!roslyn && roslynEntries) {
			notes.push('the C# analyzer is not loaded: its endpoints are not checked');
		}
		const parts = [{ fact: poly, source: 'poly' as const }, { fact: roslyn, source: 'roslyn' as const }];
		for (const { fact, source } of parts) {
			if (fact && !fact.done) {
				notes.push(`${source === 'poly' ? 'the code index' : 'the C# analyzer'} has walked ${fact.checked} of ${fact.total} entry points so far: ask again for the rest`);
			}
		}
		return {
			uses: parts.flatMap(({ fact, source }) => (fact?.uses ?? []).map(u => ({ ...u, source }))),
			checked: (poly?.checked ?? 0) + (roslyn?.checked ?? 0),
			of: (poly?.total ?? 0) + (roslyn?.total ?? 0),
			notes,
		};
	}

	/** The endpoints that use one table, out of facts already walked. */
	usesOf(table: string, entity: string | undefined, guess: boolean, facts: Awaited<ReturnType<TableIndex['facts']>>): TableUses {
		const key = tableKey(table);
		const byId = new Map(this.d.entries().map(e => [`${e.source}:${e.id}`, e]));
		const uses: TableUse[] = [];
		for (const u of facts.uses) {
			const e = byId.get(`${u.source}:${u.entry}`);
			if (tableKey(u.table) !== key || !e) {
				continue;
			}
			uses.push({ endpoint: { id: e.id, label: e.http, name: nameOf(e), source: e.source }, mode: u.write ? 'write' : 'read', certain: !u.guess, card: u.card, from: u.from, file: u.file, line: u.line, ops: u.ops });
		}
		uses.sort((a, b) => a.endpoint.label.localeCompare(b.endpoint.label) || a.endpoint.name.localeCompare(b.endpoint.name) || a.mode.localeCompare(b.mode));
		const ids = (mode?: 'read' | 'write') => new Set(uses.filter(u => !mode || u.mode === mode).map(u => `${u.endpoint.source}:${u.endpoint.id}`)).size;
		return { table, entity, guess, uses, endpoints: ids(), writers: ids('write'), readers: ids('read'), checked: facts.checked, of: facts.of, notes: facts.notes };
	}

	/** What a table name or an entity class stands for, and who uses it. Undefined when no entity is declared by that name and no endpoint reaches a table by it. */
	async lookup(name: string, budgetMs: number): Promise<TableUses | undefined> {
		const { list, notes } = await this.entities();
		const want = name.trim();
		const byEntity = list.filter(e => e.entity.toLowerCase() === want.toLowerCase());
		const byTable = list.filter(e => tableKey(e.table) === tableKey(want));
		const hit = byEntity[0] ?? byTable[0];
		const facts = await this.facts(budgetMs);
		if (hit) {
			return { ...this.usesOf(hit.table, hit.entity, hit.guess, facts), notes: [...new Set([...notes, ...facts.notes])] };
		}
		// No declared entity: a raw SQL string may still name the table.
		const raw = facts.uses.find(u => tableKey(u.table) === tableKey(want));
		return raw ? { ...this.usesOf(raw.table, undefined, true, facts), notes: [...new Set([...notes, ...facts.notes])] } : undefined;
	}

	/** Tables named by the index, for a "no such table" message. */
	async known(): Promise<string[]> {
		const { list } = await this.entities();
		return [...new Set(list.map(e => e.table))].sort();
	}

	/**
	 * The tables an edit changed: the entities (or their ORM configuration) whose lines `ranges` overlap in each file, with the endpoints
	 * that read or write each one. A file whose lines are unknown counts whole. The walk is only started when some file holds an entity.
	 */
	async changed(files: { file: string; ranges?: LineRange[]; text?: string }[], limit: number, budgetMs: number): Promise<{ tables: ChangedTable[]; notes: string[] }> {
		if (!files.length) {
			return { tables: [], notes: [] };
		}
		const cs = files.some(f => /\.cs$/i.test(f.file));
		const { list, notes } = await this.entities({ cs, other: files.some(f => !/\.cs$/i.test(f.file)) });
		const found = new Map<string, { entity: TableEntity; file: string; line: number }>();
		for (const f of files) {
			for (const { entity, line } of entitiesTouched(list, f.file, f.ranges, f.text)) {
				found.set(`${entity.entity}|${tableKey(entity.table)}`, { entity, file: f.file, line });
			}
		}
		if (!found.size) {
			return { tables: [], notes };
		}
		const facts = await this.facts(budgetMs);
		const tables = [...found.values()].slice(0, limit).map(({ entity, file, line }) => ({ ...this.usesOf(entity.table, entity.entity, entity.guess, facts), entity: entity.entity, file, line }));
		const more = found.size - tables.length;
		return { tables, notes: [...new Set([...notes, ...facts.notes, ...more > 0 ? [`${more} more changed tables not looked at`] : []])] };
	}
}

/** "4 endpoints read or write it" for a table's root item and the dock. */
export function usedBy(t: Pick<TableUses, 'endpoints' | 'writers' | 'readers'>): string {
	if (!t.endpoints) {
		return 'no endpoint reads or writes it';
	}
	return t.endpoints === 1 ? '1 endpoint reads or writes it' : `${t.endpoints} endpoints read or write it`;
}

/**
 * The `impact` answer for a table: endpoints split into writes and reads, each with the method that makes the call and the card it
 * reaches, then what is only a guess and what was not checked.
 */
export function tableImpactText(t: TableUses, rel: (file: string) => string): string[] {
	const where = (u: TableUse) => u.file ? `${rel(u.file)}${u.line > 0 ? `:${u.line}` : ''}` : '';
	const line = (u: TableUse) => `- ${u.endpoint.label} ${u.endpoint.name}  via ${u.from}${where(u) ? ` (${where(u)})` : ''}, card ${u.card}${u.ops.length ? ` [${u.ops.join(' → ')}]` : ''}${u.certain ? '' : '  ~table? (guessed)'}`;
	const out = [`Impact of changing table ${t.table}${t.entity ? ` (entity ${t.entity})` : ''}:`];
	if (t.guess) {
		out.push(`The table name "${t.table}" is a naming default: the entity does not write it, so the mapping is a guess.`);
	}
	out.push(t.endpoints ? `${t.endpoints} endpoint${t.endpoints === 1 ? '' : 's'} read or write it (${t.writers} write, ${t.readers} read):` : 'No endpoint reads or writes it.');
	for (const [title, mode] of [['Writes', 'write'], ['Reads', 'read']] as const) {
		const list = t.uses.filter(u => u.mode === mode);
		if (list.length) {
			out.push('', `${title} (${new Set(list.map(u => `${u.endpoint.source}:${u.endpoint.id}`)).size}):`, ...list.slice(0, 80).map(line), ...list.length > 80 ? [`... and ${list.length - 80} more`] : []);
		}
	}
	if (t.uses.some(u => !u.certain)) {
		out.push('', '~table? marks a guess: the table is named by a raw SQL string or a naming default, not by ORM metadata through a typed repository or DbSet.');
	}
	out.push('', `Checked ${t.checked} of ${t.of} entry points${t.notes.length ? ` (partial: ${t.notes.join('; ')})` : ''}.`, `Not checked: ${NOT_CHECKED}.`);
	return out;
}
