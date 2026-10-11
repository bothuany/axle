/*---------------------------------------------------------------------------------------------
 *  Axle: the card being edited, shown to the language servers. They only know the real document, so
 *  while a card is edited in the canvas its current text is put into the document (never on disk by
 *  us), on exactly the card's lines. Cancelling puts the original text back; saving makes it final.
 *
 *  One card is edited at a time, and everything here runs one operation after another (`run`), so
 *  a completion can never see a half-applied edit, and a late request never re-opens a closed card.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { endLineOf, locateOnce, normalize, planSync, type DocRange } from './cardmap';

/** What the canvas says about the card it is editing. */
export interface CardText {
	/** One id per opening of an editor on a card: requests of an editor that was closed are ignored. */
	session: string;
	file: string;
	/** The card as it was drawn: its first line in the file, and the text of its lines. */
	startLine: number;
	endLine: number;
	original: string;
	/** What the editor holds now. */
	text: string;
}

interface Overlay {
	session: string;
	uri: vscode.Uri;
	startLine: number;
	original: string;
	/** The card's last line in the file now, and the text the document holds there. */
	curEnd: number;
	lastText: string;
	/** Did we ever change the document? */
	touched: boolean;
	/** Was the document already modified (the user's own unsaved edits) before the first overlay? */
	wasDirty: boolean;
	/** The document's version after our last edit: another version means someone else changed it since. */
	version: number;
}

export type Synced = { ok: true; overlay: Readonly<Pick<Overlay, 'uri' | 'startLine' | 'curEnd'>> } | { ok: false; message?: string };

const eolOf = (doc: vscode.TextDocument) => doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';

/** The document's lines `from`..`to` (1-based, inclusive) as a range, or none if the file has fewer lines. */
function linesRange(doc: vscode.TextDocument, from: number, to: number): vscode.Range | undefined {
	return from >= 1 && to >= from && to <= doc.lineCount ? new vscode.Range(from - 1, 0, to - 1, doc.lineAt(to - 1).text.length) : undefined;
}

const toRange = (r: DocRange) => new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character);

/** Does saving this document do more than write it (format, fix-ups, trimming)? Then a cancelled card must not save it just to look unmodified. */
function savesChangeText(doc: vscode.TextDocument) {
	const editor = vscode.workspace.getConfiguration('editor', doc.uri);
	const files = vscode.workspace.getConfiguration('files', doc.uri);
	const actions = editor.get<Record<string, string | boolean>>('codeActionsOnSave') ?? {};
	return !!editor.get('formatOnSave') || Object.values(actions).some(v => v === true || v === 'explicit' || v === 'always') || !!files.get('trimTrailingWhitespace') || !!files.get('insertFinalNewline') || !!files.get('trimFinalNewlines');
}

const CHANGED = 'This method changed in the editor since the card was opened. Completion is paused; save or discard the card first.';

export class CardOverlays implements vscode.Disposable {
	private active: Overlay | undefined;
	private chain: Promise<unknown> = Promise.resolve();
	/** Sessions that were closed or saved: a request still on its way for one of them is dropped. */
	private readonly ended: string[] = [];

	/** Runs `job` after everything before it has finished. A failing job does not stop the ones after it. */
	run<T>(job: () => Promise<T>): Promise<T> {
		const next = this.chain.then(job, job);
		this.chain = next.catch(() => undefined);
		return next;
	}

	private isEnded(session: string) {
		return this.ended.includes(session);
	}

	private end(session: string) {
		this.ended.push(session);
		this.ended.splice(0, Math.max(0, this.ended.length - 200));
	}

	/** The file whose document currently holds a card's unsaved text. Call inside `run`. */
	activeUri(): vscode.Uri | undefined {
		return this.active?.uri;
	}

	/** The overlay of this editor, when it has one: the document's text now is the card's. Call inside `run`. */
	current(session: string) {
		return this.active?.session === session ? this.active : undefined;
	}

	/**
	 * Make the document hold the card's current text on the card's lines. Refuses (and changes nothing) when the
	 * document's text on those lines is not what we put there, or on the first sync not the card's original text.
	 * Call inside `run`.
	 */
	async sync(s: CardText): Promise<Synced> {
		if (this.isEnded(s.session)) {
			return { ok: false };
		}
		if (this.active && this.active.session !== s.session) {
			await this.restore(this.active);
		}
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(s.file));
		let ov = this.active;
		if (!ov) {
			// With a delay-based auto save the card's half-typed text would be written to the file within a second.
			if (vscode.workspace.getConfiguration('files', doc.uri).get<string>('autoSave') === 'afterDelay') {
				return { ok: false, message: 'Completion in cards needs Auto Save off (or on focus change): the card text would be saved as you type.' };
			}
			const range = linesRange(doc, s.startLine, s.endLine);
			if (planSync({ expected: s.original, docText: range && doc.getText(range), last: s.original, next: s.original }) === 'conflict') {
				return { ok: false, message: CHANGED };
			}
			ov = this.active = { session: s.session, uri: doc.uri, startLine: s.startLine, original: normalize(s.original), curEnd: s.endLine, lastText: normalize(s.original), touched: false, wasDirty: doc.isDirty, version: doc.version };
		} else if (ov.startLine !== s.startLine || ov.original !== normalize(s.original)) {
			return { ok: false, message: CHANGED };
		}
		const range = linesRange(doc, ov.startLine, ov.curEnd);
		const plan = planSync({ expected: ov.lastText, docText: range && doc.getText(range), last: ov.lastText, next: s.text });
		if (plan === 'conflict') {
			return { ok: false, message: CHANGED };
		}
		if (plan === 'apply') {
			const edit = new vscode.WorkspaceEdit();
			edit.replace(doc.uri, range!, normalize(s.text).replace(/\n/g, eolOf(doc)));
			if (!await vscode.workspace.applyEdit(edit)) {
				return { ok: false, message: 'Could not show the card to the language server.' };
			}
			ov.touched = true;
			ov.lastText = normalize(s.text);
			ov.curEnd = endLineOf(ov.startLine, s.text);
			ov.version = doc.version;
		}
		return { ok: true, overlay: ov };
	}

	/**
	 * Save: the card's text becomes the document's on the card's lines. Resolves `undefined` when this editor has no overlay
	 * (the caller then saves the plain way). Call inside `run`.
	 */
	async commit(session: string, code: string): Promise<{ ok: boolean; message?: string } | undefined> {
		const ov = this.current(session);
		if (!ov) {
			return undefined;
		}
		const doc = await vscode.workspace.openTextDocument(ov.uri);
		const range = linesRange(doc, ov.startLine, ov.curEnd);
		if (planSync({ expected: ov.lastText, docText: range && doc.getText(range), last: ov.lastText, next: code }) === 'conflict') {
			return { ok: false, message: CHANGED };
		}
		const edit = new vscode.WorkspaceEdit();
		edit.replace(doc.uri, range!, normalize(code).replace(/\n/g, eolOf(doc)));
		if (!await vscode.workspace.applyEdit(edit)) {
			return { ok: false, message: 'Could not apply the edit.' };
		}
		await doc.save();
		this.active = undefined;
		this.end(session);
		return { ok: true };
	}

	/** The editor was closed (cancel, target change, save done): the document gets its original text back. Call inside `run`. */
	async close(session: string) {
		this.end(session);
		if (this.active?.session === session) {
			await this.restore(this.active);
		}
	}

	private async restore(ov: Overlay) {
		this.active = undefined;
		this.end(ov.session);
		if (!ov.touched) {
			return;
		}
		try {
			const doc = await vscode.workspace.openTextDocument(ov.uri);
			const ours = doc.version === ov.version;
			let range = linesRange(doc, ov.startLine, ov.curEnd);
			if (!range || normalize(doc.getText(range)) !== ov.lastText) {
				// Someone edited around the card (lines moved): find the card's text again, but only where it is unambiguous.
				const found = locateOnce(doc.getText(), ov.lastText);
				range = found && toRange(found);
			}
			if (!range) {
				void vscode.window.showWarningMessage(`Axle could not restore ${vscode.workspace.asRelativePath(ov.uri)} after editing a card; the editor may hold the card's unsaved text. Undo (Ctrl+Z) in that file to go back.`);
				return;
			}
			const edit = new vscode.WorkspaceEdit();
			edit.replace(doc.uri, range, ov.original.replace(/\n/g, eolOf(doc)));
			if (!await vscode.workspace.applyEdit(edit)) {
				return;
			}
			// The text is the saved text again but the editor still counts it as modified: a document that was clean
			// and that nobody else touched meanwhile is clean again.
			if (ours && !ov.wasDirty && doc.isDirty && !await this.revert(doc) && !savesChangeText(doc)) {
				await doc.save();
			}
		} catch (e) {
			void vscode.window.showWarningMessage(`Axle could not restore the file after editing a card: ${(e as Error).message ?? e}`);
		}
	}

	/**
	 * The document holds the saved text again but the editor counts it as modified: read it from disk instead of writing it back,
	 * which runs no save participants (format on save, fix-ups) and does not touch the file. Whether it worked.
	 */
	private async revert(doc: vscode.TextDocument): Promise<boolean> {
		try {
			await vscode.commands.executeCommand('workbench.action.files.revert', doc.uri);
		} catch {
			return false;
		}
		return !doc.isDirty;
	}

	/** The canvas went away: every card goes back to the file. */
	async closeAll() {
		await this.run(async () => {
			if (this.active) {
				await this.restore(this.active);
			}
		});
	}

	dispose() {
		void this.closeAll();
	}
}
