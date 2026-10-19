/*---------------------------------------------------------------------------------------------
 *  Axle skeleton first, in the window: the switch (`axle.skeletonFirst.enabled`), each agent session's stage, the plan board
 *  recoloured from the type index after every save, and the warnings when an agent changes a declaration the developer wrote.
 *  The dock (flow-agent) shows a row per session and sends the developer's clicks back through the `flow.skeleton.*` commands;
 *  it is told what to show through `flow.agents.skeleton`. See docs/design/skeleton-first.md.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import type { BoardSpec } from './board/spec';
import type { BoardStore } from './board/store';
import { goneIn, headersOf, locate, revertRange, stillThere, type Header } from './skeleton/guard';
import { decorate, matchPlan } from './skeleton/match';
import { newSession, toolAnswer, viewOf, type SkeletonSession, type SkeletonTools } from './skeleton/sessions';
import type { TypeService } from './types/typeService';

/** Declared by flow-agent (its dock holds the switch); without flow-agent it reads as its default, off. */
const SETTING = 'axle.skeletonFirst';
/** Agent sessions with a stage at once: more is a caller making up ids. */
const MAX_SESSIONS = 20;
const RECOMPUTE_MS = 250;
/** The files the code index reads: a save of anything else changes no type. */
const CODE_FILE = /\.(cs|ts|tsx|js|jsx|mjs|cjs|java|kt|py|go|rs|php|rb)$/i;

/** Paths compared the way Windows and VS Code spell them differently (drive letter case, slashes). */
const same = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
const fileKey = (f: string) => f.replace(/\\/g, '/').toLowerCase();

export const skeletonEnabled = () => vscode.workspace.getConfiguration(SETTING).get<boolean>('enabled', false) === true;

export class SkeletonHost implements SkeletonTools, vscode.Disposable {
	private readonly sessions = new Map<string, SkeletonSession>();
	private readonly timers = new Map<string, NodeJS.Timeout>();
	private warningSeq = 0;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly boards: BoardStore, private readonly types: TypeService, private readonly log: vscode.LogOutputChannel) {
		boards.setDecorator((id, spec) => {
			const s = this.byBoard(id);
			return s && s.stage !== 'design' && s.diff ? decorate(spec, s.diff, s.warnings.map(w => ({ owner: w.owner, name: w.name, text: `${w.reason === 'removed' ? 'Removed' : w.reason === 'renamed' ? 'Renamed' : 'Changed'} by the agent: ${w.after ? w.after.trim() : '(gone)'}\nYou wrote: ${w.before.trim()}` }))) : spec;
		});
		this.disposables.push(
			{ dispose: () => boards.setDecorator(undefined) },
			// A redraw of the design ("make X an interface") is the new plan: the colours follow it at once.
			boards.onDidChange(e => {
				const s = e.type === 'set' ? this.byBoard(e.id) : undefined;
				const board = s && this.boards.get(e.id);
				if (s && board && (board.spec.kind === 'class' || board.spec.kind === 'er')) {
					s.plan = board.spec;
					this.changed(s);
				}
			}),
			vscode.workspace.onDidSaveTextDocument(d => void this.saved(d)),
			types.onDidChange(() => [...this.sessions.values()].forEach(s => s.stage !== 'design' && this.changed(s))),
			vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration(SETTING) && !skeletonEnabled() && this.clearAll()),
			vscode.commands.registerCommand('flow.skeleton.choose', (session: unknown, choice: unknown) => this.choose(session, choice)),
			vscode.commands.registerCommand('flow.skeleton.handover', (session: unknown) => this.handover(session)),
			vscode.commands.registerCommand('flow.skeleton.finish', (session: unknown) => this.finish(session)),
			vscode.commands.registerCommand('flow.skeleton.open', (session: unknown) => this.open(session)),
			vscode.commands.registerCommand('flow.skeleton.warning', (session: unknown, index: unknown, action: unknown) => this.warning(session, index, action)),
		);
	}

	private byBoard(id: string) {
		return [...this.sessions.values()].find(s => s.boardId === id);
	}

	private get(session: unknown) {
		return typeof session === 'string' ? this.sessions.get(session) : undefined;
	}

	// ── MCP ─────────────────────────────────────────────────────────────────

	async check(session: string | undefined): Promise<string> {
		if (!skeletonEnabled()) {
			return toolAnswer(false, undefined);
		}
		// Only a session the dock knows gets a row: an id the bridge was handed but the dock never started counts as no session.
		const id = session && await this.known(session) ? session : '';
		let s = this.sessions.get(id);
		if (!s) {
			if (this.sessions.size >= MAX_SESSIONS) {
				return 'Skeleton first: too many agent sessions are in the middle of it in this window. Implement the plan as usual.';
			}
			s = newSession(id);
			this.sessions.set(id, s);
			this.push(s);
		}
		if (s.stage !== 'design') {
			await this.recompute(s);
		}
		return toolAnswer(true, s, f => vscode.workspace.asRelativePath(f, false));
	}

	private async known(session: string): Promise<boolean> {
		const look = await Promise.resolve(vscode.commands.executeCommand<unknown>('flow.agent.describe', session)).catch(() => undefined);
		return !!look;
	}

	/** draw_board ran: a class or ER board drawn by a session waiting for its design becomes that design, whatever id it used. */
	drawn(id: string, spec: BoardSpec, session: string | undefined) {
		const s = this.sessions.get(session ?? '');
		if (!s || s.stage !== 'design' || (spec.kind !== 'class' && spec.kind !== 'er') || (s.plan && id !== s.boardId)) {
			return;
		}
		s.boardId = id;
		s.plan = this.boards.get(id)?.spec ?? spec;
		this.push(s);
	}

	// ── the developer's clicks (from the dock) ──────────────────────────────

	private async choose(session: unknown, choice: unknown) {
		const s = this.get(session);
		if (!s) {
			return false;
		}
		if (choice === 'just') {
			this.drop(s);
			return true;
		}
		if (choice !== 'skeleton' || !s.plan) {
			return false;
		}
		s.stage = 'skeleton';
		this.push(s);
		await this.recompute(s);
		return true;
	}

	/** Keeps the developer's declarations as they are now, then the agent may fill the bodies. */
	private async handover(session: unknown): Promise<boolean> {
		const s = this.get(session);
		if (!s || s.stage !== 'skeleton') {
			return false;
		}
		await this.recompute(s);
		const graph = await this.types.getGraph();
		const texts = new Map<string, string>();
		for (const r of s.diff?.nodes ?? []) {
			if (r.file && !texts.has(r.file)) {
				const text = await this.read(r.file);
				if (text !== undefined) {
					texts.set(r.file, text);
				}
			}
		}
		s.headers = s.diff ? headersOf(s.diff, graph.types, f => texts.get(f)) : [];
		s.warnings = [];
		s.stage = 'handover';
		this.log.info(`skeleton: handed over ${s.headers.length} declarations of "${s.plan?.title}"`);
		this.push(s);
		await this.boards.redraw(s.boardId);
		return true;
	}

	private finish(session: unknown) {
		const s = this.get(session);
		if (s) {
			this.drop(s);
		}
	}

	private async open(session: unknown) {
		const s = this.get(session);
		const board = s && this.boards.get(s.boardId);
		if (board) {
			await this.boards.set(board.spec, { id: board.id, origin: board.origin, session: board.session });
		}
	}

	private async warning(session: unknown, warningId: unknown, action: unknown) {
		const s = this.get(session);
		const index = s && typeof warningId === 'number' ? s.warnings.findIndex(x => x.id === warningId) : -1;
		const w = s && index >= 0 ? s.warnings[index] : undefined;
		if (!s || !w) {
			return;
		}
		const keptIndex = s.headers.findIndex(h => h.owner === w.owner && h.name === w.name && h.kind === w.kind && same(h.file, w.file));
		if (action === 'open') {
			const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(w.file));
			const at = new vscode.Position(Math.max(0, (w.line ?? 1) - 1), 0);
			await vscode.window.showTextDocument(doc, { selection: new vscode.Range(at, at), preview: true });
			return;
		}
		if (action === 'accept') {
			// The agent's version becomes the developer's: later edits are measured against it.
			if (keptIndex >= 0) {
				if (w.after !== undefined && w.line) {
					s.headers[keptIndex] = { ...s.headers[keptIndex], text: w.after, line: w.line };
				} else {
					s.headers.splice(keptIndex, 1);
				}
			}
		} else if (action === 'revert') {
			const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(w.file));
			if (doc.isDirty) {
				// Saving after the revert would also save the developer's unsaved work in that file.
				void vscode.window.showWarningMessage(`Axle: ${vscode.workspace.asRelativePath(doc.uri)} has unsaved changes: save or undo them, then Revert.`);
				return;
			}
			const range = revertRange(doc.getText(), w);
			if (!range) {
				void vscode.window.showWarningMessage('Axle: that declaration changed again since the warning; revert it by hand.');
				return;
			}
			const edit = new vscode.WorkspaceEdit();
			edit.replace(doc.uri, new vscode.Range(range.startLine - 1, 0, range.endLine - 1, doc.lineAt(range.endLine - 1).text.length), range.text);
			if (!await vscode.workspace.applyEdit(edit)) {
				return;
			}
			await doc.save();
		} else {
			return;
		}
		s.warnings.splice(index, 1);
		this.push(s);
		await this.recompute(s);
	}

	// ── edits ───────────────────────────────────────────────────────────────

	/** The developer saved: the board recolours, and in the hand-over their own changes to their declarations are kept as theirs. */
	private async saved(doc: vscode.TextDocument) {
		const file = doc.uri.fsPath;
		const active = [...this.sessions.values()].filter(s => s.stage !== 'design');
		if (doc.uri.scheme !== 'file' || !CODE_FILE.test(file) || !active.length) {
			return;
		}
		active.forEach(s => s.recent.add(fileKey(file)));
		await this.types.refreshFiles([file]);
		const text = doc.getText();
		for (const s of active.filter(x => x.stage === 'handover')) {
			const warned = (h: Header) => s.warnings.some(w => w.owner === h.owner && w.name === h.name && same(w.file, h.file));
			const mine = goneIn(s.headers, file, text, same).filter(h => !warned(h));
			if (mine.length) {
				const graph = await this.types.getGraph();
				for (const h of mine) {
					const now = locate(h, graph.types, text, s.headers);
					const i = s.headers.indexOf(h);
					if (now.after !== undefined && now.line) {
						s.headers[i] = { ...h, text: now.after, line: now.line };
					} else {
						s.headers.splice(i, 1);
					}
				}
			}
		}
		active.forEach(s => this.changed(s));
	}

	/** flow-agent saw an agent edit files (`phase` after the tool ran): in the hand-over, a declaration of the developer's that is gone is a warning. */
	async agentEdited(session: string, files: string[], phase: 'before' | 'after') {
		const s = this.sessions.get(session);
		if (!s || phase !== 'after' || s.stage === 'design') {
			return;
		}
		// The paths come from the agent's hook: only code files inside an open workspace folder are read or indexed.
		const code = files.filter(f => CODE_FILE.test(f) && !!vscode.workspace.getWorkspaceFolder(vscode.Uri.file(f)));
		if (!code.length) {
			return;
		}
		await this.types.refreshFiles(code);
		if (s.stage === 'handover' && s.headers.length) {
			const graph = await this.types.getGraph();
			for (const file of code) {
				const text = await this.read(file);
				if (text === undefined) {
					continue;
				}
				for (const h of goneIn(s.headers, file, text, same)) {
					if (!s.warnings.some(w => w.owner === h.owner && w.name === h.name && w.kind === h.kind && same(w.file, h.file))) {
						s.warnings.push({ ...locate(h, graph.types, text, s.headers), id: ++this.warningSeq });
					}
				}
			}
			// A warning whose header came back (the agent undid it) is over.
			for (let i = s.warnings.length - 1; i >= 0; i--) {
				const w = s.warnings[i];
				const text = code.some(f => same(f, w.file)) ? await this.read(w.file) : undefined;
				if (text !== undefined && stillThere(text, { owner: w.owner, name: w.name, kind: w.kind, file: w.file, line: 0, text: w.before })) {
					s.warnings.splice(i, 1);
				}
			}
		}
		this.changed(s);
	}

	// ── recompute and show ──────────────────────────────────────────────────

	private changed(s: SkeletonSession) {
		this.push(s);
		if (s.stage === 'design') {
			return;
		}
		clearTimeout(this.timers.get(s.session));
		this.timers.set(s.session, setTimeout(() => void this.recompute(s).catch(e => this.log.warn(`skeleton: ${(e as Error).message}`)), RECOMPUTE_MS));
	}

	private async recompute(s: SkeletonSession) {
		if (!s.plan || this.sessions.get(s.session) !== s) {
			return;
		}
		const graph = await this.types.getGraph();
		s.diff = matchPlan(s.plan, graph, { recent: f => s.recent.has(fileKey(f)), ready: this.types.complete });
		this.push(s);
		await this.boards.redraw(s.boardId);
	}

	private async read(file: string): Promise<string | undefined> {
		const open = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && same(d.uri.fsPath, file));
		return open ? open.getText() : fs.readFile(file, 'utf8').catch(() => undefined);
	}

	/** Tells the dock what to show on the session's row (nothing for an agent Axle did not start: it has no row). */
	private push(s: SkeletonSession | { session: string }, gone = false) {
		if (!s.session) {
			return;
		}
		// Without flow-agent there is no dock to tell (and the switch reads as off): only a failure of a dock that is there is worth a line.
		void Promise.resolve(vscode.commands.executeCommand('flow.agents.skeleton', s.session, gone ? undefined : viewOf(s as SkeletonSession))).catch(e => this.log.debug(`skeleton: the dock was not told (${(e as Error).message})`));
	}

	private drop(s: SkeletonSession) {
		clearTimeout(this.timers.get(s.session));
		this.sessions.delete(s.session);
		this.push(s, true);
		void this.boards.redraw(s.boardId);
	}

	/** The switch was turned off: every stage ends now, the colours go, the rows clear. */
	private clearAll() {
		[...this.sessions.values()].forEach(s => this.drop(s));
	}

	dispose() {
		this.timers.forEach(t => clearTimeout(t));
		this.disposables.forEach(d => d.dispose());
	}
}
