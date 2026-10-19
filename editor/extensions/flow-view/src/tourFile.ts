/*---------------------------------------------------------------------------------------------
 *  Axle: "Play Tour from File…". Reads a tour file (a hand-written JSON, see tour/validate.ts), opens the flow the tour is
 *  about and plays it on the canvas. A development command for phase 0 of the guided tours: the same path (`panel.playTour`)
 *  will carry the tours an agent sends.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs, readFileSync, statSync } from 'fs';
import * as vscode from 'vscode';
import { Analyzer, innermost } from './analyzer';
import { entryName, type Endpoints } from './backends';
import { Command } from './commands';
import type { FlowPanel } from './panel';
import { PolyIndex, POLY_LANGUAGES } from './poly/client';
import { parseTourFile, TourFileError, type TourFlow } from './tour/validate';

/** What the command needs of the extension. */
export interface TourHost {
	panel: FlowPanel;
	analyzer: Analyzer;
	poly: PolyIndex;
	endpointList: Endpoints;
	showPoly(id: string, label: string): Promise<void>;
	showRoslyn(id: string, label: string): Promise<void>;
	showEntry(id: string, label: string, source?: 'roslyn' | 'poly'): Promise<void>;
}

/** A tour file is a few KB; one this large is not one. */
const MAX_FILE_BYTES = 1_000_000;

const sameRoute = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toUpperCase() === b.trim().replace(/\s+/g, ' ').toUpperCase();

/** The text of a workspace file for a peek card, or nothing. Large files are not read. */
function readText(file: string): string | undefined {
	try {
		return statSync(file).size > 5_000_000 ? undefined : readFileSync(file, 'utf8');
	} catch {
		return undefined;
	}
}

/** Opens the flow of the method holding `line`, the way "Show Flow at Cursor" does. False: nothing to show a flow of. */
async function showFlowAt(host: TourHost, file: string, line: number): Promise<boolean> {
	const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
	const at = Math.min(Math.max(1, line), doc.lineCount);
	if (POLY_LANGUAGES.has(doc.languageId)) {
		try {
			const hit = await host.poly.functionAt(file, at);
			if (hit) {
				await host.showPoly(hit.id, hit.label);
				return true;
			}
		} catch {
			// the index is not up: the language server below
		}
	}
	if (doc.languageId === 'csharp' && await host.analyzer.hasSolution()) {
		const hit = innermost(await host.analyzer.methods(file), at);
		if (hit) {
			await host.showRoslyn(hit.id, hit.name);
			return true;
		}
	}
	const range = doc.getWordRangeAtPosition(new vscode.Position(at - 1, doc.lineAt(at - 1).firstNonWhitespaceCharacterIndex));
	const label = (range && doc.getText(range).slice(0, 60)) || `${file.split(/[\\/]/).pop()}:${at}`;
	await vscode.commands.executeCommand(Command.showTarget, { kind: 'lsp', uri: doc.uri.toString(), line: at - 1, character: doc.lineAt(at - 1).firstNonWhitespaceCharacterIndex }, label);
	return true;
}

async function openFlow(host: TourHost, flow: TourFlow | undefined, firstStep: { file: string; line: number } | undefined) {
	if (flow?.changes) {
		throw new TourFileError('A tour on the change set is played by the `tour` tool, not from a file. Remove "flow.changes", or name an endpoint or a method.');
	}
	if (flow?.http || flow?.id) {
		const find = (entries: Awaited<ReturnType<Endpoints['fresh']>>) => entries.find(e => flow.id ? e.id === flow.id : sameRoute(e.http, flow.http!));
		const entry = find(host.endpointList.cached()) ?? find(await host.endpointList.fresh());
		if (!entry) {
			throw new TourFileError(`No endpoint "${flow.http ?? flow.id}" in this workspace. Try "Open Endpoint Flow…" to see the names.`);
		}
		await host.showEntry(entry.id, entryName(entry), entry.source);
		return;
	}
	const at = flow?.file ? { file: flow.file, line: flow.line ?? 1 } : firstStep;
	if (at) {
		await showFlowAt(host, at.file, at.line);
		return;
	}
	if (!host.panel.shown) {
		throw new TourFileError('This tour does not say which flow it is about ("flow"), and no flow is open. Open a flow first, or add a "flow" to the file.');
	}
}

/** `source`: a file the caller already chose (a Uri or a path); without one the user picks it. */
export async function playTourFile(host: TourHost, source?: unknown): Promise<void> {
	let uri = source instanceof vscode.Uri ? source : typeof source === 'string' && source ? vscode.Uri.file(source) : undefined;
	uri ??= (await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Play Tour', title: 'Axle: play a tour file', filters: { 'Axle tour': ['json'] } }))?.[0];
	if (!uri) {
		return;
	}
	const roots = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [];
	if (!roots.length) {
		throw new TourFileError('Open a folder first: a tour points at code in the workspace.');
	}
	if ((await fs.stat(uri.fsPath)).size > MAX_FILE_BYTES) {
		throw new TourFileError('That file is too large to be a tour.');
	}
	let json: unknown;
	try {
		json = JSON.parse(await fs.readFile(uri.fsPath, 'utf8'));
	} catch (e) {
		throw new TourFileError(`${uri.fsPath} is not valid JSON: ${(e as Error).message}`);
	}
	const { tour, flow } = parseTourFile(json, { roots, readText });
	const first = tour.steps.find(s => s.at?.file && s.at.startLine > 0);
	await openFlow(host, flow, first?.at && { file: first.at.file, line: first.at.startLine });
	await host.panel.playTour(tour);
}
