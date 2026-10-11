/*---------------------------------------------------------------------------------------------
 *  Axle agent bridge: which flows an agent's turn touched. Given the files edited in a turn, finds the
 *  entry points (endpoints, jobs) that reach the functions in those files, using only backends that are
 *  ready (nothing is started or asked). It is file-level: every function of an edited file counts, so the
 *  list is "may be affected", capped in time and size because Roslyn answers one request at a time.
 *--------------------------------------------------------------------------------------------*/

import type { Analyzer } from '../analyzer';
import { entryName, type Endpoints, type Entry } from '../backends';
import type { PolyIndex } from '../poly/client';
import type { FlowProvider, FlowTarget } from '../providers';

export interface AffectedFlow {
	id: string;
	/** What the user reads: the verb and route ("POST /orders"). */
	label: string;
	/** What `flow.showEntry` takes as the label: "Orders.Place". */
	name: string;
	source: 'roslyn' | 'poly';
}

export interface TurnImpact {
	files: number;
	flows: AffectedFlow[];
	/** More flows than fit in `flows`. */
	more: number;
	/** Why the answer may be incomplete. */
	note?: string;
}

const MAX_FILES = 6;
const MAX_FUNCTIONS_PER_FILE = 25;
const MAX_FLOWS = 12;
const BUDGET_MS = 7000;

/** The entry an impact line ("GET Users.Delete", "DELETE /users/{id} UsersController.Delete") stands for. */
export function entryForItem(item: string, entries: Entry[]): Entry | undefined {
	const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
	const want = norm(item);
	return entries.find(e => norm(`${e.http} ${e.controller}.${e.action}`) === want)
		?? entries.find(e => norm(`${e.http} ${entryName(e)}`) === want)
		?? entries.find(e => ` ${want}`.endsWith(` ${norm(`${e.controller}.${e.action}`)}`) || ` ${want}`.endsWith(` ${norm(entryName(e))}`));
}

export async function turnImpact(files: string[], d: { analyzer: Analyzer; poly: PolyIndex; endpoints: Endpoints; providerFor(t: FlowTarget): FlowProvider }): Promise<TurnImpact> {
	const deadline = Date.now() + BUDGET_MS;
	const entries = d.endpoints.cached();
	const found = new Map<string, AffectedFlow>();
	const unique = [...new Set(files)];
	let skipped = Math.max(0, unique.length - MAX_FILES);
	let partial = false;
	for (const file of unique.slice(0, MAX_FILES)) {
		if (Date.now() > deadline) {
			skipped++;
			continue;
		}
		let targets: FlowTarget[] = [];
		try {
			if (/\.cs$/i.test(file)) {
				// Only when the analyzer is already up: asking for it here could start a solution load nobody wanted.
				targets = d.analyzer.isReady ? (await d.analyzer.methods(file)).slice(0, MAX_FUNCTIONS_PER_FILE).map(m => ({ kind: 'roslyn' as const, id: m.id })) : [];
				partial ||= !d.analyzer.isReady;
			} else if (d.poly.isReady) {
				targets = (await d.poly.methods(file)).slice(0, MAX_FUNCTIONS_PER_FILE).map(m => ({ kind: 'poly' as const, id: m.id }));
			} else {
				partial = true;
			}
		} catch {
			continue; // a file the backends do not know (a config, a doc)
		}
		for (const t of targets) {
			if (Date.now() > deadline) {
				partial = true;
				break;
			}
			try {
				const { items } = await d.providerFor(t).impact(t);
				for (const item of items) {
					const e = entryForItem(item, entries);
					if (e) {
						found.set(e.id, { id: e.id, label: e.http, name: entryName(e), source: e.source });
					}
				}
			} catch {
				// one function failing must not lose the rest
			}
		}
	}
	const flows = [...found.values()].sort((a, b) => a.label.localeCompare(b.label));
	return {
		files: unique.length,
		flows: flows.slice(0, MAX_FLOWS),
		more: Math.max(0, flows.length - MAX_FLOWS),
		note: skipped || partial ? 'Partial: some files were not checked (index or analyzer not ready, or too many files).' : undefined,
	};
}
