/*---------------------------------------------------------------------------------------------
 *  Axle polyglot index: databases. Tables read from the code that declares them (JPA entities,
 *  SQLAlchemy and Django models, TypeORM entities, Prisma models) and the calls that reach them
 *  (Spring Data repositories, EntityManager, JDBC, SQLAlchemy sessions, Django managers, TypeORM
 *  repositories, Prisma clients, raw SQL).
 *--------------------------------------------------------------------------------------------*/

import type { Ann, CallFact, DbColumn, DbSchema, FieldFact, FuncFact, TypeFact } from './model';

const unq = (s: string | undefined) => s?.trim().replace(/^[a-zA-Z]?["'`]+|["'`]+$/g, '');
const ann = (anns: Ann[], ...names: string[]) => anns.find(a => names.includes(a.name));
const num = (s: string | undefined) => {
	const n = s ? parseInt(s, 10) : NaN;
	return Number.isFinite(n) ? n : null;
};

export interface PrismaModel {
	name: string;
	table: string;
	file: string;
	line: number;
	endLine: number;
	columns: DbColumn[];
	relations: string[];
}

/** Spring Data base interfaces: a repository extending one of these reaches its entity's table. */
const SPRING_REPOS = new Set(['JpaRepository', 'CrudRepository', 'PagingAndSortingRepository', 'ListCrudRepository', 'ListPagingAndSortingRepository', 'MongoRepository', 'ReactiveCrudRepository', 'R2dbcRepository', 'JpaSpecificationExecutor', 'QuerydslPredicateExecutor', 'Repository', 'ElasticsearchRepository']);
const WRITE_OP = /^(?!create(Query|NativeQuery|NamedQuery|QueryBuilder|Criteria|Statement|Native))(save|saveAll|saveAndFlush|delete|deleteAll|deleteBy|deleteById|deleteInBatch|remove|persist|merge|update|insert|create|createMany|upsert|updateMany|deleteMany|add|add_all|bulk_create|bulk_update|get_or_create|update_or_create|executeUpdate|batchUpdate|flush|commit|destroy|increment|decrement|softDelete|restore|insertOne|insertMany|updateOne|deleteOne|findOneAndUpdate|findByIdAndUpdate|findByIdAndDelete)/;

/** Tables a SQL or JPQL string touches, in order: FROM/JOIN/INTO/UPDATE/DELETE FROM. */
export function sqlTables(sql: string): { tables: string[]; writes: boolean; verb: string } {
	const s = sql.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ');
	const verb = (s.match(/^\s*(select|insert|update|delete|merge|with|call|exec|begin|declare)\b/i)?.[1] ?? '').toUpperCase();
	const tables: string[] = [];
	const re = /\b(?:from|join|into|update|merge\s+into|delete\s+from)\s+([A-Za-z_][\w$#]*(?:\.[A-Za-z_][\w$#]*)?)/gi;
	for (let m = re.exec(s); m; m = re.exec(s)) {
		const t = m[1];
		if (!/^(select|where|set|values|the|dual|lateral|unnest|table)$/i.test(t) && !tables.includes(t)) {
			tables.push(t);
		}
	}
	return { tables, writes: /^(INSERT|UPDATE|DELETE|MERGE|CALL|EXEC|BEGIN|DECLARE)$/.test(verb), verb };
}

/** One DDL statement's effect on a table (see `sqlDdl`). */
export interface DdlOp {
	table: string;
	op: 'create' | 'alter-add' | 'alter-drop' | 'alter' | 'rename' | 'drop' | 'index';
	columns: string[];
	to?: string;
	/** 1-based line of the statement in the text. */
	line: number;
}

const IDENT = String.raw`(?:"[^"]+"|` + '`[^`]+`' + String.raw`|\[[^\]]+\]|[A-Za-z_][\w$#]*)`;
const QNAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})*`;
const CONSTRAINT_WORD = String.raw`(?:constraint|primary\s+key|foreign\s+key|unique|check|exclude|partition|period|like)`;

const unquoteName = (raw: string) => raw.split(/\s*\.\s*/).map(p => p.replace(/^["`[]|["`\]]$/g, '')).join('.');
const re = (source: string) => new RegExp(source, 'i');

/** Comments blanked out, newlines kept: offsets in the result are the offsets in `sql`, so lines still count. */
function blankComments(sql: string) {
	return sql.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/--[^\n]*/g, m => ' '.repeat(m.length));
}

/** Statements split at `;` outside quotes and `$$` bodies, each with the line it starts on. */
function splitStatements(sql: string): { text: string; line: number }[] {
	const out: { text: string; line: number }[] = [];
	let start = 0;
	let line = 1;
	let startLine = 1;
	let quote = '';
	let dollar = '';
	const flush = (end: number) => {
		const text = sql.slice(start, end);
		const lead = text.length - text.trimStart().length;
		if (text.trim()) {
			out.push({ text: text.trim(), line: startLine + (text.slice(0, lead).match(/\n/g)?.length ?? 0) });
		}
	};
	for (let i = 0; i < sql.length; i++) {
		const c = sql[i];
		if (c === '\n') {
			line++;
		}
		if (dollar) {
			if (sql.startsWith(dollar, i)) {
				i += dollar.length - 1;
				dollar = '';
			}
		} else if (quote) {
			if (c === quote) {
				quote = '';
			}
		} else if (c === "'" || c === '"' || c === '`') {
			quote = c;
		} else if (c === '$' && /^\$\w*\$/.test(sql.slice(i, i + 40))) {
			dollar = sql.slice(i).match(/^\$\w*\$/)![0];
			i += dollar.length - 1;
		} else if (c === ';') {
			flush(i);
			start = i + 1;
			startLine = line;
		}
	}
	flush(sql.length);
	return out;
}

/** Splits at commas that are not inside parentheses, brackets or quotes. */
export function splitCommas(s: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let quote = '';
	let from = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (quote) {
			quote = c === quote ? '' : quote;
		} else if (c === "'" || c === '"' || c === '`') {
			quote = c;
		} else if (c === '(' || c === '[' || c === '{') {
			depth++;
		} else if (c === ')' || c === ']' || c === '}') {
			depth--;
		} else if (c === ',' && depth === 0) {
			parts.push(s.slice(from, i));
			from = i + 1;
		}
	}
	parts.push(s.slice(from));
	return parts.map(p => p.trim()).filter(Boolean);
}

/** The text inside the parentheses (or brackets) that open at `s[open]`. */
export function bracketBody(s: string, open: number): string {
	let depth = 0;
	let quote = '';
	for (let i = open; i < s.length; i++) {
		const c = s[i];
		if (quote) {
			quote = c === quote ? '' : quote;
		} else if (c === "'" || c === '"' || c === '`') {
			quote = c;
		} else if (c === '(' || c === '[' || c === '{') {
			depth++;
		} else if ((c === ')' || c === ']' || c === '}') && --depth === 0) {
			return s.slice(open + 1, i);
		}
	}
	return s.slice(open + 1);
}

const firstIdent = (s: string) => {
	const m = s.match(re(`^\\s*(${IDENT})`));
	return m ? unquoteName(m[1]) : undefined;
};

/** Column names in the first parentheses of `s`: `(a, b DESC, lower(c))` gives a, b, c. */
function parenColumns(s: string): string[] {
	const open = s.indexOf('(');
	return open < 0 ? [] : splitCommas(bracketBody(s, open)).map(c => c.replace(/^\w+\(\s*/, '')).map(c => firstIdent(c)).filter((c): c is string => !!c);
}

/**
 * What DDL does to tables: CREATE / ALTER / DROP TABLE, CREATE / DROP INDEX, RENAME TABLE (PostgreSQL, MySQL, SQL Server and
 * the usual Flyway, Prisma and plain-SQL migrations). Statements it does not know (data changes, functions) are skipped.
 */
export function sqlDdl(sql: string): DdlOp[] {
	const ops: DdlOp[] = [];
	for (const { text, line } of splitStatements(blankComments(sql))) {
		let m: RegExpMatchArray | null;
		if ((m = text.match(re(String.raw`^create\s+(?:or\s+replace\s+)?(?:(?:global\s+|local\s+)?(?:temporary|temp)\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(${QNAME})\s*(\(|as\b|like\b)?`)))) {
			const open = m[2] === '(' ? text.indexOf('(', m[0].length - 1) : -1;
			const columns = open < 0 ? [] : splitCommas(bracketBody(text, open))
				.filter(d => !re(`^(?:${CONSTRAINT_WORD}|key|index|fulltext|spatial)\\b`).test(d))
				.map(d => firstIdent(d))
				.filter((c): c is string => !!c);
			ops.push({ table: unquoteName(m[1]), op: 'create', columns, line });
		} else if ((m = text.match(re(String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${QNAME})\s+([\s\S]*)$`)))) {
			const table = unquoteName(m[1]);
			for (const action of splitCommas(m[2])) {
				let a: RegExpMatchArray | null;
				if ((a = action.match(re(String.raw`^rename\s+to\s+(${QNAME})`)))) {
					ops.push({ table, op: 'rename', columns: [], to: unquoteName(a[1]), line });
				} else if ((a = action.match(re(String.raw`^rename\s+(?:column\s+)?(${IDENT})\s+to\s+(${IDENT})`)))) {
					ops.push({ table, op: 'rename', columns: [`${unquoteName(a[1])} → ${unquoteName(a[2])}`], line });
				} else if ((a = action.match(re(String.raw`^change\s+(?:column\s+)?(${IDENT})\s+(${IDENT})`)))) {
					ops.push({ table, op: 'rename', columns: [`${unquoteName(a[1])} → ${unquoteName(a[2])}`], line });
				} else if (/^add\s+(?:index|key|fulltext|spatial|unique\s+(?:index|key))\b/i.test(action)) {
					ops.push({ table, op: 'index', columns: parenColumns(action), line });
				} else if (re(String.raw`^add\s+${CONSTRAINT_WORD}\b`).test(action)) {
					ops.push({ table, op: 'alter', columns: [], line });
				} else if ((a = action.match(re(String.raw`^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(${IDENT})`)))) {
					ops.push({ table, op: 'alter-add', columns: [unquoteName(a[1])], line });
				} else if (/^drop\s+(?:index|key)\b/i.test(action)) {
					ops.push({ table, op: 'index', columns: [], line });
				} else if (re(String.raw`^drop\s+${CONSTRAINT_WORD}\b`).test(action) || /^drop\s+foreign\b/i.test(action)) {
					ops.push({ table, op: 'alter', columns: [], line });
				} else if ((a = action.match(re(String.raw`^drop\s+(?:column\s+)?(?:if\s+exists\s+)?(${IDENT})`)))) {
					ops.push({ table, op: 'alter-drop', columns: [unquoteName(a[1])], line });
				} else if ((a = action.match(re(String.raw`^(?:alter|modify)\s+(?:column\s+)?(${IDENT})`)))) {
					ops.push({ table, op: 'alter', columns: [unquoteName(a[1])], line });
				} else {
					ops.push({ table, op: 'alter', columns: [], line });
				}
			}
		} else if ((m = text.match(re(String.raw`^drop\s+table\s+(?:if\s+exists\s+)?(${QNAME}(?:\s*,\s*${QNAME})*)`)))) {
			for (const t of splitCommas(m[1])) {
				ops.push({ table: unquoteName(t), op: 'drop', columns: [], line });
			}
		} else if ((m = text.match(re(String.raw`^create\s+(?:(?:unique|clustered|nonclustered|fulltext|spatial)\s+)*index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(?:${IDENT}\s+)?on\s+(?:only\s+)?(${QNAME})`)))) {
			ops.push({ table: unquoteName(m[1]), op: 'index', columns: parenColumns(text.slice(m[0].length)), line });
		} else if ((m = text.match(re(String.raw`^drop\s+index\s+(?:if\s+exists\s+)?${IDENT}\s+on\s+(${QNAME})`)))) {
			ops.push({ table: unquoteName(m[1]), op: 'index', columns: [], line });
		} else if ((m = text.match(re(String.raw`^rename\s+table\s+(${QNAME})\s+to\s+(${QNAME})`)))) {
			ops.push({ table: unquoteName(m[1]), op: 'rename', columns: [], to: unquoteName(m[2]), line });
		} else if ((m = text.match(/^exec(?:ute)?\s+(?:sys\.)?sp_rename\s+N?'([^']+)'\s*,\s*N?'([^']+)'(?:\s*,\s*N?'COLUMN')?/i))) {
			const [, from, to] = m;
			const dot = from.lastIndexOf('.');
			ops.push(/column/i.test(text) && dot > 0
				? { table: unquoteName(from.slice(0, dot)), op: 'rename', columns: [`${unquoteName(from.slice(dot + 1))} → ${to}`], line }
				: { table: unquoteName(from), op: 'rename', columns: [], to, line });
		}
	}
	return ops;
}

export function looksLikeSql(s: string) {
	return /\b(select\s[\s\S]+\sfrom|insert\s+into|update\s+\w[\w.]*\s+set|delete\s+from|merge\s+into)\b/i.test(s) || /^\s*(from|select)\s+[A-Z]\w*/.test(s);
}

/** What a schema reader hands over: the card's table, and whether its name is a guess (not written in the code). */
export type SchemaFact = Omit<DbSchema, 'ops' | 'writes' | 'context'> & { guess: boolean };

/** The name of a table as it is compared: no quotes or brackets, no schema prefix, case folded. */
export const tableKey = (table: string) => table.replace(/["'`\[\]]/g, '').split('.').pop()!.trim().toLowerCase();

/** JPA / Hibernate entity: @Entity, @Table, @Column, @Id, relations. Superclass fields come in through `inherited`. */
export function javaSchema(t: TypeFact, inherited: FieldFact[]): SchemaFact | undefined {
	const entity = ann(t.annotations, 'Entity', 'Document', 'Table', 'MappedSuperclass');
	if (!entity) {
		return undefined;
	}
	const table = ann(t.annotations, 'Table', 'Document');
	const columns: DbColumn[] = [];
	const relations: string[] = [];
	for (const f of [...inherited, ...t.fields]) {
		if (f.name === 'serialVersionUID' || ann(f.annotations, 'Transient') || /^[A-Z_]+$/.test(f.name)) {
			continue;
		}
		const rel = ann(f.annotations, 'ManyToOne', 'OneToOne', 'OneToMany', 'ManyToMany', 'ElementCollection');
		if (rel) {
			relations.push(`${rel.name === 'ManyToOne' || rel.name === 'OneToOne' ? 'one' : 'many'} ${f.name}`);
			const join = ann(f.annotations, 'JoinColumn');
			if (rel.name === 'ManyToOne' || (rel.name === 'OneToOne' && join)) {
				columns.push({ name: f.name, column: unq(join?.named.name ?? join?.value) ?? `${f.name}_id`, type: f.type, key: false, nullable: unq(join?.named.nullable) !== 'false', maxLength: null });
			}
			continue;
		}
		const col = ann(f.annotations, 'Column', 'Field', 'Basic');
		const id = ann(f.annotations, 'Id', 'EmbeddedId');
		const primitive = /^(int|long|short|byte|boolean|double|float|char)$/.test(f.type);
		columns.push({
			name: f.name,
			column: unq(col?.named.name ?? col?.value) ?? f.name,
			type: f.type,
			key: !!id,
			nullable: !id && !primitive && unq(col?.named.nullable) !== 'false' && !ann(f.annotations, 'NotNull', 'NonNull'),
			maxLength: num(unq(col?.named.length)),
		});
	}
	const named = unq(table?.named.name ?? table?.value ?? table?.named.collection);
	return {
		entity: t.name,
		table: named || t.name,
		// Without a name in @Table the physical name comes from a naming strategy the code does not show.
		guess: !named,
		dbSchemaName: unq(table?.named.schema) ?? null,
		columns: columns.sort((a, b) => Number(b.key) - Number(a.key)),
		relations,
		file: t.file,
		line: t.line,
	};
}

/** SQLAlchemy (Column / mapped_column / relationship) and Django (models.XField) models. */
export function pythonSchema(t: TypeFact, module: string | undefined): SchemaFact & { orm: string } | undefined {
	const tablename = t.fields.find(f => f.name === '__tablename__');
	const django = t.supers.some(s => s === 'models.Model' || s === 'Model') && t.fields.some(f => /^models\.\w+Field|^models\.(ForeignKey|OneToOneField|ManyToManyField)/.test(f.init ?? ''));
	const sqlalchemy = !!tablename || t.fields.some(f => /^(Column|mapped_column|sa\.Column|db\.Column)\(/.test(f.init ?? ''));
	if (!django && !sqlalchemy) {
		return undefined;
	}
	const columns: DbColumn[] = [];
	const relations: string[] = [];
	if (django && !t.fields.some(f => /primary_key\s*=\s*True/.test(f.init ?? ''))) {
		columns.push({ name: 'id', column: 'id', type: 'AutoField', key: true, nullable: false, maxLength: null });
	}
	for (const f of t.fields) {
		const init = f.init ?? '';
		if (f.name.startsWith('__') || f.name.startsWith('Meta.') || f.name === 'objects') {
			continue;
		}
		if (django) {
			const m = init.match(/^models\.(\w+)\(([\s\S]*)\)$/);
			if (!m) {
				continue;
			}
			const [, kind, args] = m;
			if (/^(ForeignKey|OneToOneField)$/.test(kind)) {
				relations.push(`one ${f.name}`);
				columns.push({ name: f.name, column: `${f.name}_id`, type: target(args) ?? kind, key: false, nullable: /null\s*=\s*True/.test(args), maxLength: null });
			} else if (kind === 'ManyToManyField') {
				relations.push(`many ${f.name}`);
			} else {
				columns.push({ name: f.name, column: unq(args.match(/db_column\s*=\s*(['"][^'"]+['"])/)?.[1]) ?? f.name, type: kind.replace(/Field$/, ''), key: /primary_key\s*=\s*True/.test(args), nullable: /null\s*=\s*True/.test(args), maxLength: num(args.match(/max_length\s*=\s*(\d+)/)?.[1]) });
			}
		} else {
			const rel = init.match(/^(?:relationship|db\.relationship|sa\.orm\.relationship)\(([\s\S]*)\)$/);
			if (rel) {
				// Mapped["User"] is one row; Mapped[List["Order"]] (or no annotation) is many, unless uselist=False.
				const one = /uselist\s*=\s*False/.test(rel[1]) || (f.type === 'Mapped' && f.typeArgs.length > 0 && !/^(List|list|Set|set)$/.test(f.typeArgs[0]));
				relations.push(`${one ? 'one' : 'many'} ${f.name}`);
				continue;
			}
			const m = init.match(/^(?:sa\.|db\.)?(?:Column|mapped_column)\(([\s\S]*)\)$/);
			if (!m && f.type !== 'Mapped') {
				continue;
			}
			const args = m?.[1] ?? '';
			const named = unq(args.match(/^\s*(['"][^'"]+['"])/)?.[1]);
			const typeM = args.replace(/^\s*['"][^'"]+['"]\s*,?/, '').match(/^\s*(?:sa\.|db\.)?(\w+)(?:\((\d+)\))?/);
			const fk = args.match(/ForeignKey\(\s*['"]([^'"]+)['"]/);
			columns.push({
				name: f.name,
				column: named ?? f.name,
				type: fk ? `→${fk[1]}` : typeM && !/^(ForeignKey|primary_key|nullable|default)$/.test(typeM[1]) ? typeM[1] : f.typeArgs[0] ?? '',
				key: /primary_key\s*=\s*True/.test(args),
				nullable: /nullable\s*=\s*True/.test(args) || (!/nullable\s*=\s*False/.test(args) && !/primary_key\s*=\s*True/.test(args) && /Optional|None/.test(f.typeArgs.join() + f.type)),
				maxLength: num(typeM?.[2]),
			});
		}
	}
	const dbTable = t.fields.find(f => f.name === 'Meta.db_table');
	const app = (module ?? '').split('.').filter(p => p !== 'models').pop() ?? '';
	const written = unq(tablename?.init) ?? unq(dbTable?.init);
	return {
		entity: t.name,
		table: written ?? (django ? `${app ? app + '_' : ''}${t.name.toLowerCase()}` : t.name),
		// Django's app_model default comes from the app label, which the folder name only suggests.
		guess: written === undefined,
		dbSchemaName: null,
		columns: columns.sort((a, b) => Number(b.key) - Number(a.key)),
		relations,
		file: t.file,
		line: t.line,
		orm: django ? 'Django ORM' : 'SQLAlchemy',
	};
}

function target(args: string) {
	const m = args.match(/^\s*['"]?([\w.]+)['"]?/);
	return m?.[1].split('.').pop();
}

/** TypeORM / MikroORM / Sequelize-typescript entities. */
export function jsSchema(t: TypeFact): SchemaFact | undefined {
	const entity = ann(t.annotations, 'Entity', 'Table', 'Schema');
	if (!entity) {
		return undefined;
	}
	const columns: DbColumn[] = [];
	const relations: string[] = [];
	for (const f of t.fields) {
		const rel = ann(f.annotations, 'ManyToOne', 'OneToOne', 'OneToMany', 'ManyToMany', 'BelongsTo', 'HasMany', 'HasOne', 'BelongsToMany');
		if (rel) {
			relations.push(`${/ManyToOne|OneToOne|BelongsTo|HasOne/.test(rel.name) ? 'one' : 'many'} ${f.name}`);
			continue;
		}
		const col = ann(f.annotations, 'Column', 'PrimaryGeneratedColumn', 'PrimaryColumn', 'CreateDateColumn', 'UpdateDateColumn', 'DeleteDateColumn', 'VersionColumn', 'ObjectIdColumn', 'Property', 'PrimaryKey');
		if (!col) {
			continue;
		}
		const key = /Primary/.test(col.name) || !!ann(f.annotations, 'PrimaryKey');
		columns.push({
			name: f.name,
			column: unq(col.named.name) ?? f.name,
			type: unq(col.named.type) ?? (col.value && !col.args[0]?.startsWith('{') ? col.value : f.type) ?? '',
			key,
			nullable: !key && unq(col.named.nullable) === 'true',
			maxLength: num(unq(col.named.length)),
		});
	}
	const written = entity.value ?? unq(entity.named.name) ?? unq(entity.named.tableName);
	return {
		entity: t.name,
		table: written ?? t.name,
		// @Entity() alone leaves the table name to the naming strategy.
		guess: written === undefined,
		dbSchemaName: unq(entity.named.schema) ?? null,
		columns: columns.sort((a, b) => Number(b.key) - Number(a.key)),
		relations,
		file: t.file,
		line: t.line,
	};
}

/** schema.prisma: model blocks with their fields, @id, @map / @@map. */
export function parsePrisma(text: string, file: string): PrismaModel[] {
	const models: PrismaModel[] = [];
	const lines = text.split('\n');
	let cur: PrismaModel | undefined;
	lines.forEach((l, i) => {
		const start = l.match(/^\s*model\s+(\w+)\s*\{/);
		if (start) {
			cur = { name: start[1], table: start[1], file, line: i + 1, endLine: i + 1, columns: [], relations: [] };
			return;
		}
		if (!cur) {
			return;
		}
		if (/^\s*\}/.test(l)) {
			cur.endLine = i + 1;
			models.push(cur);
			cur = undefined;
			return;
		}
		const map = l.match(/^\s*@@map\(\s*"([^"]+)"/);
		if (map) {
			cur.table = map[1];
			return;
		}
		const f = l.match(/^\s*(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/);
		if (!f || f[1].startsWith('@')) {
			return;
		}
		const [, name, type, list, opt, rest] = f;
		if (/@relation/.test(rest) || list && /^[A-Z]/.test(type) && !/^(String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes)$/.test(type)) {
			cur.relations.push(`${list ? 'many' : 'one'} ${name}`);
			return;
		}
		if (/^[A-Z]/.test(type) && !/^(String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes)$/.test(type) && !/@/.test(rest)) {
			cur.relations.push(`${list ? 'many' : 'one'} ${name}`);
			return;
		}
		cur.columns.push({ name, column: rest.match(/@map\(\s*"([^"]+)"/)?.[1] ?? name, type: type + (list ? '[]' : ''), key: /@id\b/.test(rest), nullable: !!opt, maxLength: num(rest.match(/@db\.\w*Char\((\d+)\)/)?.[1]) });
	});
	for (const m of models) {
		m.columns.sort((a, b) => Number(b.key) - Number(a.key));
	}
	return models;
}

/** What a database call did, in the order it ran: findByEmail, filter, first. */
export function opsOf(call: CallFact) {
	return [call.name, ...(call.chain ?? [])].filter(o => !/^(then|catch|finally|stream|collect|toList|map|forEach|get|orElse|orElseThrow|orElseGet|ifPresent)$/.test(o) || o === call.name);
}

export function isWrite(ops: string[], fn?: FuncFact) {
	return ops.some(o => WRITE_OP.test(o)) || !!fn?.annotations.some(a => a.name === 'Modifying');
}

export function isSpringRepo(t: TypeFact | undefined): string | undefined {
	if (!t) {
		return undefined;
	}
	for (const s of t.supers) {
		if (SPRING_REPOS.has(s) && t.superArgs[s]?.[0]) {
			return t.superArgs[s][0];
		}
	}
	return undefined;
}

export { unq };
