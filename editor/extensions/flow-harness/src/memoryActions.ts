/*---------------------------------------------------------------------------------------------
 *  Axle Harness: what you can do with an agent's memory from the map. Open it; delete it (to the
 *  trash, after a confirm, with its MEMORY.md line); promote it to CLAUDE.md as an edit you review
 *  (the memory stays unless you delete it too). And the staleness check: the paths and code names
 *  a memory mentions are looked up, files on disk and names in flow-view's index, and a memory
 *  naming what no longer exists is marked "may be stale" with what is missing.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { appendLineReviewed } from './edits';
import { mentions, promotedLine, type Memory } from './memory';
import type { Harness, HarnessItem } from './scan';
import { itemOf } from './tree';

/** What the staleness check found for one memory file, kept while the file is unchanged. */
interface Staleness {
	mtime: number;
	missing: string[];
	/** Names nobody could answer for (the index still loading, no language server): not called missing. */
	unknown: string[];
}

const STALE = 'May be stale: ';

export class MemoryActions {
	private readonly cache = new Map<string, Staleness>();

	constructor(private readonly harness: () => Harness | undefined, private readonly onChange: () => void) { }

	private memoryOf(arg: unknown): HarnessItem | undefined {
		const item = itemOf(arg);
		return item?.kind === 'memory' && item.memory ? item : undefined;
	}

	/** Moves a memory file to the trash and drops its MEMORY.md line, both after a modal confirm that names them. */
	async delete(arg: unknown) {
		const item = this.memoryOf(arg);
		if (!item?.memory) {
			return;
		}
		const index = path.join(path.dirname(item.file), 'MEMORY.md');
		const line = item.memory.indexLine;
		const ok = await vscode.window.showWarningMessage(`Delete the memory "${item.label}"?`, {
			modal: true,
			detail: `Moves ${item.file} to the trash${line !== undefined ? ` and removes line ${line + 1} of MEMORY.md, which points at it` : ''}. Agents no longer recall it.`,
		}, 'Delete');
		if (ok !== 'Delete') {
			return;
		}
		try {
			await vscode.workspace.fs.delete(vscode.Uri.file(item.file), { useTrash: true });
			if (line !== undefined) {
				const text = await fs.readFile(index, 'utf8');
				const lines = text.split(/\r?\n/);
				// Only the line still pointing at this file: MEMORY.md may have changed since the scan.
				if (lines[line]?.includes(path.basename(item.file))) {
					lines.splice(line, 1);
					await fs.writeFile(index, lines.join(text.includes('\r\n') ? '\r\n' : '\n'));
				}
			}
		} catch (e) {
			void vscode.window.showErrorMessage(`Could not delete the memory: ${(e as Error).message}`);
		}
		this.onChange();
	}

	/** Proposes the memory as a CLAUDE.md line, reworded first if wanted, shown in the refactor preview. The memory itself stays. */
	async promote(arg: unknown) {
		const item = this.memoryOf(arg);
		const h = this.harness();
		if (!item?.memory || !h) {
			return;
		}
		const target = item.agents.includes('Codex') ? 'AGENTS.md' : 'CLAUDE.md';
		const line = await vscode.window.showInputBox({
			title: `Promote "${item.label}" to ${target}`,
			value: promotedLine(item.memory),
			prompt: `Edit it before it is added; the next step shows the change. The memory stays unless you delete it.`,
			validateInput: v => v.trim() ? undefined : 'Write something',
		});
		if (line) {
			await appendLineReviewed(h.root, target, line.trim().startsWith('-') ? line.trim() : `- ${line.trim()}`, `Promote a memory to ${target}`, `From ${path.basename(item.file)}`);
		}
	}

	/**
	 * Checks every memory of `h` against the code and adds a "may be stale" issue to those that name missing files or symbols.
	 * Files are checked on disk; names go to flow-view's index (`flow.index.resolveNames`). Results are kept per file version.
	 */
	async checkStale(h: Harness): Promise<boolean> {
		const memories = h.items.filter(i => i.kind === 'memory' && i.memory);
		let changed = false;
		for (const item of memories) {
			const st = await fs.stat(item.file).catch(() => undefined);
			const mtime = st?.mtimeMs ?? 0;
			let s = this.cache.get(item.file);
			if (!s || s.mtime !== mtime || s.unknown.length) {
				s = await this.check(item.memory!, h.root, mtime);
				this.cache.set(item.file, s);
			}
			const before = item.issues.find(x => x.message.startsWith(STALE))?.message;
			item.issues = item.issues.filter(x => !x.message.startsWith(STALE));
			if (s.missing.length) {
				const message = `${STALE}it names ${s.missing.slice(0, 4).join(', ')}${s.missing.length > 4 ? ` and ${s.missing.length - 4} more` : ''}, which no longer exist${s.missing.length === 1 ? 's' : ''}`;
				item.issues.push({ severity: 'warning', message, fix: 'Check it against the code; update or delete the memory' });
				changed ||= message !== before;
			} else {
				changed ||= before !== undefined;
			}
		}
		return changed;
	}

	private async check(m: Memory, root: string, mtime: number): Promise<Staleness> {
		const { paths, symbols } = mentions(m.body);
		const missing: string[] = [];
		const unknown: string[] = [];
		for (const p of paths) {
			// The path comes from the memory's text, and only its existence is asked: nothing is read from it or written to it.
			// nosemgrep: javascript.express.security.audit.express-path-join-resolve-traversal.express-path-join-resolve-traversal
			const abs =p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : path.isAbsolute(p) ? p : path.join(root, p);
			if (!await fs.stat(abs).then(() => true, () => false)) {
				missing.push(p);
			}
		}
		if (symbols.length) {
			const answers = await Promise.resolve(vscode.commands.executeCommand<{ name: string; found: boolean | null }[]>('flow.index.resolveNames', symbols)).catch(() => undefined);
			for (const name of symbols) {
				const a = answers?.find(x => x.name === name);
				if (a?.found === false) {
					missing.push(name);
				} else if (!a || a.found === null) {
					unknown.push(name);
				}
			}
		}
		return { mtime, missing, unknown };
	}
}
