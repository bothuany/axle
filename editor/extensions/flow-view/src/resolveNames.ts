/*---------------------------------------------------------------------------------------------
 *  Axle: `flow.index.resolveNames`, for other extensions. Given code names (`UserService`,
 *  `Project.callers`, `buildIndex()`), says which still exist: from the polyglot index first,
 *  then from the language servers' workspace symbols for languages the index does not read
 *  (C#, say). A name nobody can answer for (the index still loading, no language server) is
 *  null, "unknown", never "missing".
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { PolyIndex } from './poly/client';
import { hasName, knownNames, splitName, type KnownNames } from './poly/names';

export interface NameAnswer {
	name: string;
	found: boolean | null;
}

const MAX_NAMES = 200;
/** Names checked against the language servers, one request each: the rest of the misses stay as the index says. */
const MAX_SYMBOL_LOOKUPS = 40;
const SYMBOL_WAIT_MS = 3000;

const bounded = <T>(p: Thenable<T>, ms: number) => Promise.race([Promise.resolve(p), new Promise<undefined>(r => setTimeout(() => r(undefined), ms))]);

export function registerResolveNames(poly: PolyIndex): vscode.Disposable {
	let cache: { at: number; known: KnownNames } | undefined;
	const known = async () => {
		if (!poly.isReady) {
			return undefined;
		}
		if (!cache || Date.now() - cache.at > 30_000) {
			const facts = await poly.typeFacts().catch(() => undefined);
			cache = facts ? { at: Date.now(), known: knownNames(facts.files) } : undefined;
		}
		return cache?.known;
	};
	return vscode.commands.registerCommand('flow.index.resolveNames', async (raw: unknown): Promise<NameAnswer[]> => {
		const names = (Array.isArray(raw) ? raw : []).filter((n): n is string => typeof n === 'string' && n.length <= 200).slice(0, MAX_NAMES);
		const k = await known();
		const answers: NameAnswer[] = names.map(name => ({ name, found: k ? hasName(name, k) : null }));
		let lookups = 0;
		for (const a of answers) {
			if (a.found || lookups >= MAX_SYMBOL_LOOKUPS) {
				continue;
			}
			const n = splitName(a.name);
			if (!n) {
				continue;
			}
			lookups++;
			const found = await bounded(vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', n.member), SYMBOL_WAIT_MS);
			const clean = (s: string) => s.replace(/\(.*$/, '').replace(/<.*$/, '');
			const hit = found?.some(s => clean(s.name) === n.member && (!n.owner || (s.containerName ?? '').split(/[.:]/).pop() === n.owner));
			if (hit) {
				a.found = true;
			} else if (found?.length && a.found === null) {
				// The language servers answered and know no such name: as good as the index saying so.
				a.found = false;
			}
		}
		return answers;
	});
}
