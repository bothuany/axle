/*---------------------------------------------------------------------------------------------
 *  Insilode polyglot index: Java declarations out of a file that does not parse. tree-sitter recovers from a broken import or an unclosed
 *  call by turning the whole file into one ERROR node with its tokens flattened, so `class_declaration` is gone and the type is
 *  not in the index at all. A developer who has written a class (even half of it) still has written it, so this reads the type
 *  headers and the members of each body from the text itself. It only adds what the tree did not find.
 *--------------------------------------------------------------------------------------------*/

import type { Ann, FieldFact, FuncFact, ParamFact, TypeFact } from './model';
import { splitType } from './ts';

const MODIFIER = '(?:public|protected|private|abstract|final|static|sealed|non-sealed|strictfp|default|synchronized|native|transient|volatile)';
const TYPE_HEADER = new RegExp(`(?<![\\w.@])((?:${MODIFIER}\\s+)*)(class|interface|enum|record)\\s+([A-Za-z_$][\\w$]*)`, 'g');
const STATEMENT_WORD = /^(?:return|new|throw|else|if|for|while|do|switch|case|try|catch|import|package|super|this|assert|yield)\b/;

/** The text with comments and string and char literals blanked out (newlines and offsets kept), so braces and parentheses in them count for nothing. */
export function blank(text: string): string {
	return text.replace(/\/\*[\s\S]*?(\*\/|$)|\/\/[^\n]*|"""[\s\S]*?("""|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/g, m => m.replace(/[^\n]/g, ' '));
}

/** Index of the brace that closes the one at `open`, or the end of the text when it never closes. */
function closeOf(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if (text[i] === '{') {
			depth++;
		} else if (text[i] === '}' && --depth === 0) {
			return i;
		}
	}
	return text.length;
}

function annotationsBefore(code: string, raw: string, at: number): Ann[] {
	const m = /((?:@[\w.]+(?:\s*\([^)]*\))?\s*)+)$/.exec(code.slice(Math.max(0, at - 800), at));
	if (!m) {
		return [];
	}
	const anns: Ann[] = [];
	const offset = at - m[1].length;
	for (const a of m[1].matchAll(/@([\w.]+)(?:\s*\(([^)]*)\))?/g)) {
		const start = offset + a.index + a[0].indexOf('(');
		const args = a[2] === undefined ? '' : raw.slice(start + 1, start + 1 + a[2].length);
		const first = /"((?:\\.|[^"\\])*)"/.exec(args);
		anns.push({ name: a[1].split('.').pop()!, full: a[1], value: first?.[1], named: {}, args: args.trim() ? [args.trim()] : [] });
	}
	return anns;
}

const visibility = (mods: string, fallback: '+' | '-' | '#' | '~'): '+' | '-' | '#' | '~' =>
	/\bpublic\b/.test(mods) ? '+' : /\bprivate\b/.test(mods) ? '-' : /\bprotected\b/.test(mods) ? '#' : fallback;

/** Parameters `@PathVariable String customerId, final List<Foo> foos`: split at the commas outside generics. */
function params(list: string): ParamFact[] {
	const out: ParamFact[] = [];
	let depth = 0;
	let cur = '';
	const parts: string[] = [];
	for (const ch of list) {
		depth += ch === '<' || ch === '(' ? 1 : ch === '>' || ch === ')' ? -1 : 0;
		if (ch === ',' && depth === 0) {
			parts.push(cur);
			cur = '';
		} else {
			cur += ch;
		}
	}
	parts.push(cur);
	for (const p of parts) {
		const anns = [...p.matchAll(/@([\w.]+)/g)].map(a => a[1].split('.').pop()!);
		const bare = p.replace(/@[\w.]+(?:\s*\([^)]*\))?/g, ' ').replace(/\bfinal\b/g, ' ').replace(/\s+/g, ' ').trim();
		const m = /^(.+?)\s+(\.\.\.\s*)?([A-Za-z_$][\w$]*)$/.exec(bare);
		if (m) {
			out.push({ name: m[3], typeText: m[1] + (m[2] ? '[]' : ''), anns });
		}
	}
	return out;
}

interface Statement {
	text: string;
	/** Where it starts in the file text. */
	at: number;
	/** The statement ended in a block (a method with a body), not a semicolon. */
	block: boolean;
}

/** The statements at the top level of a type body: split at `;` and at the end of a `{ ... }` block, the blocks themselves dropped. */
function statements(code: string, open: number, close: number): Statement[] {
	const out: Statement[] = [];
	let start = open + 1;
	let depth = 0;
	for (let i = open + 1; i < close; i++) {
		const ch = code[i];
		if (ch === '{') {
			if (depth++ === 0) {
				out.push({ text: code.slice(start, i), at: start, block: true });
			}
		} else if (ch === '}') {
			if (--depth === 0) {
				start = i + 1;
			}
		} else if (ch === ';' && depth === 0) {
			out.push({ text: code.slice(start, i), at: start, block: false });
			start = i + 1;
		}
	}
	if (depth === 0 && code.slice(start, close).trim()) {
		out.push({ text: code.slice(start, close), at: start, block: false });
	}
	return out;
}

/** Types declared in `text` that `known` does not have yet, with their fields and methods; and members the known types lack. */
export function recoverJava(text: string, file: string, firstLine: number, facts: { types: TypeFact[]; funcs: FuncFact[] }): void {
	const code = blank(text);
	const lineAt = (offset: number) => firstLine + (code.slice(0, offset).match(/\n/g)?.length ?? 0);
	for (const m of code.matchAll(TYPE_HEADER)) {
		const name = m[3];
		const open = code.indexOf('{', m.index + m[0].length);
		// A header with no body at all is not a declaration (`Foo.class`, a comment that was not blank).
		const bodyless = open < 0 || /[;)]/.test(code.slice(m.index + m[0].length, open).replace(/<[^>]*>/g, '').replace(/\([^)]*\)/g, ''));
		if (bodyless) {
			continue;
		}
		const header = code.slice(m.index + m[0].length, open);
		const kind: TypeFact['kind'] = m[2] === 'interface' ? 'interface' : m[2] === 'enum' ? 'enum' : 'class';
		const close = closeOf(code, open);
		const decl = m.index + m[1].length - m[1].trimStart().length;
		const known = facts.types.find(t => t.name === name && Math.abs(t.line - lineAt(m.index)) <= 1)
			?? facts.types.find(t => t.name === name && t.file === file && !t.outer);
		const type: TypeFact = known ?? {
			name, file, line: lineAt(decl), endLine: lineAt(Math.min(close, code.length - 1)), kind,
			isAbstract: /\babstract\b/.test(m[1]), supers: [], superArgs: {}, annotations: annotationsBefore(code, text, decl),
			fields: [], methods: [], declKind: m[2] === 'record' ? 'record' : undefined, visibility: visibility(m[1], '~'),
		};
		if (!known) {
			const typeParams = /^\s*<([^>]*)>/.exec(header);
			if (typeParams) {
				type.typeParams = typeParams[1].split(',').map(p => p.trim().split(/\s+/)[0]).filter(Boolean);
			}
			for (const clause of header.matchAll(/\b(extends|implements)\s+([^{]*?)(?=\bimplements\b|\bextends\b|$)/g)) {
				let depth = 0;
				let cur = '';
				const refs: string[] = [];
				for (const ch of clause[2]) {
					depth += ch === '<' ? 1 : ch === '>' ? -1 : 0;
					if (ch === ',' && depth === 0) {
						refs.push(cur);
						cur = '';
					} else {
						cur += ch;
					}
				}
				refs.push(cur);
				for (const r of refs.filter(x => x.trim())) {
					const { base, args } = splitType(r);
					if (base) {
						type.supers.push(base);
						if (args.length) {
							type.superArgs[base] = args;
						}
					}
				}
			}
		}
		const inInterface = kind === 'interface';
		for (const s of kind === 'enum' ? [] : statements(code, open, close)) {
			const body = s.text;
			const lead = body.length - body.trimStart().length;
			const annotations = annotationsBefore(code, text, s.at + lead + (/^\s*(?:@[\w.]+(?:\s*\([^)]*\))?\s*)+/.exec(body)?.[0].length ?? 0));
			const bare = body.replace(/@[\w.]+(?:\s*\([^)]*\))?/g, ' ').replace(/\s+/g, ' ').trim();
			if (!bare || STATEMENT_WORD.test(bare) || /^[}\s]*$/.test(bare)) {
				continue;
			}
			const at = lineAt(s.at + lead + (/^\s*(?:@[\w.]+(?:\s*\([^)]*\))?\s*)+/.exec(body)?.[0].length ?? 0));
			const method = new RegExp(`^((?:${MODIFIER}\\s+)*)(<[^>]*>\\s*)?(?:([\\w$.<>\\[\\]?,& ]+?)\\s+)?([A-Za-z_$][\\w$]*)\\s*\\(([^()]*)\\)\\s*(?:throws\\s+[\\w$.,\\s]+)?$`).exec(bare);
			if (method) {
				const [, mods, , ret, fn, list] = method;
				const ctor = !ret && fn === name;
				if (!ret && !ctor) {
					continue; // a call, not a declaration
				}
				const mname = ctor ? '<init>' : fn;
				if (known && type.methods.includes(mname) && facts.funcs.some(f => f.owner === name && f.file === file && f.name === mname)) {
					continue;
				}
				const info = params(list);
				const f: FuncFact = {
					id: `${file}#${name}.${mname}@${at}`, name: mname, owner: name, file, line: at, endLine: at, params: Object.fromEntries(info.map(p => [p.name, splitType(p.typeText).base])),
					locals: {}, consts: {}, annotations, calls: [], isAccessor: false, // the body is not read, so a getX is not assumed to be plumbing
					 isPublic: /\bpublic\b/.test(mods) || inInterface, isStatic: /\bstatic\b/.test(mods),
					returns: ret?.trim(), visibility: visibility(mods, inInterface ? '+' : '~'),
					isAbstract: /\babstract\b/.test(mods) || (inInterface && !s.block && !/\b(default|static|private)\b/.test(mods)) || undefined,
				};
				if (info.length) {
					f.paramInfo = info;
				}
				type.methods.push(mname);
				facts.funcs.push(f);
				continue;
			}
			const field = new RegExp(`^((?:${MODIFIER}\\s+)*)([\\w$.<>\\[\\]?,& ]+?)\\s+([A-Za-z_$][\\w$]*)\\s*(?:=.*)?$`).exec(bare);
			if (field && !s.block) {
				const [, mods, ftype, fname] = field;
				if (type.fields.some(f => f.name === fname)) {
					continue;
				}
				const ty = splitType(ftype);
				const f: FieldFact = {
					name: fname, type: ty.base, typeArgs: ty.args, annotations, line: at, typeText: ftype.replace(/\s+/g, ' ').trim(),
					visibility: visibility(mods, inInterface ? '+' : '~'), isStatic: inInterface || /\bstatic\b/.test(mods), isFinal: inInterface || /\bfinal\b/.test(mods),
				};
				type.fields.push(f);
			}
		}
		if (!known) {
			facts.types.push(type);
		}
	}
}
