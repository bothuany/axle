/*---------------------------------------------------------------------------------------------
 *  Insilode polyglot index: tree-sitter helpers shared by the extractors.
 *--------------------------------------------------------------------------------------------*/

/** The parts of a web-tree-sitter node the extractors use (the runtime ships its own .d.ts). */
export interface TsNode {
	type: string;
	text: string;
	startPosition: { row: number; column: number };
	endPosition: { row: number; column: number };
	namedChildren: TsNode[];
	children: TsNode[];
	parent: TsNode | null;
	childForFieldName(name: string): TsNode | null;
	childrenForFieldName(name: string): TsNode[];
}

export const line = (n: TsNode) => n.startPosition.row + 1;

/** Node wrappers are fresh objects on every access: compare by position. */
export function same(a: TsNode | null | undefined, b: TsNode | null | undefined) {
	return !!a && !!b && a.type === b.type && a.startPosition.row === b.startPosition.row && a.startPosition.column === b.startPosition.column
		&& a.endPosition.row === b.endPosition.row && a.endPosition.column === b.endPosition.column;
}
export const endLine = (n: TsNode) => n.endPosition.row + 1;

/** Depth-first walk; return false from `visit` to skip a node's children. */
export function walk(n: TsNode, visit: (n: TsNode) => boolean | void) {
	if (visit(n) === false) {
		return;
	}
	for (const c of n.namedChildren) {
		walk(c, visit);
	}
}

/** A string literal's value without quotes, or undefined if the node is not a plain literal. */
export function stringValue(n: TsNode | null | undefined): string | undefined {
	if (!n) {
		return undefined;
	}
	switch (n.type) {
		case 'string_literal':
		case 'string':
		case 'template_string': {
			if (n.namedChildren.some(c => c.type === 'template_substitution' || c.type === 'interpolation')) {
				return n.text.replace(/^[a-zA-Z]*["'`]+|["'`]+$/g, '').replace(/\$\{[^}]*\}|\{[^}]*\}/g, '{…}');
			}
			return n.text.replace(/^[a-zA-Z]*("""|'''|["'`])/, '').replace(/("""|'''|["'`])$/, '');
		}
		case 'text_block':
			return n.text.replace(/^"""/, '').replace(/"""$/, '');
		case 'concatenated_string':
			return n.namedChildren.map(c => stringValue(c) ?? '').join('');
		case 'binary_expression': {
			// "select * " + "from USERS " + where → the literal parts, so table names survive concatenation.
			const parts = n.namedChildren.map(c => stringValue(c));
			return parts.some(p => p !== undefined) ? parts.map(p => p ?? ' ').join('') : undefined;
		}
		case 'parenthesized_expression':
			return stringValue(n.namedChildren[0]);
		default:
			return undefined;
	}
}

/** `List<User>` → { base: 'List', args: ['User'] }; `com.x.User[]` → { base: 'User', args: [] }. */
export function splitType(text: string): { base: string; args: string[] } {
	const t = text.replace(/\s+/g, '').replace(/\[\]$/, '').replace(/^(final|readonly)/, '');
	const lt = t.indexOf('<') >= 0 ? t.indexOf('<') : t.indexOf('[') > 0 && /^[A-Z]/.test(t) ? t.indexOf('[') : -1;
	const base = (lt >= 0 ? t.slice(0, lt) : t).split('.').pop()!.replace(/\?$/, '');
	if (lt < 0) {
		return { base, args: [] };
	}
	const inner = t.slice(lt + 1, t.lastIndexOf(t[lt] === '<' ? '>' : ']'));
	const args: string[] = [];
	let depth = 0;
	let cur = '';
	for (const ch of inner) {
		if (ch === '<' || ch === '[') {
			depth++;
		} else if (ch === '>' || ch === ']') {
			depth--;
		}
		if (ch === ',' && depth === 0) {
			args.push(cur);
			cur = '';
		} else {
			cur += ch;
		}
	}
	if (cur) {
		args.push(cur);
	}
	return { base, args: args.map(a => splitType(a).base).filter(Boolean) };
}

/** Receiver text as the resolver wants it: `this.repo`, `self.db`, `repo`, `a.b` (calls inside are dropped). */
export function receiverText(n: TsNode | null | undefined): string | undefined {
	if (!n) {
		return undefined;
	}
	const t = n.text.replace(/\s+/g, '');
	if (t.length > 80 || /[()[\]{}"'`]/.test(t)) {
		return undefined;
	}
	return t.replace(/^this\??\./, 'this.').replace(/\?\./g, '.');
}
