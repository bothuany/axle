/*---------------------------------------------------------------------------------------------
 *  Axle: every source of flows behind one list. C# solutions come from the Roslyn analyzer, every
 *  other language from the polyglot (tree-sitter) index. A workspace can hold both.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { Analyzer, EntryPoint } from './analyzer';
import type { PolyIndex } from './poly/client';

/** Which backend draws an entry's flow. */
export type Source = 'roslyn' | 'poly';
export interface Entry extends EntryPoint { source: Source }

/** "Surveys.Start": the controller without its suffix, then the action. */
export const entryName = (e: EntryPoint) => `${e.controller.replace(/Controller$/, '')}.${e.action}`;

/** Analyzer problems that only mean "there is nothing to load yet". */
const BENIGN = /^No (\.sln|solution)/;

export class Endpoints implements vscode.Disposable {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;
	private readonly disposables: vscode.Disposable[];

	constructor(private readonly analyzer: Analyzer, private readonly poly: PolyIndex, private readonly log: vscode.LogOutputChannel) {
		this.disposables = [
			this.changed,
			// The analyzer's list is cached when it is fetched: fetch it once when the solution is loaded.
			analyzer.onDidBecomeReady(() => void this.analyzer.entryPoints().catch(e => this.log.warn(`endpoints: ${e}`)).then(() => this.changed.fire())),
			// The polyglot index has refreshed its own cache before it says so.
			poly.onDidBecomeReady(() => this.changed.fire()),
		];
	}

	/** What is known now, without asking any backend: cheap enough for every change event. */
	cached(): Entry[] {
		return [
			...this.analyzer.cachedEntryPoints().map(e => ({ ...e, source: 'roslyn' as const })),
			...this.poly.cachedEntryPoints().map(e => ({ ...e, source: 'poly' as const })),
		];
	}

	/**
	 * Fresh lists, asked for by the user: this starts the analyzer if the workspace has a solution. A backend that
	 * fails still lets the other answer; `onProblem` hears why (a missing SDK, an analyzer that did not start).
	 */
	async fresh(onProblem: (message: string) => void = () => undefined): Promise<Entry[]> {
		const roslyn = async (): Promise<EntryPoint[]> => {
			if (!await this.analyzer.hasSolution()) {
				return [];
			}
			try {
				return await this.analyzer.entryPoints();
			} catch (e) {
				const message = (e as Error).message ?? String(e);
				if (!BENIGN.test(message)) {
					onProblem(message);
				}
				return this.analyzer.cachedEntryPoints();
			}
		};
		const [r, poly] = await Promise.all([roslyn(), this.poly.entryPoints().catch(() => this.poly.cachedEntryPoints())]);
		return [...r.map(e => ({ ...e, source: 'roslyn' as const })), ...poly.map(e => ({ ...e, source: 'poly' as const }))];
	}

	dispose() {
		this.disposables.forEach(d => d.dispose());
	}
}
