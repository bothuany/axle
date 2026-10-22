/*---------------------------------------------------------------------------------------------
 *  Insilode: `flow.index.resolveNames`, for other extensions. Given code names (`UserService`,
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
/** Language server lookups at once. */
const PARALLEL_LOOKUPS = 8;
/** How long a language server's answer about a name is kept. */
const SYMBOL_TTL_MS = 5 * 60_000;

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
	const symbols = new Map<string, { at: number; found: boolean | undefined }>();
	/** Whether the language servers know `name`: true, false when they answered without it, undefined when none answered. */
	const lookup = async (name: string): Promise<boolean | undefined> => {
		const seen = symbols.get(name);
		if (seen && Date.now() - seen.at < SYMBOL_TTL_MS) {
			return seen.found;
		}
		const n = splitName(name)!;
		const list = await bounded(vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', n.member), SYMBOL_WAIT_MS);
		const clean = (s: string) => s.replace(/\(.*$/, '').replace(/<.*$/, '');
		const found = list?.some(s => clean(s.name) === n.member && (!n.owner || (s.containerName ?? '').split(/[.:]/).pop() === n.owner)) ? true : list?.length ? false : undefined;
		// Only an answer is kept: a server that was still starting gets asked again next time.
		if (found !== undefined) {
			symbols.set(name, { at: Date.now(), found });
		}
		return found;
	};
	return vscode.commands.registerCommand('flow.index.resolveNames', async (raw: unknown): Promise<NameAnswer[]> => {
		const names = (Array.isArray(raw) ? raw : []).filter((n): n is string => typeof n === 'string' && n.length <= 200).slice(0, MAX_NAMES);
		const k = await known();
		const answers: NameAnswer[] = names.map(name => ({ name, found: k ? hasName(name, k) : null }));
		// The language servers are asked a few names at a time, not one after another (40 names × 3 s was two minutes), and
		// what they said is kept for a while: the harness map asks again on every rescan.
		const misses = answers.filter(a => !a.found && splitName(a.name)).slice(0, MAX_SYMBOL_LOOKUPS);
		for (let i = 0; i < misses.length; i += PARALLEL_LOOKUPS) {
			await Promise.all(misses.slice(i, i + PARALLEL_LOOKUPS).map(async a => {
				const found = await lookup(a.name);
				if (found === true) {
					a.found = true;
				} else if (found === false && a.found === null) {
					// The language servers answered and know no such name: as good as the index saying so.
					a.found = false;
				}
			}));
		}
		return answers;
	});
}
