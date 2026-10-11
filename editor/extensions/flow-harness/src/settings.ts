/*---------------------------------------------------------------------------------------------
 *  Axle Harness: every settings change is shown as a diff first and written only after a yes.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const SCHEME = 'flow-harness-preview';
const previews = new Map<string, string>();

export function registerPreviewProvider(): vscode.Disposable {
	return vscode.workspace.registerTextDocumentContentProvider(SCHEME, { provideTextDocumentContent: uri => previews.get(uri.path) ?? '' });
}

/** `before` (a settings file's text, empty when it does not exist yet) with `mutate` applied; undefined, after telling the user why, when that is not possible. */
function apply<T extends object>(file: string, before: string, mutate: (settings: T) => void): string | undefined {
	let data: unknown;
	try {
		data = before.trim() ? JSON.parse(before) : {};
	} catch (e) {
		void vscode.window.showErrorMessage(`${path.basename(file)} is not valid JSON (${(e as Error).message}). Fix it first, then try again.`);
		return undefined;
	}
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		void vscode.window.showErrorMessage(`${path.basename(file)} does not hold a JSON object. Fix it first, then try again.`);
		return undefined;
	}
	try {
		mutate(data as T);
	} catch (e) {
		void vscode.window.showErrorMessage(`${path.basename(file)} has an unexpected shape (${(e as Error).message}). Fix it first, then try again.`);
		return undefined;
	}
	return JSON.stringify(data, null, 2) + '\n';
}

const isMissing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT';

/** The text of `file`, empty when it does not exist yet. Any other failure (permissions, a locked file) must not look like an empty file, or the write would replace it. */
async function load(file: string): Promise<string | undefined> {
	try {
		return await fs.readFile(file, 'utf8');
	} catch (e) {
		if (isMissing(e)) {
			return '';
		}
		void vscode.window.showErrorMessage(`Could not read ${file} (${(e as Error).message}). Nothing was changed.`);
		return undefined;
	}
}

/** `parent[key]` as an object, created when absent; throws, so the user is told, when it holds something else. */
export function objectAt<T extends object>(parent: object, key: string): T {
	const p = parent as Record<string, unknown>;
	if (p[key] === undefined || p[key] === null) {
		p[key] = {};
	}
	const v = p[key];
	if (typeof v !== 'object' || Array.isArray(v)) {
		throw new Error(`"${key}" is not an object`);
	}
	return v as T;
}

/** `parent[key]` as an array, created when absent; throws when it holds something else. */
export function arrayAt<T>(parent: object, key: string): T[] {
	const p = parent as Record<string, unknown>;
	if (p[key] === undefined || p[key] === null) {
		p[key] = [];
	}
	const v = p[key];
	if (!Array.isArray(v)) {
		throw new Error(`"${key}" is not a list`);
	}
	return v as T[];
}

/** Writes through a temp file in the same folder and a rename, so a crash never leaves half a settings file; a symlinked file keeps its link. */
async function writeAtomic(file: string, text: string) {
	const target = await fs.realpath(file).catch(e => { if (isMissing(e)) { return file; } throw e; });
	const mode = await fs.stat(target).then(st => st.mode & 0o777, () => undefined);
	await fs.mkdir(path.dirname(target), { recursive: true });
	const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
	try {
		await fs.writeFile(tmp, text, mode === undefined ? undefined : { mode });
		for (let attempt = 0; ; attempt++) {
			try {
				await fs.rename(tmp, target);
				return;
			} catch (e) {
				// Windows refuses the rename while another process (an agent reading its settings) has the file open.
				const busy = ['EPERM', 'EBUSY', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '');
				if (!busy || attempt >= 4) {
					throw e;
				}
				await new Promise(r => setTimeout(r, 80 * (attempt + 1)));
			}
		}
	} catch (e) {
		await fs.rm(tmp, { force: true }).catch(() => undefined);
		throw e;
	}
}

/** Closes the preview diff, and only that: the user may have switched tabs while the dialog was open. */
async function closeDiff() {
	const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	if (input instanceof vscode.TabInputTextDiff && input.modified.scheme === SCHEME) {
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	}
}

/**
 * Applies `mutate` to the JSON in `file` (an empty object when it does not exist yet), opens a diff of
 * the result, and writes it when the user confirms. Returns whether the file was written.
 */
export async function previewAndWrite<T extends object>(file: string, title: string, mutate: (settings: T) => void): Promise<boolean> {
	const before = await load(file);
	if (before === undefined) {
		return false;
	}
	const after = apply(file, before, mutate);
	if (after === undefined) {
		return false;
	}
	const key = `/${Date.now()}/${path.basename(file)}`;
	previews.set(key, after);
	const left = before ? vscode.Uri.file(file) : vscode.Uri.from({ scheme: SCHEME, path: `${key}.empty` });
	await vscode.commands.executeCommand('vscode.diff', left, vscode.Uri.from({ scheme: SCHEME, path: key }), `${title}: ${vscode.workspace.asRelativePath(file)}`, { preview: true });
	const ok = await vscode.window.showInformationMessage(`${title}?`, { modal: true, detail: `Writes ${file}. The diff is open behind this dialog.` }, 'Write Settings');
	previews.delete(key);
	await closeDiff();
	if (ok !== 'Write Settings') {
		return false;
	}
	// The dialog may have stayed open for minutes: apply the same change to the file as it is now, so an
	// edit made meanwhile (Claude Code adding an "always allow" rule, say) is kept.
	const latest = await load(file);
	if (latest === undefined) {
		return false;
	}
	const final = latest === before ? after : apply(file, latest, mutate);
	if (final === undefined) {
		return false;
	}
	try {
		await writeAtomic(file, final);
	} catch (e) {
		void vscode.window.showErrorMessage(`Could not write ${file} (${(e as Error).message}). Nothing was changed.`);
		return false;
	}
	vscode.window.setStatusBarMessage(`$(check) ${title}: written`, 4000);
	return true;
}
