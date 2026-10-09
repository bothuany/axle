/*---------------------------------------------------------------------------------------------
 *  Flow Harness: every settings change is shown as a diff first and written only after a yes.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const SCHEME = 'flow-harness-preview';
const previews = new Map<string, string>();

export function registerPreviewProvider(): vscode.Disposable {
	return vscode.workspace.registerTextDocumentContentProvider(SCHEME, { provideTextDocumentContent: uri => previews.get(uri.path) ?? '' });
}

/**
 * Applies `mutate` to the JSON in `file` (an empty object when it does not exist yet), opens a diff of
 * the result, and writes it when the user confirms. Returns whether the file was written.
 */
export async function previewAndWrite<T extends object>(file: string, title: string, mutate: (settings: T) => void): Promise<boolean> {
	const before = await fs.readFile(file, 'utf8').catch(() => '');
	let data: T;
	try {
		data = (before.trim() ? JSON.parse(before) : {}) as T;
	} catch (e) {
		vscode.window.showErrorMessage(`${path.basename(file)} is not valid JSON (${(e as Error).message}). Fix it first, then try again.`);
		return false;
	}
	mutate(data);
	const after = JSON.stringify(data, null, 2) + '\n';
	const key = `/${Date.now()}/${path.basename(file)}`;
	previews.set(key, after);
	const left = before ? vscode.Uri.file(file) : vscode.Uri.from({ scheme: SCHEME, path: `${key}.empty` });
	await vscode.commands.executeCommand('vscode.diff', left, vscode.Uri.from({ scheme: SCHEME, path: key }), `${title}: ${vscode.workspace.asRelativePath(file)}`, { preview: true });
	const ok = await vscode.window.showInformationMessage(`${title}?`, { modal: true, detail: `Writes ${file}. The diff is open behind this dialog.` }, 'Write Settings');
	previews.delete(key);
	await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	if (ok !== 'Write Settings') {
		return false;
	}
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, after);
	vscode.window.setStatusBarMessage(`$(check) ${title}: written`, 4000);
	return true;
}
