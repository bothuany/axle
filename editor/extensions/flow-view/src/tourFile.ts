/*---------------------------------------------------------------------------------------------
 *  Axle: "Play Tour from File…". Reads a tour file (a hand-written JSON, see tour/validate.ts), opens the flow the tour is
 *  about and plays it on the canvas. A development command for phase 0 of the guided tours: the same path (`panel.playTour`)
 *  will carry the tours an agent sends.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import { Analyzer, innermost } from './analyzer';
import { entryName, type Endpoints } from './backends';
import { Command } from './commands';
import type { FlowPanel } from './panel';
import { PolyIndex, POLY_LANGUAGES } from './poly/client';
import { realInside, readTextIn } from './tour/files';
import type { Method } from './tour/resolve';
import { methodsOf } from './tourMethods';
import { parseTourFile, stepFiles, TourFileError, type TourFlow } from './tour/validate';

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

async function openFlow(host: TourHost, roots: string[], flow: TourFlow | undefined, firstStep: { file: string; line: number } | undefined) {
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
		const file = realInside(roots, at.file);
		if (!file) {
			throw new TourFileError(`${at.file} is not a file inside the workspace.`);
		}
		await showFlowAt(host, file, at.line);
		return;
	}
	if (!host.panel.shown) {
		throw new TourFileError('This tour does not say which flow it is about ("flow"), and no flow is open. Open a flow first, or add a "flow" to the file.');
	}
}

/** The tour files of the workspace (`*.tour.json`) to pick from, and "Browse…" for one anywhere else. */
async function pickTourFile(): Promise<vscode.Uri | undefined> {
	const found = await vscode.workspace.findFiles('**/*.tour.json', '**/{node_modules,.git}/**', 50);
	const browse = { label: '$(folder-opened) Browse…', uri: undefined as vscode.Uri | undefined };
	const items = [...found.map(uri => ({ label: vscode.workspace.asRelativePath(uri, false), uri: uri as vscode.Uri | undefined })).sort((a, b) => a.label.localeCompare(b.label)), browse];
	const pick = found.length ? await vscode.window.showQuickPick(items, { title: 'Axle: play a tour', placeHolder: 'A tour file in this workspace' }) : browse;
	if (pick?.uri) {
		return pick.uri;
	}
	return pick ? (await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Play Tour', title: 'Axle: play a tour file', filters: { 'Axle tour': ['json'] } }))?.[0] : undefined;
}

/** `source`: a file the caller already chose (a Uri or a path); without one the user picks it. */
export async function playTourFile(host: TourHost, source?: unknown): Promise<void> {
	let uri = source instanceof vscode.Uri ? source : typeof source === 'string' && source ? vscode.Uri.file(source) : undefined;
	uri ??= await pickTourFile();
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
	// The methods of the files the steps name, so a step is placed by its method name even when the line moved.
	const methods = new Map<string, readonly Method[] | undefined>();
	await Promise.all(stepFiles(json, roots).map(async f => methods.set(f, realInside(roots, f) ? await methodsOf(host, f).catch(() => undefined) : undefined)));
	const { tour, flow } = parseTourFile(json, { roots, readText: readTextIn(roots), methodsIn: f => methods.get(f) });
	const first = tour.steps.find(s => s.at?.file && s.at.startLine > 0);
	await openFlow(host, roots, flow, first?.at && { file: first.at.file, line: first.at.startLine });
	await host.panel.playTour(tour);
}
