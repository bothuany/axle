/*---------------------------------------------------------------------------------------------
 *  Axle Harness: changes to instruction files go through the refactor preview. The edit is
 *  marked as needing confirmation, so the person sees it and accepts or discards it; nothing is
 *  written on their behalf.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/** Adds `line` at the end of `root/target` (creating the file with a heading when it is not there), as a reviewed edit. Resolves to whether it was applied. */
export async function appendLineReviewed(root: string, target: string, line: string, label: string, description: string): Promise<boolean> {
	const uri = vscode.Uri.file(path.join(root, target));
	const edit = new vscode.WorkspaceEdit();
	const meta = { needsConfirmation: true, label, description };
	const existing = await fs.readFile(uri.fsPath, 'utf8').catch(() => undefined);
	if (existing === undefined) {
		edit.createFile(uri, { ignoreIfExists: true, contents: new TextEncoder().encode(`# Project instructions\n\n${line}\n`) }, meta);
	} else {
		const doc = await vscode.workspace.openTextDocument(uri);
		const end = doc.lineAt(doc.lineCount - 1).range.end;
		edit.insert(uri, end, `${existing.endsWith('\n') || !existing ? '' : '\n'}${line}\n`, meta);
	}
	return vscode.workspace.applyEdit(edit, { isRefactoring: true });
}
