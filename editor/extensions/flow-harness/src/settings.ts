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

/** Closes the preview diffs this opened, and only those: the user may have switched tabs while the dialog was open. */
async function closeDiffs(keys: Set<string>) {
	const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(tab => tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.scheme === SCHEME && keys.has(tab.input.modified.path));
	if (tabs.length) {
		await vscode.window.tabGroups.close(tabs);
	}
}

/** One file's change: `change` turns its current text (empty when it does not exist) into the new text, or undefined after saying why not. */
export interface FileChange {
	file: string;
	change: (text: string) => string | undefined;
	/**
	 * What the diff shows instead of the whole file: the part the change is about, with secrets hidden. A change to
	 * ~/.claude.json must not put the rest of that file (the sign-in, every project's state) or a typed API key on screen.
	 */
	show?: (before: string, after: string) => { before: string; after: string };
}

/**
 * Opens a diff of every change, and writes them all when the user confirms in one dialog. Returns whether they were
 * written. Each change is applied again to the file as it is when the user says yes, so an edit made while the dialog
 * was open (Claude Code adding an "always allow" rule, say) is kept.
 */
export async function previewAndWriteFiles(title: string, changes: FileChange[], button = 'Write'): Promise<boolean> {
	const planned: { c: FileChange; before: string; after: string; key: string }[] = [];
	for (const c of changes) {
		const before = await load(c.file);
		const after = before === undefined ? undefined : c.change(before);
		if (before === undefined || after === undefined) {
			return false;
		}
		if (after !== before) {
			planned.push({ c, before, after, key: `/${Date.now()}-${planned.length}/${path.basename(c.file)}` });
		}
	}
	if (!planned.length) {
		void vscode.window.showInformationMessage(`${title}: nothing to change, it is there already.`);
		return true;
	}
	for (const p of planned) {
		const shown = p.c.show?.(p.before, p.after);
		previews.set(p.key, shown?.after ?? p.after);
		if (shown) {
			previews.set(`${p.key}.before`, shown.before);
		}
		const left = shown ? vscode.Uri.from({ scheme: SCHEME, path: `${p.key}.before` }) : p.before ? vscode.Uri.file(p.c.file) : vscode.Uri.from({ scheme: SCHEME, path: `${p.key}.empty` });
		await vscode.commands.executeCommand('vscode.diff', left, vscode.Uri.from({ scheme: SCHEME, path: p.key }), `${title}: ${vscode.workspace.asRelativePath(p.c.file)}`, { preview: planned.length === 1 });
	}
	const files = planned.map(p => `${p.before ? 'Changes' : 'Creates'} ${vscode.workspace.asRelativePath(p.c.file)}`).join('\n');
	const ok = await vscode.window.showInformationMessage(`${title}?`, { modal: true, detail: `${files}\n\nThe ${planned.length > 1 ? 'diffs are' : 'diff is'} open behind this dialog.` }, button);
	const keys = new Set(planned.map(p => p.key));
	planned.forEach(p => {
		previews.delete(p.key);
		previews.delete(`${p.key}.before`);
	});
	await closeDiffs(keys);
	if (ok !== button) {
		return false;
	}
	const finals: { file: string; text: string }[] = [];
	for (const p of planned) {
		const latest = await load(p.c.file);
		const final = latest === undefined ? undefined : latest === p.before ? p.after : p.c.change(latest);
		if (final === undefined) {
			return false;
		}
		finals.push({ file: p.c.file, text: final });
	}
	for (const f of finals) {
		try {
			await writeAtomic(f.file, f.text);
		} catch (e) {
			void vscode.window.showErrorMessage(`Could not write ${f.file} (${(e as Error).message}).${finals.length > 1 ? ' The other files may have been written.' : ' Nothing was changed.'}`);
			return false;
		}
	}
	vscode.window.setStatusBarMessage(`$(check) ${title}: written`, 4000);
	return true;
}

/**
 * Applies `mutate` to the JSON in `file` (an empty object when it does not exist yet), opens a diff of
 * the result, and writes it when the user confirms. Returns whether the file was written.
 */
export function previewAndWrite<T extends object>(file: string, title: string, mutate: (settings: T) => void): Promise<boolean> {
	return previewAndWriteFiles(title, [{ file, change: text => apply(file, text, mutate) }], 'Write Settings');
}

/** A JSON settings change for previewAndWriteFiles. */
export const jsonChange = <T extends object>(file: string, mutate: (settings: T) => void): FileChange => ({ file, change: text => apply(file, text, mutate) });
