/*---------------------------------------------------------------------------------------------
 *  Axle polyglot index: migrations. What a migration file does to which tables, read from the file's text: plain SQL
 *  (Flyway, Prisma's migration.sql, hand-written DDL), Liquibase (XML, YAML, JSON), Alembic, Django, TypeORM and Rails.
 *  EF Core migrations are C#: Migrations.cs in the analyzer reads them, and `fromEfFact` gives them the same shape.
 *  Only the forward direction is read (upgrade, Up, up, change, operations), never the rollback. Pure: no `vscode`.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { bracketBody, splitCommas, sqlDdl, tableKey, type DdlOp } from './db';
import type { Migration, MigrationFormat, MigrationOp } from './model';

/** Files worth reading to see whether they are migrations: any SQL, and code or markup in a folder migrations live in. */
export function isMigrationPath(file: string): boolean {
	if (/\.sql$/i.test(file)) {
		return true;
	}
	return /\.(xml|ya?ml|json|py|ts|js|rb|cs)$/i.test(file)
		&& /(^|[\\/])(migrations?|migrate|changelogs?|changesets?|alembic|flyway|liquibase)([\\/]|$)|[\\/]db[\\/]migrate[\\/]|databasechangelog/i.test(file);
}

/** The Django app of a migration: the folder that holds its `migrations` folder. */
const djangoApp = (file: string) => {
	const parts = file.split(/[\\/]/);
	const at = parts.lastIndexOf('migrations');
	return at > 0 ? parts[at - 1] : '';
};

/** Where `parseMigration` can ask what a Django model's table is called (the model's own `db_table`, or the app_model default). */
export interface MigrationContext {
	djangoTable?(app: string, model: string): { table: string; guess: boolean } | undefined;
}

interface Call {
	name: string;
	recv: string;
	args: string[];
	line: number;
	/** The text of the whole argument list. */
	raw: string;
	index: number;
}

const lineAt = (text: string, index: number) => (text.slice(0, index).match(/\n/g)?.length ?? 0) + 1;

/** A string literal's value, when `arg` is nothing else (Python and TypeScript quotes, u"" and r"" prefixes). */
function literal(arg: string | undefined): string | undefined {
	return arg?.trim().match(/^(?:[ur]?)(["'`])((?:\\.|(?!\1)[^\\])*)\1$/s)?.[2];
}

/** Every call `recv.name(...)` that `pattern` finds (it captures the receiver and the name), with its arguments split. */
function calls(text: string, pattern: RegExp, base = 0): Call[] {
	const out: Call[] = [];
	for (const m of text.matchAll(pattern)) {
		const open = (m.index ?? 0) + m[0].length - 1;
		const raw = bracketBody(text, open);
		out.push({ recv: m[1] ?? '', name: m[2] ?? m[1], args: splitCommas(raw), line: lineAt(text, m.index ?? 0) + base, raw, index: m.index ?? 0 });
	}
	return out;
}

/** `name=value` arguments (Python keywords). */
function kwargs(args: string[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const a of args) {
		const m = a.match(/^(\w+)\s*=(?!=)\s*([\s\S]*)$/);
		if (m) {
			out[m[1]] = m[2];
		}
	}
	return out;
}

/** The part of `text` between the first `start` and the next `end` (or the end): the forward half of a migration. */
function section(text: string, start: RegExp, end: RegExp): { text: string; base: number } {
	const from = text.search(start);
	if (from < 0) {
		return { text, base: 0 };
	}
	const rest = text.slice(from);
	const next = rest.slice(1).search(end);
	return { text: next < 0 ? rest : rest.slice(0, next + 1), base: lineAt(text, from) - 1 };
}

const nameOf = (file: string) => path.basename(file).replace(/\.[^.]+$/, '');

function fromDdl(ddl: DdlOp[], base: number): MigrationOp[] {
	return ddl.map(d => ({ table: d.table, op: d.op, columns: d.columns, ...(d.to ? { to: d.to } : {}), line: d.line + base }));
}

/** Raw SQL inside a call or element: its DDL, with the lines counted from where the text starts in the file. */
function sqlIn(text: string, line: number): MigrationOp[] {
	return fromDdl(sqlDdl(text), line - 1);
}

// ── SQL ─────────────────────────────────────────────────────────────────────

function parseSql(file: string, text: string): Migration | undefined {
	const ops = fromDdl(sqlDdl(text), 0);
	if (!ops.length) {
		return undefined;
	}
	const format: MigrationFormat = /[\\/]prisma[\\/]migrations[\\/]/i.test(file) ? 'prisma' : /(^|[\\/])V\d+[._]|flyway|[\\/]db[\\/]migration[\\/]/i.test(file) ? 'flyway' : 'sql';
	return { format, name: format === 'prisma' ? path.basename(path.dirname(file)) : nameOf(file), file, ops, notes: [] };
}

// ── Alembic ─────────────────────────────────────────────────────────────────

function parseAlembic(file: string, text: string): Migration | undefined {
	if (!/\brevision\b/.test(text) || !/\bop\.\w+\(|batch_op\./.test(text)) {
		return undefined;
	}
	const { text: up, base } = section(text, /def\s+upgrade\s*\(/, /\ndef\s+downgrade\s*\(/);
	const ops: MigrationOp[] = [];
	const notes: string[] = [];
	// `with op.batch_alter_table("orders") as batch_op:` makes the calls on batch_op calls on that table.
	const batches = [...up.matchAll(/with\s+op\.batch_alter_table\(\s*(["'])([\w.]+)\1[^)]*\)\s+as\s+(\w+)/g)].map(m => ({ at: m.index ?? 0, table: m[2], alias: m[3] }));
	const columnNames = (raw: string) => [...raw.matchAll(/\bColumn\(\s*(["'])(\w+)\1/g)].map(m => m[2]);
	for (const c of calls(up, /\b(op|\w+)\.(create_table|add_column|drop_column|alter_column|rename_table|drop_table|create_index|drop_index|create_unique_constraint|create_foreign_key|create_primary_key|create_check_constraint|drop_constraint|execute)\s*\(/g, base)) {
		const batch = c.recv === 'op' ? undefined : [...batches].reverse().find(b => b.alias === c.recv && b.at < c.index);
		if (c.recv !== 'op' && !batch) {
			continue;
		}
		const args = batch ? [`'${batch.table}'`, ...c.args] : c.args;
		const kw = kwargs(c.args);
		const table = literal(args[0]);
		const line = c.line;
		if (c.name === 'execute') {
			const sql = literal(c.args[0]) ?? c.raw;
			ops.push(...sqlIn(sql, line));
			continue;
		}
		if (c.name === 'rename_table') {
			const to = literal(args[1]);
			if (table && to) {
				ops.push({ table, op: 'rename', columns: [], to, line });
			}
			continue;
		}
		if (c.name === 'create_index') {
			const t = literal(args[1]) ?? literal(kw.table_name);
			if (t) {
				ops.push({ table: t, op: 'index', columns: [...(c.raw.match(/\[([^\]]*)\]/)?.[1].matchAll(/["'](\w+)["']/g) ?? [])].map(m => m[1]), line });
			}
			continue;
		}
		if (c.name === 'drop_index') {
			const t = literal(kw.table_name) ?? literal(c.args[1]);
			if (t) {
				ops.push({ table: t, op: 'index', columns: [], line });
			}
			continue;
		}
		if (c.name === 'create_unique_constraint' || c.name === 'create_foreign_key' || c.name === 'create_primary_key' || c.name === 'create_check_constraint' || c.name === 'drop_constraint') {
			const t = literal(args[1]) ?? literal(kw.table_name) ?? literal(kw.source_table);
			if (t) {
				ops.push({ table: t, op: 'alter', columns: [], line });
			}
			continue;
		}
		if (!table) {
			notes.push(`line ${line}: ${c.name} on a table name that is not a string`);
			continue;
		}
		if (c.name === 'create_table') {
			ops.push({ table, op: 'create', columns: columnNames(c.raw), line });
		} else if (c.name === 'drop_table') {
			ops.push({ table, op: 'drop', columns: [], line });
		} else if (c.name === 'add_column') {
			ops.push({ table, op: 'alter-add', columns: columnNames(args.slice(1).join(',')), line });
		} else if (c.name === 'drop_column') {
			const col = literal(args[1]) ?? literal(kw.column_name);
			ops.push({ table, op: 'alter-drop', columns: col ? [col] : [], line });
		} else if (c.name === 'alter_column') {
			const col = literal(args[1]) ?? literal(kw.column_name);
			const renamed = literal(kw.new_column_name);
			ops.push(renamed && col ? { table, op: 'rename', columns: [`${col} → ${renamed}`], line } : { table, op: 'alter', columns: col ? [col] : [], line });
		}
	}
	return ops.length ? { format: 'alembic', name: nameOf(file), file, ops, notes } : undefined;
}

// ── Django ──────────────────────────────────────────────────────────────────

function parseDjango(file: string, text: string, ctx: MigrationContext): Migration | undefined {
	if (!/class\s+Migration\s*\(/.test(text) || !/migrations\.\w+\(/.test(text)) {
		return undefined;
	}
	const app = djangoApp(file);
	const ops: MigrationOp[] = [];
	const notes: string[] = [];
	const created = new Map<string, { table: string; guess: boolean }>();
	const resolve = (model: string | undefined) => {
		if (!model) {
			return undefined;
		}
		const known = created.get(model.toLowerCase()) ?? ctx.djangoTable?.(app, model);
		return known ?? { table: `${app ? `${app}_` : ''}${model.toLowerCase()}`, guess: true };
	};
	for (const c of calls(text, /\bmigrations\.(\w+)\s*\(/g)) {
		const kw = kwargs(c.args);
		const arg = (key: string, pos: number) => literal(kw[key] ?? (kw[key] === undefined ? c.args.filter(a => !/^\w+\s*=(?!=)/.test(a))[pos] : undefined));
		const op = (table: { table: string; guess: boolean } | undefined, kind: MigrationOp['op'], columns: string[], to?: string) => {
			if (table) {
				ops.push({ table: table.table, op: kind, columns, ...(to ? { to } : {}), ...(table.guess ? { guess: true } : {}), line: c.line });
			}
		};
		const model = arg('model_name', 0);
		switch (c.name) {
			case 'CreateModel': {
				const name = arg('name', 0);
				const written = c.raw.match(/["']db_table["']\s*:\s*["']([^"']+)["']/)?.[1];
				const table = written ? { table: written, guess: false } : resolve(name);
				if (name && table) {
					created.set(name.toLowerCase(), table);
				}
				const fields = kw.fields ? bracketBody(kw.fields, kw.fields.indexOf('[')) : '';
				op(table, 'create', splitCommas(fields).map(f => f.match(/^\(\s*["'](\w+)["']/)?.[1]).filter((n): n is string => !!n));
				break;
			}
			case 'DeleteModel':
				op(resolve(arg('name', 0)), 'drop', []);
				break;
			case 'AddField':
				op(resolve(model), 'alter-add', [arg('name', 1)].filter((n): n is string => !!n));
				break;
			case 'RemoveField':
				op(resolve(model), 'alter-drop', [arg('name', 1)].filter((n): n is string => !!n));
				break;
			case 'AlterField':
				op(resolve(model), 'alter', [arg('name', 1)].filter((n): n is string => !!n));
				break;
			case 'RenameField': {
				const from = arg('old_name', 1);
				const to = arg('new_name', 2);
				op(resolve(model), 'rename', from && to ? [`${from} → ${to}`] : []);
				break;
			}
			case 'RenameModel': {
				const from = resolve(arg('old_name', 0));
				const to = resolve(arg('new_name', 1));
				op(from, 'rename', [], to?.table);
				if (to) {
					created.set((arg('new_name', 1) ?? '').toLowerCase(), to);
				}
				break;
			}
			case 'AlterModelTable': {
				const to = literal(kw.table) ?? literal(c.args[1]);
				if (to) {
					op(resolve(arg('name', 0)), 'rename', [], to);
				}
				break;
			}
			case 'AddIndex':
			case 'RemoveIndex': {
				const fields = c.raw.match(/fields\s*=\s*\[([^\]]*)\]/)?.[1];
				op(resolve(model), 'index', fields ? [...fields.matchAll(/["'](\w+)["']/g)].map(x => x[1]) : []);
				break;
			}
			case 'AddConstraint':
			case 'RemoveConstraint':
			case 'AlterUniqueTogether':
			case 'AlterIndexTogether':
			case 'AlterModelOptions':
				if (c.name !== 'AlterModelOptions') {
					op(resolve(model ?? arg('name', 0)), 'alter', []);
				}
				break;
			case 'RunSQL': {
				const sql = literal(c.args[0]) ?? literal(kw.sql) ?? c.args[0] ?? '';
				ops.push(...sqlIn(sql.replace(/^(?:[ur]?)(?:"""|''')|(?:"""|''')$/g, ''), c.line));
				break;
			}
		}
	}
	if (/\bmigrations\.RunPython\b/.test(text)) {
		notes.push('RunPython changes data in code, which is not read');
	}
	return ops.length ? { format: 'django', name: nameOf(file), file, ops, notes } : undefined;
}

// ── TypeORM ─────────────────────────────────────────────────────────────────

function parseTypeorm(file: string, text: string): Migration | undefined {
	if (!/queryRunner\s*\.\s*\w+\s*\(/.test(text) || !/MigrationInterface|queryRunner/.test(text)) {
		return undefined;
	}
	const { text: up, base } = section(text, /\b(?:async\s+)?up\s*\(/, /\b(?:async\s+)?down\s*\(/);
	const ops: MigrationOp[] = [];
	const notes: string[] = [];
	const names = (raw: string) => [...raw.matchAll(/\bname\s*:\s*(["'`])([^"'`]+)\1/g)].map(m => m[2]);
	for (const c of calls(up, /\b(queryRunner)\s*\.\s*(query|addColumns?|dropColumns?|renameColumn|changeColumn|createTable|dropTable|renameTable|createIndex|dropIndex|createForeignKey|dropForeignKey|createPrimaryKey|dropPrimaryKey)\s*\(/g, base)) {
		const line = c.line;
		const arg0 = c.args[0] ?? '';
		const table = literal(arg0) ?? names(arg0)[0];
		switch (c.name) {
			case 'query':
				ops.push(...sqlIn(literal(arg0) ?? arg0.replace(/^`|`$/g, ''), line));
				break;
			case 'addColumn':
			case 'addColumns':
				if (table) {
					ops.push({ table, op: 'alter-add', columns: names(c.args.slice(1).join(',')), line });
				}
				break;
			case 'dropColumn':
			case 'dropColumns': {
				const rest = c.args.slice(1).join(',');
				if (table) {
					ops.push({ table, op: 'alter-drop', columns: [...rest.matchAll(/(["'])(\w+)\1/g)].map(m => m[2]).concat(names(rest)).filter((n, i, all) => all.indexOf(n) === i), line });
				}
				break;
			}
			case 'renameColumn': {
				const from = literal(c.args[1]) ?? names(c.args[1] ?? '')[0];
				const to = literal(c.args[2]) ?? names(c.args[2] ?? '')[0];
				if (table && from && to) {
					ops.push({ table, op: 'rename', columns: [`${from} → ${to}`], line });
				}
				break;
			}
			case 'changeColumn': {
				const from = literal(c.args[1]) ?? names(c.args[1] ?? '')[0];
				if (table) {
					ops.push({ table, op: 'alter', columns: from ? [from] : [], line });
				}
				break;
			}
			case 'createTable': {
				const open = c.raw.search(/columns\s*:\s*\[/);
				const cols = open < 0 ? '' : bracketBody(c.raw, c.raw.indexOf('[', open));
				if (table) {
					ops.push({ table, op: 'create', columns: splitCommas(cols).flatMap(e => names(e).slice(0, 1)), line });
				}
				break;
			}
			case 'dropTable':
				if (table) {
					ops.push({ table, op: 'drop', columns: [], line });
				}
				break;
			case 'renameTable': {
				const to = literal(c.args[1]) ?? names(c.args[1] ?? '')[0];
				if (table && to) {
					ops.push({ table, op: 'rename', columns: [], to, line });
				}
				break;
			}
			case 'createIndex':
			case 'dropIndex': {
				const cols = c.raw.match(/columnNames\s*:\s*\[([^\]]*)\]/)?.[1];
				if (table) {
					ops.push({ table, op: 'index', columns: cols ? [...cols.matchAll(/["'`](\w+)["'`]/g)].map(m => m[1]) : [], line });
				}
				break;
			}
			default:
				if (table) {
					ops.push({ table, op: 'alter', columns: [], line });
				}
		}
	}
	return ops.length ? { format: 'typeorm', name: nameOf(file), file, ops, notes } : undefined;
}

// ── Rails ───────────────────────────────────────────────────────────────────

function parseRails(file: string, text: string): Migration | undefined {
	if (!/ActiveRecord::Migration|\bcreate_table\b|\badd_column\b/.test(text)) {
		return undefined;
	}
	const { text: fwd, base } = section(text, /\bdef\s+(?:change|up)\b/, /\n\s*def\s+down\b/);
	const lines = fwd.split('\n');
	const ops: MigrationOp[] = [];
	const list = (s: string) => [...s.matchAll(/[:'"](\w+)/g)].map(m => m[1]);
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i];
		const line = i + 1 + base;
		let m: RegExpMatchArray | null;
		if ((m = l.match(/^\s*create_table\s+[(]?\s*[:'"](\w+)/))) {
			const columns: string[] = [];
			for (let j = i + 1; j < lines.length && !/^\s*end\b/.test(lines[j]); j++) {
				const t = lines[j].match(/^\s*t\.(\w+)\s+[:'"](\w+)/);
				if (t && t[1] !== 'index') {
					columns.push(t[1] === 'references' || t[1] === 'belongs_to' ? `${t[2]}_id` : t[2]);
				}
			}
			ops.push({ table: m[1], op: 'create', columns, line });
		} else if ((m = l.match(/^\s*add_column\s+[(]?\s*[:'"](\w+)\s*,\s*[:'"](\w+)/))) {
			ops.push({ table: m[1], op: 'alter-add', columns: [m[2]], line });
		} else if ((m = l.match(/^\s*remove_column\s+[(]?\s*[:'"](\w+)\s*,\s*[:'"](\w+)/))) {
			ops.push({ table: m[1], op: 'alter-drop', columns: [m[2]], line });
		} else if ((m = l.match(/^\s*remove_columns\s+[(]?\s*[:'"](\w+)\s*,(.*)$/))) {
			ops.push({ table: m[1], op: 'alter-drop', columns: list(m[2]), line });
		} else if ((m = l.match(/^\s*rename_column\s+[(]?\s*[:'"](\w+)\s*,\s*[:'"](\w+)\s*,\s*[:'"](\w+)/))) {
			ops.push({ table: m[1], op: 'rename', columns: [`${m[2]} → ${m[3]}`], line });
		} else if ((m = l.match(/^\s*(?:change_column|change_column_default|change_column_null)\s+[(]?\s*[:'"](\w+)\s*,\s*[:'"](\w+)/))) {
			ops.push({ table: m[1], op: 'alter', columns: [m[2]], line });
		} else if ((m = l.match(/^\s*add_(?:reference|belongs_to)\s+[(]?\s*[:'"](\w+)\s*,\s*[:'"](\w+)/))) {
			ops.push({ table: m[1], op: 'alter-add', columns: [`${m[2]}_id`], line });
		} else if ((m = l.match(/^\s*remove_(?:reference|belongs_to)\s+[(]?\s*[:'"](\w+)\s*,\s*[:'"](\w+)/))) {
			ops.push({ table: m[1], op: 'alter-drop', columns: [`${m[2]}_id`], line });
		} else if ((m = l.match(/^\s*drop_table\s+[(]?\s*[:'"](\w+)/))) {
			ops.push({ table: m[1], op: 'drop', columns: [], line });
		} else if ((m = l.match(/^\s*rename_table\s+[(]?\s*[:'"](\w+)\s*,\s*[:'"](\w+)/))) {
			ops.push({ table: m[1], op: 'rename', columns: [], to: m[2], line });
		} else if ((m = l.match(/^\s*(?:add|remove)_index\s+[(]?\s*[:'"](\w+)\s*,\s*(.*)$/))) {
			ops.push({ table: m[1], op: 'index', columns: list(m[2].replace(/\b\w+:.*$/, '')), line });
		} else if ((m = l.match(/^\s*execute\s+[(]?\s*(?:<<[-~]?\w+|["'%])/))) {
			const body = l.includes('<<') ? lines.slice(i + 1, i + 40).join('\n') : l;
			ops.push(...sqlIn(body.replace(/^\s*execute\s+[(]?["']|["']\s*[)]?\s*$/g, ''), line));
		}
	}
	return ops.length ? { format: 'rails', name: nameOf(file), file, ops, notes: ['Rails migrations name tables by convention only: Ruby has no schema cards, so no column is matched to code'], namesOnly: true } : undefined;
}

// ── Liquibase ───────────────────────────────────────────────────────────────

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`))?.[1];

function parseLiquibaseXml(file: string, text: string): Migration | undefined {
	const body = text.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' ')).replace(/<rollback\b[\s\S]*?<\/rollback>/g, m => m.replace(/[^\n]/g, ' '));
	const ops: MigrationOp[] = [];
	const element = /<(createTable|addColumn|dropColumn|renameColumn|renameTable|dropTable|createIndex|dropIndex|modifyDataType|addNotNullConstraint|dropNotNullConstraint|addDefaultValue|dropDefaultValue|addForeignKeyConstraint|dropForeignKeyConstraint|addPrimaryKey|dropPrimaryKey|addUniqueConstraint|dropUniqueConstraint|sql)\b([^>]*?)(\/?)>/g;
	for (const m of body.matchAll(element)) {
		const [, tag, attrs, selfClosing] = m;
		const index = m.index ?? 0;
		const line = lineAt(body, index);
		const inner = selfClosing ? '' : body.slice(index + m[0].length, Math.max(body.indexOf(`</${tag}>`, index), index));
		if (tag === 'sql') {
			ops.push(...sqlIn(inner.replace(/<!\[CDATA\[|\]\]>/g, ''), line));
			continue;
		}
		const table = attr(attrs, 'tableName') ?? attr(attrs, 'baseTableName') ?? attr(attrs, 'oldTableName');
		const nested = [...inner.matchAll(/<column\b([^>]*)>/g)].map(c => attr(c[1], 'name')).filter((n): n is string => !!n);
		const columnName = attr(attrs, 'columnName');
		if (!table) {
			continue;
		}
		switch (tag) {
			case 'createTable': ops.push({ table, op: 'create', columns: nested, line }); break;
			case 'addColumn': ops.push({ table, op: 'alter-add', columns: nested, line }); break;
			case 'dropColumn': ops.push({ table, op: 'alter-drop', columns: columnName ? [columnName] : nested, line }); break;
			case 'renameColumn': ops.push({ table, op: 'rename', columns: [`${attr(attrs, 'oldColumnName')} → ${attr(attrs, 'newColumnName')}`], line }); break;
			case 'renameTable': ops.push({ table, op: 'rename', columns: [], to: attr(attrs, 'newTableName'), line }); break;
			case 'dropTable': ops.push({ table, op: 'drop', columns: [], line }); break;
			case 'createIndex': ops.push({ table, op: 'index', columns: nested, line }); break;
			case 'dropIndex': ops.push({ table, op: 'index', columns: [], line }); break;
			case 'modifyDataType':
			case 'addNotNullConstraint':
			case 'dropNotNullConstraint':
			case 'addDefaultValue':
			case 'dropDefaultValue': ops.push({ table, op: 'alter', columns: columnName ? [columnName] : [], line }); break;
			default: ops.push({ table, op: 'alter', columns: [], line });
		}
	}
	return ops.length ? { format: 'liquibase', name: nameOf(file), file, ops, notes: [] } : undefined;
}

/** A Liquibase change as the YAML and JSON forms both give it: its kind and its properties. */
interface Change {
	kind: string;
	props: Record<string, unknown>;
	line: number;
}

function opsOfChange(c: Change): MigrationOp[] {
	const p = c.props;
	const s = (k: string) => (typeof p[k] === 'string' || typeof p[k] === 'number' ? String(p[k]) : undefined);
	const columns = (Array.isArray(p.columns) ? p.columns : []).map(x => (x as { column?: { name?: string } })?.column?.name ?? (x as { name?: string })?.name).filter((n): n is string => typeof n === 'string');
	const table = s('tableName') ?? s('baseTableName') ?? s('oldTableName');
	if (c.kind === 'sql') {
		return sqlIn(s('sql') ?? '', c.line);
	}
	if (!table) {
		return [];
	}
	const line = c.line;
	switch (c.kind) {
		case 'createTable': return [{ table, op: 'create', columns, line }];
		case 'addColumn': return [{ table, op: 'alter-add', columns, line }];
		case 'dropColumn': return [{ table, op: 'alter-drop', columns: s('columnName') ? [s('columnName')!] : columns, line }];
		case 'renameColumn': return [{ table, op: 'rename', columns: [`${s('oldColumnName')} → ${s('newColumnName')}`], line }];
		case 'renameTable': return [{ table, op: 'rename', columns: [], to: s('newTableName'), line }];
		case 'dropTable': return [{ table, op: 'drop', columns: [], line }];
		case 'createIndex': return [{ table, op: 'index', columns, line }];
		case 'dropIndex': return [{ table, op: 'index', columns: [], line }];
		case 'modifyDataType': case 'addNotNullConstraint': case 'dropNotNullConstraint': case 'addDefaultValue': case 'dropDefaultValue':
			return [{ table, op: 'alter', columns: s('columnName') ? [s('columnName')!] : [], line }];
		case 'addForeignKeyConstraint': case 'dropForeignKeyConstraint': case 'addPrimaryKey': case 'dropPrimaryKey': case 'addUniqueConstraint': case 'dropUniqueConstraint':
			return [{ table, op: 'alter', columns: [], line }];
		default: return [];
	}
}

const CHANGE_KINDS = /^(createTable|addColumn|dropColumn|renameColumn|renameTable|dropTable|createIndex|dropIndex|modifyDataType|addNotNullConstraint|dropNotNullConstraint|addDefaultValue|dropDefaultValue|addForeignKeyConstraint|dropForeignKeyConstraint|addPrimaryKey|dropPrimaryKey|addUniqueConstraint|dropUniqueConstraint|sql)$/;

function parseLiquibaseJson(file: string, text: string): Migration | undefined {
	let doc: unknown;
	try {
		doc = JSON.parse(text);
	} catch {
		return undefined;
	}
	const log = (doc as { databaseChangeLog?: unknown })?.databaseChangeLog;
	if (!Array.isArray(log)) {
		return undefined;
	}
	const ops: MigrationOp[] = [];
	for (const entry of log) {
		const changes = (entry as { changeSet?: { changes?: unknown[] } })?.changeSet?.changes;
		for (const ch of Array.isArray(changes) ? changes : []) {
			for (const [kind, props] of Object.entries(ch as Record<string, unknown>)) {
				if (CHANGE_KINDS.test(kind)) {
					// JSON has no line numbers of its own: the line of the kind's name.
					const at = text.indexOf(`"${kind}"`);
					ops.push(...opsOfChange({ kind, props: (props ?? {}) as Record<string, unknown>, line: at < 0 ? 1 : lineAt(text, at) }));
				}
			}
		}
	}
	return ops.length ? { format: 'liquibase', name: nameOf(file), file, ops, notes: [] } : undefined;
}

/** Liquibase YAML, read by indentation: a change is `- createTable:` and its properties are the deeper lines. */
function parseLiquibaseYaml(file: string, text: string): Migration | undefined {
	const lines = text.split('\n');
	const ops: MigrationOp[] = [];
	for (let i = 0; i < lines.length; i++) {
		const head = lines[i].match(/^(\s*)-\s*(\w+):\s*$/);
		if (!head || !CHANGE_KINDS.test(head[2])) {
			continue;
		}
		const indent = head[1].length;
		const props: Record<string, unknown> = {};
		const columns: { column: { name: string } }[] = [];
		let inRollback = false;
		for (let j = i + 1; j < lines.length; j++) {
			const l = lines[j];
			if (l.trim() && l.search(/\S/) <= indent) {
				break;
			}
			const kv = l.match(/^\s*(?:-\s*)?(\w+):\s*(.*)$/);
			if (!kv) {
				continue;
			}
			if (kv[1] === 'rollback') {
				inRollback = true;
			}
			if (inRollback) {
				continue;
			}
			if (kv[1] === 'name' && /^\s*-\s*column:|^\s{4,}name:/.test(l) || (kv[1] === 'name' && /column:\s*$/.test(lines[j - 1] ?? ''))) {
				columns.push({ column: { name: kv[2].replace(/^["']|["']$/g, '') } });
			} else if (kv[1] === 'sql') {
				props.sql = kv[2] === '|' || kv[2] === '>' ? lines.slice(j + 1, j + 30).map(x => x.trim()).join('\n') : kv[2].replace(/^["']|["']$/g, '');
			} else if (kv[2] && kv[1] !== 'name') {
				props[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
			}
		}
		props.columns = columns;
		ops.push(...opsOfChange({ kind: head[2], props, line: i + 1 }));
	}
	return ops.length ? { format: 'liquibase', name: nameOf(file), file, ops, notes: [] } : undefined;
}

// ── entry ───────────────────────────────────────────────────────────────────

/**
 * The migration `text` is, or undefined when it is none of the supported formats. EF Core migrations (C#) are read by the analyzer
 * (`fromEfFact`). `ctx` lets Django's model names resolve to the tables the models map to.
 */
export function parseMigration(file: string, source: string, ctx: MigrationContext = {}): Migration | undefined {
	// A checkout with CRLF line endings reads the same as one with LF.
	const text = source.replace(/\r\n/g, '\n');
	const ext = path.extname(file).toLowerCase();
	switch (ext) {
		case '.sql': return parseSql(file, text);
		case '.xml': return /databaseChangeLog/.test(text) ? parseLiquibaseXml(file, text) : undefined;
		case '.json': return /databaseChangeLog/.test(text) ? parseLiquibaseJson(file, text) : undefined;
		case '.yml':
		case '.yaml': return /databaseChangeLog/.test(text) ? parseLiquibaseYaml(file, text) : undefined;
		case '.py': return parseDjango(file, text, ctx) ?? parseAlembic(file, text);
		case '.ts':
		case '.js': return parseTypeorm(file, text);
		case '.rb': return parseRails(file, text);
		default: return undefined;
	}
}

/** What the analyzer's Migrations.cs answers for an EF Core migration file. */
export interface EfFact {
	name: string;
	ops: { table: string; op: MigrationOp['op']; columns: string[]; to?: string; line: number }[];
	sql: { text: string; line: number }[];
	notes: string[];
}

/** An EF migration in the shape of the others; raw `migrationBuilder.Sql(...)` strings go through the DDL reader. */
export function fromEfFact(file: string, fact: EfFact): Migration | undefined {
	const ops: MigrationOp[] = [...fact.ops, ...fact.sql.flatMap(s => sqlIn(s.text, s.line))];
	return ops.length ? { format: 'ef', name: fact.name, file, ops, notes: fact.notes } : undefined;
}

// ── what a migration says, in words ─────────────────────────────────────────

const unique = (list: string[]) => [...new Set(list)];

/** The columns a migration removes or renames away from a table: the names code may still use. */
export function goneColumns(ops: MigrationOp[], table?: string): string[] {
	return unique(ops
		.filter(o => !table || tableKey(o.table) === tableKey(table))
		.flatMap(o => o.op === 'alter-drop' ? o.columns : o.op === 'rename' ? o.columns.map(c => c.split(' → ')[0]) : []));
}

/** "adds key, drops legacy_ref": what the migration does to one table (or, without `table`, to every table it names). */
export function summarize(ops: MigrationOp[], table?: string): string {
	const mine = ops.filter(o => !table || tableKey(o.table) === tableKey(table));
	const parts: string[] = [];
	const names = (kind: MigrationOp['op']) => unique(mine.filter(o => o.op === kind).flatMap(o => o.columns));
	if (mine.some(o => o.op === 'create')) {
		parts.push(`creates the table${names('create').length ? ` (${names('create').slice(0, 6).join(', ')}${names('create').length > 6 ? ', …' : ''})` : ''}`);
	}
	if (names('alter-add').length) {
		parts.push(`adds ${names('alter-add').join(', ')}`);
	}
	if (names('alter-drop').length) {
		parts.push(`drops ${names('alter-drop').join(', ')}`);
	}
	if (names('alter').length || mine.some(o => o.op === 'alter' && !o.columns.length)) {
		parts.push(names('alter').length ? `changes ${names('alter').join(', ')}` : 'changes its constraints');
	}
	for (const o of mine.filter(x => x.op === 'rename')) {
		parts.push(o.to ? `renames the table to ${o.to}` : `renames ${o.columns.join(', ')}`);
	}
	if (mine.some(o => o.op === 'index')) {
		const cols = names('index');
		parts.push(`indexes${cols.length ? ` ${cols.join(', ')}` : ''}`);
	}
	if (mine.some(o => o.op === 'drop')) {
		parts.push('drops the table');
	}
	return parts.join(', ') || 'changes it';
}

/** The verb of a whole migration for a root item: "creates", "alters", "drops" or "renames". */
export function verbOf(ops: MigrationOp[], table: string): string {
	const mine = ops.filter(o => tableKey(o.table) === tableKey(table));
	return mine.length && mine.every(o => o.op === 'create') ? 'creates' : mine.length && mine.every(o => o.op === 'drop') ? 'drops' : mine.some(o => o.op === 'rename' && o.to) && mine.length === 1 ? 'renames' : 'alters';
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Finds a column in code by name: as written (legacy_ref), in camel case (legacyRef) and in Pascal case (LegacyRef, which is what an
 * EF property or a getter is called), alone or after get/set/is/has. A longer name that merely starts with it does not match.
 */
export function mentionPattern(column: string): RegExp {
	const words = column.split(/[_\s-]+/).filter(Boolean);
	const pascal = words.map(w => w[0].toUpperCase() + w.slice(1)).join('');
	const camel = pascal[0].toLowerCase() + pascal.slice(1);
	const variants = [...new Set([column, camel, pascal])].map(escapeRe).join('|');
	return new RegExp(`(?<![A-Za-z0-9_])(?:get|set|is|has)?(?:${variants})(?![A-Za-z0-9_])`);
}
