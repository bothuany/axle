/*---------------------------------------------------------------------------------------------
 *  Insilode agent bridge: free-text search over the entry points ("delete user" finds
 *  `DELETE /users/{id}`). A verb word (delete, create, list ...) counts for the HTTP verb as well as
 *  for names; plural and singular match; camelCase names are split. Pure: no `vscode`.
 *--------------------------------------------------------------------------------------------*/

export interface SearchEntry {
	id: string;
	http: string;
	controller: string;
	action: string;
	file: string;
	line: number;
	source?: string;
}

/** Words that name the kind of thing asked for rather than which one. */
const STOP = new Set(['a', 'an', 'the', 'of', 'for', 'to', 'in', 'on', 'and', 'or', 'flow', 'flows', 'endpoint', 'endpoints', 'api', 'route', 'routes', 'open', 'show', 'entry', 'point', 'handler', 'method', 'please']);

const VERB_WORDS: Record<string, string[]> = {
	delete: ['DELETE'], remove: ['DELETE'], destroy: ['DELETE'], drop: ['DELETE'], del: ['DELETE'],
	create: ['POST'], add: ['POST'], new: ['POST'], insert: ['POST'], submit: ['POST'], post: ['POST'], register: ['POST'],
	get: ['GET'], fetch: ['GET'], read: ['GET'], list: ['GET'], find: ['GET'], search: ['GET'], load: ['GET'],
	update: ['PUT', 'PATCH'], edit: ['PUT', 'PATCH'], modify: ['PUT', 'PATCH'], change: ['PUT', 'PATCH'], put: ['PUT'], patch: ['PATCH'],
};

const singular = (w: string) => w.length > 3 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;

/** Lower-case words of a text; camelCase and snake_case are split, route parameters such as {id} are dropped. */
export function words(text: string): string[] {
	return text
		.replace(/\{[^}]*\}|:[A-Za-z_]\w*|<[^>]*>/g, ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
}

export interface Hit<T extends SearchEntry> { entry: T; score: number }

/**
 * Entries that match the query, best first. A query with only a verb ("delete") ranks by verb; with nouns
 * ("delete user") the nouns must match somewhere (name, route or file) and the verb breaks ties up.
 */
export function searchEntries<T extends SearchEntry>(entries: T[], query: string, limit = 10): Hit<T>[] {
	const tokens = words(query).filter(t => !STOP.has(t));
	const cap = Math.max(1, Math.min(50, Math.floor(limit) || 10));
	if (!tokens.length) {
		return [...entries].sort((a, b) => a.controller.localeCompare(b.controller) || a.line - b.line).slice(0, cap).map(entry => ({ entry, score: 0 }));
	}
	const verbs = new Set(tokens.flatMap(t => VERB_WORDS[t] ?? []));
	const nouns = tokens.filter(t => !VERB_WORDS[t]).map(singular);
	const hits: Hit<T>[] = [];
	for (const entry of entries) {
		const [verb = '', ...route] = entry.http.split(/\s+/);
		const fields: [string[], number][] = [
			[words(entry.action).map(singular), 3],
			[words(entry.controller).map(singular), 3],
			[words(route.join(' ')).map(singular), 2],
			[words(entry.file.split(/[\\/]/).slice(-2).join('/')).map(singular), 1],
		];
		let score = 0;
		let matched = 0;
		for (const noun of nouns) {
			let best = 0;
			for (const [hay, weight] of fields) {
				if (hay.includes(noun)) {
					best = Math.max(best, weight);
				} else if (noun.length >= 3 && hay.some(h => h.startsWith(noun) || (h.length >= 4 && noun.startsWith(h)))) {
					best = Math.max(best, weight * 0.5);
				}
			}
			if (best) {
				matched++;
				score += best;
			}
		}
		if (nouns.length && !matched) {
			continue;
		}
		if (verbs.size) {
			if (verbs.has(verb.toUpperCase())) {
				score += 2.5;
			} else if (!nouns.length) {
				continue; // verb-only query: other verbs are not what was asked
			} else {
				score -= 1; // "delete user" still lists GET /users/{id} below the DELETE
			}
		}
		// A verb spelled in the method name ("Delete", "RemoveUser") is a match even without a route.
		const actionWords = words(entry.action);
		if (tokens.some(t => VERB_WORDS[t] && actionWords.includes(t))) {
			score += 1.5;
		}
		score += matched === nouns.length ? 1 : 0;
		if (score > 0) {
			hits.push({ entry, score });
		}
	}
	return hits.sort((a, b) => b.score - a.score || a.entry.controller.localeCompare(b.entry.controller) || a.entry.line - b.entry.line).slice(0, cap);
}
