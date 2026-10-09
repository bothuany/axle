/*---------------------------------------------------------------------------------------------
 *  Flow: what an agent changed, per card. flow-agent calls `flow.agentWillEdit` right before a
 *  write is allowed; we keep the file as it was ("baseline") until the user keeps or undoes it.
 *--------------------------------------------------------------------------------------------*/

import { structuredPatch } from 'diff';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { FlowNode } from './providers';

/** Per-card agent change, in current-file line numbers. */
export interface CardDiff {
	added: number[];
	/** Lines the agent removed, shown in red after `after` (0 = before the first card line). */
	removed: { after: number; lines: string[] }[];
	plus: number;
	minus: number;
}

interface Hunk {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: string[];
}

async function currentText(file: string): Promise<string> {
	const open = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && d.uri.fsPath === file);
	return open ? open.getText() : fs.readFile(file, 'utf8');
}

const norm = (s: string) => s.replace(/\r\n/g, '\n');

/** One prompt to an agent, and each file as it was right before that prompt first changed it. */
interface Turn {
	id: number;
	prompt: string;
	agent: string;
	at: number;
	before: Map<string, string>;
	/** Each file right after the agent's last write in this prompt: anything else later is someone else's edit. */
	after: Map<string, string>;
	/** Started by a real prompt (chat or a terminal hook): it lasts until the next prompt, however long. */
	prompted?: boolean;
}

/** On disk between sessions, so the timeline and Keep/Undo survive a restart. */
interface Saved {
	nextTurn: number;
	baselines: [string, string][];
	turns: { id: number; prompt: string; agent: string; at: number; before: [string, string][]; after: [string, string][] }[];
}

/** Older prompts are dropped first; a timeline is for the work in progress, not history. */
const MAX_TURNS = 30;

/** What the canvas lists in its timeline. */
export interface TurnSummary {
	id: number;
	prompt: string;
	agent: string;
	at: number;
	files: { file: string; plus: number; minus: number }[];
}

export class AgentChanges implements vscode.Disposable {
	private readonly baselines = new Map<string, string>();
	private readonly turns: Turn[] = [];
	private nextTurn = 1;
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;
	private saveTimer: NodeJS.Timeout | undefined;

	/** `storeFile`: where to keep the timeline for this workspace (none without a workspace). */
	constructor(private readonly storeFile?: string) { }

	async load() {
		if (!this.storeFile) {
			return;
		}
		try {
			const saved = JSON.parse(await fs.readFile(this.storeFile, 'utf8')) as Saved;
			this.nextTurn = saved.nextTurn;
			saved.baselines.forEach(([f, t]) => this.baselines.set(f, t));
			this.turns.push(...saved.turns.map(t => ({ ...t, before: new Map(t.before), after: new Map(t.after) })));
			this.changed.fire();
		} catch {
			// first run, or an unreadable file: start empty
		}
	}

	private save() {
		if (!this.storeFile) {
			return;
		}
		clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			const saved: Saved = {
				nextTurn: this.nextTurn,
				baselines: [...this.baselines],
				turns: this.turns.map(t => ({ id: t.id, prompt: t.prompt, agent: t.agent, at: t.at, before: [...t.before], after: [...t.after] })),
			};
			void fs.mkdir(path.dirname(this.storeFile!), { recursive: true })
				.then(() => fs.writeFile(this.storeFile!, JSON.stringify(saved)))
				.catch(() => undefined);
		}, 500);
	}

	/** A new prompt went to an agent: its edits form one step of the timeline. */
	startTurn(prompt: string, agent: string, prompted = true) {
		const last = this.turns.at(-1);
		if (last && !last.before.size) {
			this.turns.pop(); // the previous prompt changed nothing
		}
		this.turns.push({ id: this.nextTurn++, prompt, agent, at: Date.now(), before: new Map(), after: new Map(), prompted });
		this.turns.splice(0, Math.max(0, this.turns.length - MAX_TURNS));
		this.save();
	}

	/** Edits from a CLI Flow did not start come without prompts: group those arriving close together into one step. */
	ensureTurn(label: string, agent: string) {
		const last = this.turns.at(-1);
		if (!last || last.agent !== agent || (!last.prompted && Date.now() - last.at > 3 * 60_000)) {
			this.startTurn(label, agent, false);
		}
	}

	/** Called after an agent write finished: this is what the file should look like if nobody else touches it. */
	async didEdit(files: string[]) {
		const turn = this.turns.at(-1);
		if (!turn) {
			return;
		}
		for (const f of files) {
			if (turn.before.has(f)) {
				// The agent writes to disk; an open editor may not have reloaded yet, so read the file itself.
				turn.after.set(f, norm(await fs.readFile(f, 'utf8').catch(() => '')));
			}
		}
		this.save();
	}

	/** Called before the agent writes: remember the file as it is now (first write of a change wins). */
	async willEdit(files: string[]) {
		const turn = this.turns.at(-1);
		for (const f of files) {
			if (turn && !turn.before.has(f)) {
				turn.before.set(f, norm(await currentText(f).catch(() => '')));
			}
			if (!this.baselines.has(f)) {
				try {
					this.baselines.set(f, norm(await currentText(f)));
				} catch {
					this.baselines.set(f, ''); // new file
				}
			}
		}
		this.save();
	}

	private async hunks(file: string): Promise<Hunk[]> {
		const base = this.baselines.get(file);
		if (base === undefined) {
			return [];
		}
		const now = norm(await currentText(file).catch(() => ''));
		if (now === base) {
			this.baselines.delete(file); // reverted elsewhere (chat Undo, git): nothing to show
			return [];
		}
		return structuredPatch('a', 'b', base, now, '', '', { context: 0 }).hunks;
	}

	/** A file's change during one prompt: from before that prompt to before the next one that touched it. */
	private async turnHunks(turnId: number, file: string): Promise<Hunk[]> {
		const i = this.turns.findIndex(t => t.id === turnId);
		const from = this.turns[i]?.before.get(file);
		if (from === undefined) {
			return [];
		}
		// Up to the next prompt that touched it, else the agent's own last write: edits made by hand after
		// the agent finished are not part of what this prompt did.
		const later = this.turns.slice(i + 1).find(t => t.before.has(file));
		const to = later ? later.before.get(file)! : this.turns[i].after.get(file) ?? norm(await currentText(file).catch(() => ''));
		return from === to ? [] : structuredPatch('a', 'b', from, to, '', '', { context: 0 }).hunks;
	}

	/** The prompts that changed something, oldest first, with what each changed. */
	async timeline(): Promise<TurnSummary[]> {
		const out: TurnSummary[] = [];
		for (const t of this.turns) {
			const files: TurnSummary['files'] = [];
			for (const f of t.before.keys()) {
				// Put back elsewhere (git, chat Undo) and not touched again: nothing left of this prompt here.
				const touchedLater = this.turns.some(x => x.id > t.id && x.before.has(f));
				if (!touchedLater && norm(await currentText(f).catch(() => '')) === t.before.get(f)) {
					continue;
				}
				const hunks = await this.turnHunks(t.id, f);
				const lines = hunks.flatMap(h => h.lines);
				const plus = lines.filter(l => l.startsWith('+')).length;
				const minus = lines.filter(l => l.startsWith('-')).length;
				if (plus || minus) {
					files.push({ file: f, plus, minus });
				}
			}
			if (files.length) {
				out.push({ id: t.id, prompt: t.prompt, agent: t.agent, at: t.at, files });
			}
		}
		return out;
	}

	/**
	 * Undo a prompt and every prompt after it: each file goes back to how it was before the first of
	 * those prompts touched it. Asks first; edits the documents, so the editor's own undo still works.
	 */
	async undoFrom(turnId: number): Promise<{ ok: boolean; message?: string }> {
		const i = this.turns.findIndex(t => t.id === turnId);
		if (i < 0) {
			return { ok: false, message: 'That prompt is no longer tracked.' };
		}
		const restore = new Map<string, string>();
		for (const t of this.turns.slice(i)) {
			for (const [f, text] of t.before) {
				if (!restore.has(f)) {
					restore.set(f, text);
				}
			}
		}
		// A file that changed since the agent last wrote it holds someone else's work: say so before losing it.
		const touchedByOthers: string[] = [];
		for (const f of restore.keys()) {
			const lastWrite = [...this.turns].reverse().find(t => t.after.has(f))?.after.get(f);
			const now = norm(await currentText(f).catch(() => ''));
			if (lastWrite !== undefined && now !== lastWrite) {
				touchedByOthers.push(f);
			}
		}
		const later = this.turns.length - i - 1;
		const rel = (f: string) => vscode.workspace.asRelativePath(f);
		const detail = touchedByOthers.length
			? `These files changed after the agent wrote them, and those changes will be lost too:\n${touchedByOthers.map(rel).join('\n')}\n\nAll files that go back:\n${[...restore.keys()].map(rel).join('\n')}`
			: [...restore.keys()].map(rel).join('\n');
		const action = touchedByOthers.length ? 'Undo and Lose My Edits' : 'Undo Changes';
		const pick = await vscode.window.showWarningMessage(
			later ? `Undo this prompt and the ${later} after it?` : 'Undo the changes from this prompt?',
			{ modal: true, detail },
			action,
		);
		if (pick !== action) {
			return { ok: true };
		}
		const edit = new vscode.WorkspaceEdit();
		const docs: vscode.TextDocument[] = [];
		for (const [f, text] of restore) {
			const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(f));
			const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
			edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), text.replace(/\n/g, eol));
			docs.push(doc);
		}
		if (!await vscode.workspace.applyEdit(edit)) {
			return { ok: false, message: 'Could not undo the changes.' };
		}
		await Promise.all(docs.map(d => d.save()));
		this.turns.splice(i);
		for (const f of restore.keys()) {
			if (this.baselines.get(f) === restore.get(f)) {
				this.baselines.delete(f);
			}
		}
		this.save();
		this.changed.fire();
		return { ok: true };
	}

	/** Adds `diff` to every card whose method the agent touched (or, with `turnId`, touched in that prompt). */
	async annotate(root: FlowNode | null, turnId?: number) {
		if (!root || (turnId === undefined ? !this.baselines.size : !this.turns.some(t => t.id === turnId))) {
			return;
		}
		const tracked = (f: string) => turnId === undefined ? this.baselines.has(f) : !!this.turns.find(t => t.id === turnId)?.before.has(f);
		const cache = new Map<string, Hunk[]>();
		const visit = async (n: FlowNode) => {
			if (n.file && tracked(n.file)) {
				if (!cache.has(n.file)) {
					cache.set(n.file, turnId === undefined ? await this.hunks(n.file) : await this.turnHunks(turnId, n.file));
				}
				const d = this.cardDiff(cache.get(n.file)!, n.startLine, n.endLine);
				if (d) {
					(n as FlowNode & { diff?: CardDiff }).diff = d;
				}
			}
			for (const c of n.children) {
				await visit(c.node);
			}
		};
		await visit(root);
	}

	private cardDiff(hunks: Hunk[], start: number, end: number): CardDiff | undefined {
		const d: CardDiff = { added: [], removed: [], plus: 0, minus: 0 };
		for (const h of hunks) {
			// A pure deletion has newLines 0 and newStart = the line *before* the gap.
			const from = h.newLines ? h.newStart : h.newStart + 1;
			const to = h.newLines ? h.newStart + h.newLines - 1 : h.newStart;
			if (to < start || from > end) {
				continue;
			}
			let line = h.newLines ? h.newStart : h.newStart + 1;
			let pendingRemoved: string[] = [];
			for (const l of h.lines) {
				if (l.startsWith('-')) {
					pendingRemoved.push(l.slice(1));
					d.minus++;
				} else if (l.startsWith('+')) {
					if (pendingRemoved.length) {
						d.removed.push({ after: line - 1, lines: pendingRemoved });
						pendingRemoved = [];
					}
					if (line >= start && line <= end) {
						d.added.push(line);
					}
					d.plus++;
					line++;
				}
			}
			if (pendingRemoved.length) {
				d.removed.push({ after: line - 1, lines: pendingRemoved });
			}
		}
		return d.plus || d.minus ? d : undefined;
	}

	/** Keep: the card's file no longer shows as an agent change. */
	keep(file: string) {
		this.baselines.delete(file);
		this.save();
		this.changed.fire();
	}

	/** Undo the agent's changes inside one card (method), leaving the rest of the file alone. */
	async undo(file: string, start: number, end: number): Promise<{ ok: boolean; message?: string }> {
		const hunks = (await this.hunks(file)).filter(h => {
			const from = h.newLines ? h.newStart : h.newStart + 1;
			const to = h.newLines ? h.newStart + h.newLines - 1 : h.newStart;
			return !(to < start || from > end);
		});
		if (!hunks.length) {
			return { ok: true };
		}
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
		const edit = new vscode.WorkspaceEdit();
		for (const h of hunks) {
			const oldText = h.lines.filter(l => l.startsWith('-')).map(l => l.slice(1));
			if (h.newLines) {
				const range = new vscode.Range(h.newStart - 1, 0, h.newStart - 1 + h.newLines, 0);
				edit.replace(doc.uri, range, oldText.map(l => l + eol).join(''));
			} else {
				edit.insert(doc.uri, new vscode.Position(h.newStart, 0), oldText.map(l => l + eol).join(''));
			}
		}
		if (!await vscode.workspace.applyEdit(edit)) {
			return { ok: false, message: 'Could not undo the change.' };
		}
		await doc.save();
		if (!(await this.hunks(file)).length) {
			this.baselines.delete(file);
		}
		this.save();
		this.changed.fire();
		return { ok: true };
	}

	dispose() {
		clearTimeout(this.saveTimer);
		this.changed.dispose();
	}
}
