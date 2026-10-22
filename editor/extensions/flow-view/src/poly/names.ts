/*---------------------------------------------------------------------------------------------
 *  Insilode polyglot index: does a code name still exist? Text outside the code (an agent's memory,
 *  a note) names things like `UserService`, `Project.callers` or `buildIndex()`; this answers
 *  from the index's types and functions whether each one is still there. Pure, so it is tested on
 *  its own; the host adds what the language servers know for languages the index does not read.
 *--------------------------------------------------------------------------------------------*/

import type { FileFacts } from './model';

export interface KnownNames {
	types: Set<string>;
	funcs: Set<string>;
	/** `Owner.member` for methods and fields. */
	members: Set<string>;
}

export function knownNames(files: readonly Pick<FileFacts, 'types' | 'funcs'>[]): KnownNames {
	const k: KnownNames = { types: new Set(), funcs: new Set(), members: new Set() };
	for (const f of files) {
		for (const t of f.types) {
			k.types.add(t.name);
			for (const field of t.fields ?? []) {
				k.members.add(`${t.name}.${field.name}`);
			}
		}
		for (const fn of f.funcs) {
			k.funcs.add(fn.name);
			if (fn.owner) {
				k.members.add(`${fn.owner}.${fn.name}`);
			}
		}
	}
	return k;
}

/** `pkg.Class.method()`, `Class#method`, `Class::method` → owner `Class`, member `method`; `buildIndex()` → `buildIndex`. */
export function splitName(name: string): { owner?: string; member: string } | undefined {
	const s = name.trim().replace(/\(\s*\)$/, '').replace(/<[^<>]*>/g, '');
	const parts = s.split(/\.|#|::/).filter(Boolean);
	if (!parts.length || !parts.every(p => /^[A-Za-z_$][\w$]*$/.test(p))) {
		return undefined;
	}
	return parts.length === 1 ? { member: parts[0] } : { owner: parts[parts.length - 2], member: parts[parts.length - 1] };
}

/** Whether `name` is in the index: a member under its owner, or a type or function of that name. */
export function hasName(name: string, k: KnownNames): boolean {
	const n = splitName(name);
	if (!n) {
		return false;
	}
	if (n.owner) {
		return k.members.has(`${n.owner}.${n.member}`) || (k.types.has(n.owner) && k.types.has(n.member));
	}
	return k.types.has(n.member) || k.funcs.has(n.member);
}
