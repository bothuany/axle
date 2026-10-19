/*---------------------------------------------------------------------------------------------
 *  Axle: the methods of a file as the flow canvas knows them, for placing the steps of a tour by name.
 *---------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { Analyzer } from './analyzer';
import { POLY_LANGUAGES, type PolyIndex } from './poly/client';
import type { Method } from './tour/resolve';

/** The methods of a file, as the flow canvas knows them (the code index, the C# analyzer, else a language server); nothing when none can say. */
export async function methodsOf(d: { poly: PolyIndex; analyzer: Analyzer }, file: string): Promise<Method[] | undefined> {
	const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
	const plain = (list: { name: string; startLine: number; endLine: number }[]) => list.map(m => ({ name: m.name, startLine: m.startLine, endLine: m.endLine }));
	if (POLY_LANGUAGES.has(doc.languageId)) {
		return d.poly.isReady ? plain(await d.poly.methods(file)) : undefined;
	}
	if (doc.languageId === 'csharp' && d.analyzer.isReady) {
		return plain(await d.analyzer.methods(file));
	}
	const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', doc.uri) ?? [];
	const out: Method[] = [];
	const walk = (list: vscode.DocumentSymbol[], owner: string) => list.forEach(s => {
		if (s.kind === vscode.SymbolKind.Method || s.kind === vscode.SymbolKind.Function || s.kind === vscode.SymbolKind.Constructor) {
			out.push({ name: owner ? `${owner}.${s.name}` : s.name, startLine: s.range.start.line + 1, endLine: s.range.end.line + 1 });
		}
		walk(s.children ?? [], s.kind === vscode.SymbolKind.Class || s.kind === vscode.SymbolKind.Interface || s.kind === vscode.SymbolKind.Struct ? s.name : owner);
	});
	walk(symbols, '');
	return out.length ? out : undefined;
}
