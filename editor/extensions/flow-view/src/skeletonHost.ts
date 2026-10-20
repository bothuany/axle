/*---------------------------------------------------------------------------------------------
 *  Axle skeleton first, in the window: each agent session's stage, the plan board recoloured from the type index after every
 *  save, and the warnings when an agent changes a declaration the developer wrote. The developer drives it by talking to the agent
 *  ("I'll write it", "check", "hand over", "just do it"); the agent moves the stage with `check_skeleton` steps. Whether it is on
 *  is the agent's switch in the dock (`flow.agents.skeletonOn`). Revert is the developer's own command, never the agent's tool.
 *  See docs/design/skeleton-first.md.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import type { BoardSpec } from './board/spec';
import type { BoardStore } from './board/store';
import { goneIn, headersOf, locate, revertRange, stillThere, warningText, type Header, type Warning } from './skeleton/guard';
import { decorate, matchPlan } from './skeleton/match';
import { newSession, toolAnswer, type SkeletonSession, type SkeletonStep, type SkeletonTools } from './skeleton/sessions';
import type { TypeService } from './types/typeService';

/** Declared by flow-agent (the starting value of each agent's switch); without flow-agent it reads as its default, off. */
const SETTING = 'axle.skeletonFirst';
/** Agent sessions with a stage at once: more is a caller making up ids. */
const MAX_SESSIONS = 20;
const RECOMPUTE_MS = 250;
/** The files the code index reads: a save of anything else changes no type. */
const CODE_FILE = /\.(cs|ts|tsx|js|jsx|mjs|cjs|java|kt|py|go|rs|php|rb)$/i;

/** Paths compared the way Windows and VS Code spell them differently (drive letter case, slashes). */
const same = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
const fileKey = (f: string) => f.replace(/\\/g, '/').toLowerCase();

/** The default for an agent nobody switched, and the answer for an agent Axle did not start (it has no switch in the dock). */
export const skeletonDefault = () => vscode.workspace.getConfiguration(SETTING).get<boolean>('enabled', false) === true;

export class SkeletonHost implements SkeletonTools, vscode.Disposable {
	private readonly sessions = new Map<string, SkeletonSession>();
	private readonly timers = new Map<string, NodeJS.Timeout>();
	private warningSeq = 0;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly boards: BoardStore, private readonly types: TypeService, private readonly log: vscode.LogOutputChannel) {
		boards.setDecorator((id, spec) => {
			const s = this.byBoard(id);
			return s && s.stage !== 'design' && s.diff ? decorate(spec, s.diff, [
				...s.warnings.map(w => ({ owner: w.owner, name: w.name, text: `${warningText(w)}\nTo put yours back: ask the agent, or run "Axle: Revert an Agent's Change to Your Declaration".` })),
				// A keep the agent passed on stays visible: the developer can see what was kept, not only what is still open.
				...s.accepted.map(w => ({ owner: w.owner, name: w.name, text: `Kept (the agent was told to keep it): ${warningText(w)}` })),
			]) : spec;
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
			// flow-agent: the agent's switch went off, so its change leaves skeleton first.
			vscode.commands.registerCommand('flow.skeleton.finish', (session: unknown) => {
				const s = typeof session === 'string' ? this.sessions.get(session) : undefined;
				if (s) {
					this.drop(s);
				}
			}),
			vscode.commands.registerCommand('flow.skeleton.revert', () => this.revertPicked()),
		);
	}

	private byBoard(id: string) {
		return [...this.sessions.values()].find(s => s.boardId === id);
	}

	// ── MCP ─────────────────────────────────────────────────────────────────

	async check(session: string | undefined, step?: SkeletonStep, warning?: number): Promise<string> {
		// Skeleton first is on or off per agent, in the dock. Only a session the dock knows is that agent: an id the bridge was handed but
		// the dock never started counts as no session, and follows the setting's default.
		const on = session ? await this.switchOf(session) : undefined;
		const id = on === undefined ? '' : session!;
		const rel = (f: string) => vscode.workspace.asRelativePath(f, false);
		if (!(on ?? skeletonDefault())) {
			const old = this.sessions.get(id);
			if (old) {
				this.drop(old);
			}
			return toolAnswer(false, undefined);
		}
		if (step && !id) {
			// An agent Axle did not start has no switch and no row of its own: it may check, but not move a stage that others share.
			return 'Skeleton first steps are only for agents started from the Axle Agents dock: do what the developer asks as usual.';
		}
		if (step) {
			this.log.info(`skeleton: agent ${id} asked for step ${step}${warning ? ` (warning ${warning})` : ''}`);
		}
		let s = this.sessions.get(id);
		if (step === 'just' || step === 'finish') {
			if (s) {
				this.drop(s);
			}
			return step === 'just'
				? 'Skeleton first is skipped for this change: implement the approved plan now, as usual.'
				: 'Skeleton first is finished for this change: the board keeps the design without colours.';
		}
		if (!s) {
			if (this.sessions.size >= MAX_SESSIONS) {
				return 'Skeleton first: too many agent sessions are in the middle of it in this window. Implement the plan as usual.';
			}
			s = newSession(id);
			this.sessions.set(id, s);
		}
		if (step === 'handover') {
			if (s.stage !== 'skeleton') {
				return s.stage === 'handover' ? toolAnswer(true, s, rel) : 'There is no skeleton to hand over yet: draw the design first (call check_skeleton without a step).';
			}
			await this.handover(s);
		} else if (step === 'accept') {
			const w = s.warnings.find(x => x.id === warning);
			if (!w) {
				return `No warning ${warning ?? ''} in this change. ${toolAnswer(true, s, rel)}`;
			}
			this.accept(s, w);
		}
		if (s.stage !== 'design') {
			await this.recompute(s);
		}
		return toolAnswer(true, s, rel);
	}

	/** The agent's switch in the dock; nothing when the dock does not know the session. */
	private async switchOf(session: string): Promise<boolean | undefined> {
		const on = await Promise.resolve(vscode.commands.executeCommand<unknown>('flow.agents.skeletonOn', session)).catch(() => undefined);
		return typeof on === 'boolean' ? on : undefined;
	}

	/**
	 * draw_board ran: a class or ER board drawn by a session waiting for its design becomes that design, whatever id it used, and the
	 * board starts comparing it with the code at once (everything missing until the developer writes it).
	 */
	drawn(id: string, spec: BoardSpec, session: string | undefined) {
		const s = this.sessions.get(session ?? '');
		if (!s || s.stage !== 'design' || (spec.kind !== 'class' && spec.kind !== 'er')) {
			return;
		}
		s.boardId = id;
		s.plan = this.boards.get(id)?.spec ?? spec;
		s.stage = 'skeleton';
		this.changed(s);
	}

	/** Keeps the developer's declarations as they are now, then the agent may fill the bodies. */
	private async handover(s: SkeletonSession) {
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
	}

	/** The developer keeps the agent's version: later edits are measured against it. */
	private accept(s: SkeletonSession, w: Warning) {
		const kept = s.headers.findIndex(h => h.owner === w.owner && h.name === w.name && h.kind === w.kind && same(h.file, w.file));
		if (kept >= 0) {
			if (w.after !== undefined && w.line) {
				s.headers[kept] = { ...s.headers[kept], text: w.after, line: w.line };
			} else {
				s.headers.splice(kept, 1);
			}
		}
		s.warnings = s.warnings.filter(x => x !== w);
		s.accepted.push(w);
	}

	/** "Axle: Revert an Agent's Change to Your Declaration": the developer picks a warning and their declaration goes back; the body stays. */
	private async revertPicked() {
		const all = [...this.sessions.values()].flatMap(s => s.warnings.filter(w => w.reason !== 'removed' && w.after !== undefined).map(w => ({ s, w })));
		if (!all.length) {
			void vscode.window.showInformationMessage('Axle: no declaration of yours was changed by an agent.');
			return;
		}
		const pick = await vscode.window.showQuickPick(all.map(x => ({ label: x.w.name ? `${x.w.owner}.${x.w.name}` : x.w.owner, detail: warningText(x.w), description: vscode.workspace.asRelativePath(x.w.file), x })), { title: 'Revert an agent\'s change to your declaration', placeHolder: 'The declaration goes back to what you wrote; the body the agent filled stays' });
		if (!pick) {
			return;
		}
		const { s, w } = pick.x;
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(w.file));
		if (doc.isDirty) {
			// Saving after the revert would also save the developer's unsaved work in that file.
			void vscode.window.showWarningMessage(`Axle: ${vscode.workspace.asRelativePath(doc.uri)} has unsaved changes: save or undo them, then revert.`);
			return;
		}
		const range = revertRange(doc.getText(), w);
		if (!range) {
			void vscode.window.showWarningMessage('Axle: that declaration changed again since the warning; revert it by hand.');
			return;
		}
		const edit = new vscode.WorkspaceEdit();
		edit.replace(doc.uri, new vscode.Range(range.startLine - 1, 0, range.endLine - 1, doc.lineAt(range.endLine - 1).text.length), range.text);
		if (await vscode.workspace.applyEdit(edit)) {
			await doc.save();
			s.warnings = s.warnings.filter(x => x !== w);
			await this.recompute(s);
		}
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
		await this.boards.redraw(s.boardId);
	}

	private async read(file: string): Promise<string | undefined> {
		const open = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && same(d.uri.fsPath, file));
		return open ? open.getText() : fs.readFile(file, 'utf8').catch(() => undefined);
	}

	private drop(s: SkeletonSession) {
		clearTimeout(this.timers.get(s.session));
		this.sessions.delete(s.session);
		void this.boards.redraw(s.boardId);
	}

	dispose() {
		this.timers.forEach(t => clearTimeout(t));
		this.disposables.forEach(d => d.dispose());
	}
}
