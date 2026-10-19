/*---------------------------------------------------------------------------------------------
 *  Axle skeleton first: the developer's declarations, kept when they hand the skeleton over, and what an agent did to them.
 *  A declaration is kept as its header text (the lines up to the body). After an agent edits a file, a kept header that is no longer
 *  in that file is a warning: changed, renamed or removed, with the text before and after. Nothing is locked: the developer
 *  accepts or reverts. Pure: no vscode, no fs.
 *--------------------------------------------------------------------------------------------*/

import type { TypeInfo } from '../types/model';
import { parseMember, type SkeletonDiff } from './match';

export interface Header {
	/** The type's name in the code. */
	owner: string;
	/** The member's name; absent for the type's own header (its name, kind and supers). */
	name?: string;
	kind: 'type' | 'method' | 'field';
	file: string;
	/** 1-based, where it was when it was kept. */
	line: number;
	/** The header lines exactly as written (indentation included), for Revert. */
	text: string;
}

export interface Warning {
	owner: string;
	name?: string;
	kind: Header['kind'];
	file: string;
	reason: 'changed' | 'renamed' | 'removed';
	before: string;
	/** The header as it is now; absent when the declaration is gone. */
	after?: string;
	/** Where the current header starts (1-based) and how many lines it has. */
	line?: number;
	lines?: number;
}

const MAX_HEADER_LINES = 8;

/** Whitespace does not count: a reformat is not a change. */
export const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The header that starts at `line`: one line for a field; for a type or method, the lines up to the one that opens the body
 * (`{`, `=>`), ends the declaration (`;`) or ends with `:` (Python). Annotations above the line are not part of it.
 */
export function headerAt(text: string, line: number, kind: Header['kind']): { text: string; start: number; lines: number } | undefined {
	const all = text.split(/\r?\n/);
	let i = line - 1;
	if (i < 0 || i >= all.length) {
		return undefined;
	}
	// The index may start a declaration at its annotations or decorators: the header starts at the declaration itself.
	while (i < all.length - 1 && /^\s*(?:@|\[)[\w.]+/.test(all[i]) && !/[{;]\s*$/.test(all[i])) {
		i++;
	}
	if (kind === 'field') {
		return { text: all[i], start: i + 1, lines: 1 };
	}
	const out: string[] = [];
	let depth = 0;
	for (let j = i; j < all.length && out.length < MAX_HEADER_LINES; j++) {
		const l = all[j];
		out.push(l);
		depth += (l.match(/\(/g)?.length ?? 0) - (l.match(/\)/g)?.length ?? 0);
		if (/[{;]|=>/.test(l) || /:\s*(?:#.*)?$/.test(l)) {
			break;
		}
		// A declaration without a body (an interface member, an abstract method) ends where its parentheses close.
		if (depth <= 0 && !/(?:,|\(|<|\||&|\bextends|\bimplements|->|=)\s*$/.test(l)) {
			break;
		}
	}
	// What follows the body's opening brace on the same line is body, not header.
	out[out.length - 1] = out[out.length - 1].replace(/(\{|=>).*$/, '$1');
	return { text: out.join('\n'), start: i + 1, lines: out.length };
}

/** Whether a kept header is still in the file text, wherever it moved. */
export function stillThere(fileText: string, h: Header): boolean {
	return norm(fileText).includes(norm(h.text));
}

/** The declarations the developer wrote for the plan, as the check found them: every matched type and its matched members. */
export function headersOf(diff: SkeletonDiff, types: readonly TypeInfo[], read: (file: string) => string | undefined): Header[] {
	const out: Header[] = [];
	for (const r of diff.nodes) {
		const t = r.typeId ? types.find(x => x.id === r.typeId) : undefined;
		const text = t && read(t.file);
		if (!t || text === undefined) {
			continue;
		}
		const own = headerAt(text, t.line, 'type');
		if (own) {
			out.push({ owner: t.name, kind: 'type', file: t.file, line: own.start, text: own.text });
		}
		for (const m of r.members) {
			if (!m.actual || !m.line || m.check === 'missing') {
				continue;
			}
			const p = parseMember(m.actual);
			if (!p) {
				continue;
			}
			const h = headerAt(text, m.line, p.kind);
			if (h) {
				out.push({ owner: t.name, name: p.name, kind: p.kind, file: t.file, line: h.start, text: h.text });
			}
		}
	}
	return out;
}

/** The kept headers of one file that are gone from its text now. */
export const goneIn = (headers: readonly Header[], file: string, fileText: string, same: (a: string, b: string) => boolean) => headers.filter(h => same(h.file, file) && !stillThere(fileText, h));

/**
 * What became of a kept header that is not in its file any more, from the types the index reads now. The same name is a
 * change; another member of the same kind that was not kept, nearest the old place, is a rename; otherwise it was removed.
 */
export function locate(h: Header, typesNow: readonly TypeInfo[], fileText: string, kept: readonly Header[]): Warning {
	const base = { owner: h.owner, name: h.name, kind: h.kind, file: h.file, before: h.text };
	const inFile = typesNow.filter(t => t.file === h.file || key(t.file) === key(h.file));
	const keptTypes = new Set(kept.filter(k => k.kind === 'type').map(k => key(k.owner)));
	const nearest = <T extends { line?: number }>(xs: T[]) => [...xs].sort((a, b) => Math.abs((a.line ?? 0) - h.line) - Math.abs((b.line ?? 0) - h.line))[0];
	const found = (reason: Warning['reason'], line: number | undefined, kind: Header['kind']): Warning => {
		const now = line ? headerAt(fileText, line, kind) : undefined;
		return now ? { ...base, reason, after: now.text, line: now.start, lines: now.lines } : { ...base, reason: 'removed' };
	};
	const owner = inFile.find(t => key(t.name) === key(h.owner)) ?? typesNow.find(t => key(t.name) === key(h.owner));
	if (h.kind === 'type') {
		if (owner) {
			return found('changed', owner.line, 'type');
		}
		const other = nearest(inFile.filter(t => !keptTypes.has(key(t.name))));
		return other ? found('renamed', other.line, 'type') : { ...base, reason: 'removed' };
	}
	if (!owner) {
		return { ...base, reason: 'removed' };
	}
	const members = [
		...owner.fields.map(f => ({ name: f.name, kind: 'field' as const, line: f.line })),
		...owner.methods.filter(m => !m.isConstructor).map(m => ({ name: m.name, kind: 'method' as const, line: m.line })),
	];
	const same = members.find(m => key(m.name) === key(h.name ?? '') && m.kind === h.kind);
	if (same) {
		return found('changed', same.line, same.kind);
	}
	const keptNames = new Set(kept.filter(k => key(k.owner) === key(h.owner) && k.name).map(k => key(k.name!)));
	const other = nearest(members.filter(m => m.kind === h.kind && !keptNames.has(key(m.name))));
	return other ? found('renamed', other.line, other.kind) : { ...base, reason: 'removed' };
}

/** One line for the dock and the board: "The agent changed OrderService.place: place(Order o) → place(Order o, boolean dry)". */
export function warningText(w: Warning): string {
	const what = w.name ? `${w.owner}.${w.name}` : w.owner;
	const verb = w.reason === 'removed' ? 'removed' : w.reason === 'renamed' ? 'renamed' : 'changed';
	return w.after ? `The agent ${verb} ${what}: ${norm(w.before)} → ${norm(w.after)}` : `The agent ${verb} ${what} (was ${norm(w.before)})`;
}

const eolOf = (text: string) => text.includes('\r\n') ? '\r\n' : '\n';

/** Revert: which lines (1-based, inclusive) to replace with what; nothing when the current header is not where the warning saw it. */
export function revertRange(fileText: string, w: Warning): { startLine: number; endLine: number; text: string } | undefined {
	if (!w.line || !w.lines || w.after === undefined) {
		return undefined;
	}
	const current = fileText.split(/\r?\n/).slice(w.line - 1, w.line - 1 + w.lines);
	if (!norm(current.join('\n')).startsWith(norm(w.after))) {
		return undefined; // the file moved on since the warning: do not write over what is there now
	}
	// The kept header ended where the body opened: keep whatever followed the opening on the current last line.
	const tail = /(\{|=>)(.*)$/.exec(current[current.length - 1])?.[2] ?? '';
	const restored = w.before.split('\n');
	restored[restored.length - 1] += tail;
	return { startLine: w.line, endLine: w.line + w.lines - 1, text: restored.join(eolOf(fileText)) };
}

/** Revert as whole file text. */
export function revertText(fileText: string, w: Warning): string | undefined {
	const r = revertRange(fileText, w);
	if (!r) {
		return undefined;
	}
	const all = fileText.split(/\r?\n/);
	return [...all.slice(0, r.startLine - 1), r.text, ...all.slice(r.endLine)].join(eolOf(fileText));
}

