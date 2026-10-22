/*---------------------------------------------------------------------------------------------
 *  Insilode Harness: just enough TOML for Codex's config.toml. It reads the whole file (tables, dotted
 *  keys, every string form, arrays and inline tables) and remembers which lines each table and key
 *  sits on, so an MCP server can be changed by rewriting only its own lines: every other key, and
 *  every comment outside that server, stays as the user wrote it. A server written in a form these
 *  line edits cannot change safely (an inline table, dotted keys spread over other tables) is refused
 *  rather than guessed at.
 *
 *  Pure (no vscode), so it is tested on its own.
 *--------------------------------------------------------------------------------------------*/

export interface TomlSpan {
	/** The table's path, or for a key the table's path plus the key's own (dotted) path. */
	path: string[];
	/** 0-based first line. */
	start: number;
	/** 0-based line after the last one the table's content or the key's value reaches. */
	end: number;
	/** Tables: `[[array]]` tables cannot be edited here. */
	array?: boolean;
	/** Keys whose value is an inline table, `name = { ... }`. */
	inline?: boolean;
}

export interface TomlDoc {
	data: Record<string, unknown>;
	tables: TomlSpan[];
	entries: TomlSpan[];
	lines: string[];
	error?: string;
}

const BARE = /^[A-Za-z0-9_-]+$/;

class Parser {
	i = 0;
	private readonly lineStarts: number[] = [0];

	constructor(readonly s: string) {
		for (let k = 0; k < s.length; k++) {
			if (s[k] === '\n') {
				this.lineStarts.push(k + 1);
			}
		}
	}

	lineAt(pos: number): number {
		let lo = 0, hi = this.lineStarts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (this.lineStarts[mid] <= pos) {
				lo = mid;
			} else {
				hi = mid - 1;
			}
		}
		return lo;
	}

	fail(msg: string): never {
		throw new Error(`line ${this.lineAt(this.i) + 1}: ${msg}`);
	}

	ws() {
		while (this.s[this.i] === ' ' || this.s[this.i] === '\t') {
			this.i++;
		}
	}

	/** Spaces, newlines and comments: what may sit between the items of an array. */
	wsAll() {
		for (; ;) {
			this.ws();
			const c = this.s[this.i];
			if (c === '#') {
				while (this.i < this.s.length && this.s[this.i] !== '\n') {
					this.i++;
				}
			} else if (c === '\n' || c === '\r') {
				this.i++;
			} else {
				return;
			}
		}
	}

	/** The rest of a line after a value: only a comment may follow. */
	endOfLine() {
		this.ws();
		if (this.s[this.i] === '#') {
			while (this.i < this.s.length && this.s[this.i] !== '\n') {
				this.i++;
			}
		}
		if (this.s[this.i] === '\r') {
			this.i++;
		}
		if (this.i < this.s.length && this.s[this.i] !== '\n') {
			this.fail(`unexpected "${this.s[this.i]}"`);
		}
		this.i++;
	}

	key(): string[] {
		const parts: string[] = [];
		for (; ;) {
			this.ws();
			const c = this.s[this.i];
			if (c === '"' || c === "'") {
				parts.push(this.string());
			} else {
				const m = /^[A-Za-z0-9_-]+/.exec(this.s.slice(this.i, this.i + 256));
				if (!m) {
					this.fail('expected a key');
				}
				parts.push(m[0]);
				this.i += m[0].length;
			}
			this.ws();
			if (this.s[this.i] !== '.') {
				return parts;
			}
			this.i++;
		}
	}

	string(): string {
		const s = this.s;
		if (s.startsWith('"""', this.i) || s.startsWith("'''", this.i)) {
			const q = s.slice(this.i, this.i + 3);
			this.i += 3;
			if (s[this.i] === '\r') {
				this.i++;
			}
			if (s[this.i] === '\n') {
				this.i++;
			}
			let out = '';
			for (; ;) {
				if (this.i >= s.length) {
					this.fail('unterminated multi-line string');
				}
				// Up to two quotes may sit right before the closing three: in a run of four or five, the last three close.
				if (s.startsWith(q, this.i)) {
					let run = 3;
					while (run < 5 && s[this.i + run] === q[0]) {
						run++;
					}
					out += q[0].repeat(run - 3);
					this.i += run;
					return out;
				}
				if (q === '"""' && s[this.i] === '\\') {
					// A backslash at the end of a line joins it to the next, dropping the whitespace between.
					const rest = /^\\[ \t]*\r?\n[\s]*/.exec(s.slice(this.i, this.i + 4096));
					if (rest) {
						this.i += rest[0].length;
						continue;
					}
					out += this.escape();
					continue;
				}
				out += s[this.i++];
			}
		}
		const q = s[this.i++];
		let out = '';
		for (; ;) {
			const c = s[this.i];
			if (c === undefined || c === '\n') {
				this.fail('unterminated string');
			}
			if (c === q) {
				this.i++;
				return out;
			}
			if (q === '"' && c === '\\') {
				out += this.escape();
				continue;
			}
			out += c;
			this.i++;
		}
	}

	escape(): string {
		const c = this.s[this.i + 1];
		const simple: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\x1b', '"': '"', '\\': '\\' };
		if (c in simple) {
			this.i += 2;
			return simple[c];
		}
		const len = c === 'u' ? 4 : c === 'U' ? 8 : c === 'x' ? 2 : 0;
		const hex = this.s.slice(this.i + 2, this.i + 2 + len);
		if (!len || !/^[0-9A-Fa-f]+$/.test(hex) || hex.length !== len) {
			this.fail(`bad escape \\${c}`);
		}
		this.i += 2 + len;
		return String.fromCodePoint(parseInt(hex, 16));
	}

	value(): unknown {
		const s = this.s;
		const c = s[this.i];
		if (c === '"' || c === "'") {
			return this.string();
		}
		if (c === '[') {
			this.i++;
			const out: unknown[] = [];
			for (; ;) {
				this.wsAll();
				if (s[this.i] === ']') {
					this.i++;
					return out;
				}
				out.push(this.value());
				this.wsAll();
				if (s[this.i] === ',') {
					this.i++;
				} else if (s[this.i] !== ']') {
					this.fail('expected , or ] in an array');
				}
			}
		}
		if (c === '{') {
			this.i++;
			const out: Record<string, unknown> = {};
			this.wsAll();
			if (s[this.i] === '}') {
				this.i++;
				return out;
			}
			for (; ;) {
				this.wsAll();
				const k = this.key();
				this.ws();
				if (s[this.i] !== '=') {
					this.fail('expected = in an inline table');
				}
				this.i++;
				this.ws();
				assign(out, k, this.value(), this);
				this.wsAll();
				if (s[this.i] === ',') {
					this.i++;
					continue;
				}
				if (s[this.i] === '}') {
					this.i++;
					return out;
				}
				this.fail('expected , or } in an inline table');
			}
		}
		const m = /^[^\s,\]}#]+/.exec(s.slice(this.i, this.i + 256));
		if (!m) {
			this.fail('expected a value');
		}
		this.i += m[0].length;
		const raw = m[0];
		if (raw === 'true' || raw === 'false') {
			return raw === 'true';
		}
		// Dates and times stay text: nothing an MCP server reads is one.
		const n = Number(raw.replace(/_/g, ''));
		return /^[+-]?(\d|inf|nan|0x|0o|0b)/.test(raw) && !Number.isNaN(n) ? n : raw;
	}
}

function assign(target: Record<string, unknown>, key: string[], value: unknown, p: Parser) {
	let t = target;
	for (const k of key.slice(0, -1)) {
		const next = t[k] ??= {};
		if (!next || typeof next !== 'object' || Array.isArray(next)) {
			p.fail(`"${k}" is not a table`);
		}
		t = next as Record<string, unknown>;
	}
	const last = key[key.length - 1];
	if (last in t) {
		p.fail(`"${key.join('.')}" is set twice`);
	}
	t[last] = value;
}

function tableAt(data: Record<string, unknown>, path: string[], array: boolean, p: Parser): Record<string, unknown> {
	let t = data;
	path.forEach((k, n) => {
		const isLast = n === path.length - 1;
		if (isLast && array) {
			const list = (t[k] ??= []) as unknown;
			if (!Array.isArray(list)) {
				p.fail(`"${path.join('.')}" is not an array of tables`);
			}
			const fresh: Record<string, unknown> = {};
			list.push(fresh);
			t = fresh;
			return;
		}
		let next = t[k] ??= {};
		if (Array.isArray(next)) {
			next = next[next.length - 1];
		}
		if (!next || typeof next !== 'object') {
			p.fail(`"${k}" is not a table`);
		}
		t = next as Record<string, unknown>;
	});
	return t;
}

export function parseToml(text: string): TomlDoc {
	const lines = text.split(/\r?\n/);
	const doc: TomlDoc = { data: {}, tables: [], entries: [], lines };
	const p = new Parser(text);
	let current = doc.data;
	let prefix: string[] = [];
	let table: TomlSpan | undefined;
	try {
		for (; ;) {
			p.wsAll();
			if (p.i >= text.length) {
				break;
			}
			const start = p.lineAt(p.i);
			if (text[p.i] === '[') {
				const array = text[p.i + 1] === '[';
				p.i += array ? 2 : 1;
				const path = p.key();
				if (text.slice(p.i, p.i + (array ? 2 : 1)) !== (array ? ']]' : ']')) {
					p.fail('expected ] after a table name');
				}
				p.i += array ? 2 : 1;
				p.endOfLine();
				current = tableAt(doc.data, path, array, p);
				prefix = path;
				table = { path, start, end: start + 1, array: array || undefined };
				doc.tables.push(table);
				continue;
			}
			const key = p.key();
			p.ws();
			if (text[p.i] !== '=') {
				p.fail('expected =');
			}
			p.i++;
			p.ws();
			const inline = text[p.i] === '{';
			const value = p.value();
			const end = p.lineAt(p.i) + 1;
			p.endOfLine();
			assign(current, key, value, p);
			doc.entries.push({ path: [...prefix, ...key], start, end, inline: inline || undefined });
			if (table) {
				table.end = end;
			}
		}
	} catch (e) {
		doc.error = (e as Error).message;
	}
	return doc;
}

// ---------------------------------------------------------------------------------------------
// Writing

export const tomlKey = (k: string) => BARE.test(k) ? k : JSON.stringify(k);

/** A value as TOML: JSON's string escapes are valid TOML basic-string escapes. */
export function tomlValue(v: unknown): string {
	if (typeof v === 'string') {
		return JSON.stringify(v);
	}
	if (typeof v === 'number' || typeof v === 'boolean') {
		return String(v);
	}
	if (Array.isArray(v)) {
		return `[${v.map(tomlValue).join(', ')}]`;
	}
	if (v && typeof v === 'object') {
		const kv = Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${tomlKey(k)} = ${tomlValue(x)}`);
		return kv.length ? `{ ${kv.join(', ')} }` : '{}';
	}
	throw new Error(`cannot write ${typeof v} to TOML`);
}

const isTable = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** `[path]` with its plain keys, then a `[path.sub]` table for each table-valued key. */
export function renderTable(path: string[], obj: Record<string, unknown>): string[] {
	const out = [`[${path.map(tomlKey).join('.')}]`];
	const subs: [string, Record<string, unknown>][] = [];
	for (const [k, v] of Object.entries(obj)) {
		if (v === undefined) {
			continue;
		}
		if (isTable(v)) {
			subs.push([k, v]);
		} else {
			out.push(`${tomlKey(k)} = ${tomlValue(v)}`);
		}
	}
	for (const [k, v] of subs) {
		out.push('', ...renderTable([...path, k], v));
	}
	return out;
}

const startsWith = (path: string[], prefix: string[]) => prefix.length <= path.length && prefix.every((k, n) => path[n] === k);

/** How a table (an MCP server) is written: as its own `[a.b]` tables, not at all, or in a form the line edits below must not touch. */
export function tableForm(doc: TomlDoc, prefix: string[]): 'tables' | 'none' | 'other' {
	const own = doc.tables.filter(t => startsWith(t.path, prefix));
	const keys = doc.entries.filter(e => startsWith(e.path, prefix) || startsWith(prefix, e.path));
	if (!own.length && !keys.length) {
		return 'none';
	}
	// Every key under the prefix must sit inside one of the prefix's own tables, and none of them may be an array table.
	const inside = (e: TomlSpan) => own.some(t => e.start >= t.start && e.end <= t.end && e.path.length > t.path.length && startsWith(e.path, t.path));
	if (!own.some(t => t.path.length === prefix.length) || own.some(t => t.array) || !keys.every(inside)) {
		return 'other';
	}
	return 'tables';
}

/** The line ranges of a table and its sub-tables, from each header to its last key (comments after it belong to what follows). */
function blocks(doc: TomlDoc, prefix: string[]): { start: number; end: number }[] {
	return doc.tables.filter(t => startsWith(t.path, prefix)).map(t => ({ start: t.start, end: t.end })).sort((a, b) => a.start - b.start);
}

/**
 * Replaces the table at `prefix` (and its sub-tables) with `obj`, or removes it when `obj` is undefined, or appends it
 * when it is not there yet. Throws when the table is written in a form this cannot change safely.
 */
export function setTable(text: string, prefix: string[], obj: Record<string, unknown> | undefined): string {
	const doc = parseToml(text);
	if (doc.error) {
		throw new Error(`The file is not valid TOML (${doc.error})`);
	}
	const form = tableForm(doc, prefix);
	if (form === 'other') {
		throw new Error(`[${prefix.map(tomlKey).join('.')}] is written inline or as dotted keys; change it by hand`);
	}
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const lines = text.length ? text.split(/\r?\n/) : [];
	const rendered = obj ? renderTable(prefix, obj) : [];
	if (form === 'none') {
		if (!obj) {
			return text;
		}
		while (lines.length && lines[lines.length - 1].trim() === '') {
			lines.pop();
		}
		return [...lines, ...(lines.length ? [''] : []), ...rendered, ''].join(eol);
	}
	const spans = blocks(doc, prefix);
	// Removed from the bottom up, so the earlier line numbers stay right; the new text goes where the first block was.
	for (const s of [...spans].reverse()) {
		let end = s.end;
		// Removing a server also takes the one blank line after it, so no gap of two is left behind.
		if (!obj && lines[end]?.trim() === '' && (s.start === 0 || lines[s.start - 1]?.trim() === '' || end + 1 >= lines.length)) {
			end++;
		}
		lines.splice(s.start, end - s.start);
	}
	lines.splice(spans[0].start, 0, ...rendered);
	return lines.join(eol);
}

/** Sets (or, with `value` undefined, removes) one plain key inside the table at `prefix`, touching only that key's lines. */
export function setKey(text: string, prefix: string[], key: string, value: unknown): string {
	const doc = parseToml(text);
	if (doc.error) {
		throw new Error(`The file is not valid TOML (${doc.error})`);
	}
	if (tableForm(doc, prefix) !== 'tables') {
		throw new Error(`[${prefix.map(tomlKey).join('.')}] is not written as its own table; change it by hand`);
	}
	const header = doc.tables.find(t => t.path.length === prefix.length && startsWith(t.path, prefix))!;
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const lines = text.split(/\r?\n/);
	const entry = doc.entries.find(e => e.path.length === prefix.length + 1 && startsWith(e.path, prefix) && e.path[prefix.length] === key && e.start > header.start && e.end <= header.end);
	const line = `${tomlKey(key)} = ${value === undefined ? '' : tomlValue(value)}`;
	if (entry) {
		lines.splice(entry.start, entry.end - entry.start, ...(value === undefined ? [] : [line]));
	} else if (value !== undefined) {
		lines.splice(header.start + 1, 0, line);
	}
	return lines.join(eol);
}
