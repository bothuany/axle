/*---------------------------------------------------------------------------------------------
 *  Axle agent bridge: what the tools do inside the window. Everything here reads, opens or draws:
 *  no file is written and no agent-chosen command is run (the diff view reads git state through the Git extension, and
 *  asks `git config --list` about a repository's config before opening a repository the Git extension has not found itself). Paths must be inside a workspace folder; the board is
 *  validated here (the MCP process is not the trust boundary). Nothing starts the analyzer in a way
 *  that could ask the user a question: a C# solution that is not chosen yet is reported, not prompted.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { promisify } from 'util';
import * as path from 'path';
import * as vscode from 'vscode';
import { innermost, type Analyzer } from '../analyzer';
import { entryName, type Endpoints, type Entry, type Source } from '../backends';
import { parseBoard } from '../board/spec';
import { cleanBoardId, type BoardStore } from '../board/store';
import type { ChangeSet, ChangeSetTrace } from '../changeSet';
import { POLY_LANGUAGES, type PolyIndex } from '../poly/client';
import type { FlowProvider, FlowTarget } from '../providers';
import { flowToText } from './flowtext';
import { errorResult, type ToolResult } from './protocol';
import { resolveInWorkspace } from './registry';
import { searchEntries } from './search';
import { NOT_CHECKED, tableImpactText, usedBy, type TableIndex } from './tableIndex';
import { tableEndpoints } from './turnImpact';
import { NODE_STATUSES } from './tools';

/** What the tools need from the rest of the extension. */
export interface ToolDeps {
	log: vscode.LogOutputChannel;
	endpoints: Endpoints;
	analyzer: Analyzer;
	poly: PolyIndex;
	/** Which endpoints read or write a table. */
	tables: TableIndex;
	boards: BoardStore;
	providerFor(target: FlowTarget): FlowProvider;
	showEntry(id: string, label: string, source?: Source): Promise<void>;
	showTarget(target: FlowTarget, label: string): Promise<void>;
	/** The flow the canvas shows now. */
	currentFlow(): { id: string; label: string } | undefined;
	/** Marks files as changed since the given text (HEAD, or the commit `base` names) on the canvas. */
	trackChanges(entries: { file: string; before: string | undefined }[], base?: string): Promise<void>;
	/** Opens the change set on the canvas (every flow the files reach, cut down to the changed cards); resolves with what it traced. */
	showChanges(set: ChangeSet): Promise<ChangeSetTrace>;
}

/** The Git extension's API, as far as the diff view uses it (its `Status` enum, numbered the same). */
interface GitChange { uri: vscode.Uri; originalUri: vscode.Uri; status: number }
interface GitRepo {
	rootUri: vscode.Uri;
	state: { HEAD?: { name?: string; upstream?: { remote: string; name: string } }; workingTreeChanges: GitChange[]; untrackedChanges?: GitChange[]; indexChanges: GitChange[]; mergeChanges: GitChange[] };
	status(): Promise<void>;
	diffWith(ref: string): Promise<GitChange[]>;
	getMergeBase(ref1: string, ref2: string): Promise<string | undefined>;
	getCommit(ref: string): Promise<{ hash: string }>;
}
/** What the changes are measured against: HEAD (uncommitted work), the branch's fork point, or the commit before HEAD. */
export type DiffBase = 'uncommitted' | 'branch' | 'last_commit';
const DIFF_BASES: readonly DiffBase[] = ['uncommitted', 'branch', 'last_commit'];
/** The branches a feature branch is cut from, in the order they are tried; never a name an agent chose. */
const MAIN_BRANCHES = ['main', 'master', 'origin/HEAD', 'origin/main', 'origin/master'];
interface GitApi {
	repositories: GitRepo[];
	openRepository(root: vscode.Uri): Promise<GitRepo | null>;
	toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}
interface ChangeRow { uri: vscode.Uri; original?: vscode.Uri; modified?: vscode.Uri; mark: string; repo: string }
interface Changes { list: ChangeRow[]; repos: number; /** What the base is called ("main", "HEAD~1"), when it is not HEAD. */ since?: string; notes: string[] }
/** Files the flow canvas can draw: the languages of the code index and the C# analyzer. */
const CODE_FILE = /\.(cs|ts|tsx|js|jsx|java|kt|py|go|rs|php|rb|prisma)$/i;
/** The only filter commands a repository may configure: git-lfs's own, spelled exactly as `git lfs install` writes them. */
const LFS_FILTER: Record<string, (v: string) => boolean> = {
	clean: v => v === 'git-lfs clean -- %f',
	smudge: v => v === 'git-lfs smudge -- %f',
	process: v => v === 'git-lfs filter-process',
	required: v => v === 'true',
};
const GitStatus = { IndexAdded: 1, IndexDeleted: 2, IndexRenamed: 3, Deleted: 6, Untracked: 7, IntentToAdd: 9, IntentToRename: 10 } as const;
const SKIP_DIRS = new Set(['node_modules', 'bin', 'obj', 'dist', 'out', 'build', 'target', 'vendor', 'packages', '__pycache__', 'venv']);

const execFileP = promisify(execFile);
const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] });
const num = (v: unknown, fallback: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(1, Math.min(max, Math.floor(v))) : fallback;
const slash = (p: string) => p.replace(/\\/g, '/');

/** A promise that gives up: a stuck backend must not hold the agent's call for the whole client timeout. */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	return Promise.race([p, new Promise<never>((_, reject) => timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)}s`)), ms))]).finally(() => clearTimeout(timer));
}

const ROSLYN_WAIT = {
	loading: 'Axle is loading the C# solution (the first load takes a while). Try again in about 20 seconds.',
	choose: 'There are several C# solutions and none is chosen: ask the user to pick one ("Axle: Choose Solution…"), then try again.',
};

interface Resolved { target: FlowTarget; label: string; source: Source | 'lsp'; id?: string; file?: string }

export class AgentTools {
	constructor(private readonly d: ToolDeps) { }

	async call(tool: string, a: Record<string, unknown>): Promise<ToolResult> {
		try {
			switch (tool) {
				case 'open': return await this.open(a);
				case 'open_diff': return await this.openDiff(a);
				case 'get_diagnostics': return await this.getDiagnostics(a);
				case 'find_symbol': return await this.findSymbol(a);
				case 'go_to_definition': return await this.definition(a);
				case 'find_references': return await this.references(a);
				case 'find_entry_points': return await this.find(a);
				case 'show_flow': return await this.flow(a, true);
				case 'flow_text': return await this.flow(a, false);
				case 'impact': return await this.impact(a);
				case 'get_context': return await this.context();
				case 'draw_board': return await this.draw(a);
				case 'update_board': return await this.update(a);
				default: return errorResult(`Unknown tool: ${tool}`);
			}
		} catch (e) {
			return errorResult(`${tool}: ${(e as Error)?.message ?? e}`);
		}
	}

	private get folders() {
		return (vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file').map(f => f.uri.fsPath);
	}

	private rel(file: string) {
		return slash(vscode.workspace.asRelativePath(file, false));
	}

	/** A file the agent named, inside the workspace (also after symbolic links), spelled the way VS Code spells it. */
	private async safeFile(input: unknown, mustExist = true): Promise<string> {
		if (typeof input !== 'string' || !input.trim()) {
			throw new Error('A file path is required.');
		}
		const lexical = resolveInWorkspace(input.trim(), this.folders);
		if (!lexical) {
			throw new Error(`"${input}" is outside this workspace (${this.folders.map(f => this.rel(f) || f).join(', ') || 'no folder open'}); only files inside it can be used.`);
		}
		try {
			const real = await fs.realpath(lexical);
			const roots = await Promise.all(this.folders.map(f => fs.realpath(f).catch(() => f)));
			if (!roots.some(r => resolveInWorkspace(real, [r]))) {
				throw new Error(`"${input}" resolves outside this workspace.`);
			}
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
				if (mustExist) {
					throw new Error(`File not found: ${input}`);
				}
			} else {
				throw e;
			}
		}
		return vscode.Uri.file(lexical).fsPath;
	}

	// ── open ────────────────────────────────────────────────────────────────

	private async open(a: Record<string, unknown>): Promise<ToolResult> {
		const file = await this.safeFile(a.file);
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const line = typeof a.line === 'number' ? Math.min(Math.max(1, Math.floor(a.line)), doc.lineCount) : undefined;
		const endLine = typeof a.endLine === 'number' && line ? Math.min(Math.max(line, Math.floor(a.endLine)), doc.lineCount) : line;
		const selection = line ? new vscode.Range(line - 1, 0, endLine! - 1, doc.lineAt(endLine! - 1).text.length) : undefined;
		// preserveFocus: the user is typing in the terminal; the editor shows the file without taking the keyboard.
		await vscode.window.showTextDocument(doc, { preview: a.preview !== false, preserveFocus: true, selection, viewColumn: vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One });
		return text(`Opened ${this.rel(file)}${line ? ` at line ${line}${endLine !== line ? `-${endLine}` : ''}` : ''} (${doc.lineCount} lines, ${doc.languageId}).`);
	}

	// ── diff ────────────────────────────────────────────────────────────────

	private async gitApi(): Promise<GitApi> {
		const ext = vscode.extensions.getExtension('vscode.git');
		const api = ext && (ext.isActive ? ext.exports : await ext.activate())?.getAPI?.(1);
		if (!api) {
			throw new Error('The Git extension is not available in this window.');
		}
		return api as GitApi;
	}

	/** Git repositories below the workspace folders (a few levels deep): the Git view only lists the ones it noticed. */
	private async nestedRepos(): Promise<string[]> {
		const found: string[] = [];
		let visited = 0;
		const walk = async (dir: string, depth: number): Promise<void> => {
			if (depth > 3 || visited++ > 3000) {
				return;
			}
			const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
			if (entries.some(e => e.name === '.git')) {
				if (await this.plainRepo(dir)) {
					found.push(dir);
				} else {
					this.d.log.info(`open_diff: not opening ${dir}: its git config can run programs, or its git folder is outside the workspace`);
				}
			}
			for (const e of entries) {
				if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) {
					await walk(path.join(dir, e.name), depth + 1);
				}
			}
		};
		await Promise.all(this.folders.map(f => walk(f, 0)));
		return found.map(f => vscode.Uri.file(f).fsPath);
	}

	/**
	 * A repository the Git extension did not discover itself is opened only when asking it for its status cannot run a program:
	 * its git folder is inside this workspace (or is a submodule's folder under its superproject), and its config has no
	 * fsmonitor, textconv, external diff, include, or filter other than git-lfs (those run commands during `git status`).
	 */
	private async plainRepo(dir: string): Promise<boolean> {
		try {
			const dot = path.join(dir, '.git');
			const st = await fs.lstat(dot);
			let gitDir = dot;
			if (st.isFile()) {
				const m = /^gitdir:\s*(.+)$/m.exec(await fs.readFile(dot, 'utf8'));
				if (!m) {
					return false;
				}
				gitDir = path.resolve(dir, m[1].trim());
				const modules = gitDir.split(/[\\/]\.git[\\/]modules[\\/]/);
				// A submodule's git folder lives under its superproject's own .git folder (a real folder, not another gitfile).
				const submodule = modules.length > 1 && !!resolveInWorkspace(dir, [modules[0]]) && (await fs.lstat(path.join(modules[0], '.git')).catch(() => undefined))?.isDirectory() === true;
				if (!submodule && !resolveInWorkspace(gitDir, this.folders)) {
					return false;
				}
			} else if (!st.isDirectory()) {
				return false;
			}
			// Linked worktrees and per-worktree config read settings from files this check does not look at.
			for (const extra of ['commondir', 'config.worktree']) {
				if (await fs.lstat(path.join(gitDir, extra)).then(() => true, () => false)) {
					return false;
				}
			}
			// Git itself reads the config (no includes, quoting and continuation lines as git understands them); only its keys are judged.
			const { stdout } = await execFileP('git', ['config', '--file', path.join(gitDir, 'config'), '--list', '-z', '--no-includes'], { timeout: 5000, maxBuffer: 1 << 20 }).catch(() => ({ stdout: undefined }));
			if (stdout === undefined) {
				return false;
			}
			for (const entry of stdout.split('\0').filter(Boolean)) {
				const nl = entry.indexOf('\n');
				const key = (nl < 0 ? entry : entry.slice(0, nl)).toLowerCase();
				const value = nl < 0 ? '' : entry.slice(nl + 1);
				if (/^(include|includeif)\b/.test(key) || key === 'core.fsmonitor' || key === 'diff.external' || /\.(textconv|external|command)$/.test(key) || /^extensions\.worktreeconfig$/.test(key)) {
					return false;
				}
				if (key.startsWith('filter.') && !LFS_FILTER[key.slice(key.lastIndexOf('.') + 1)]?.(value)) {
					return false;
				}
			}
			return true;
		} catch {
			return false;
		}
	}

	private async openDiff(a: Record<string, unknown>): Promise<ToolResult> {
		const only = Array.isArray(a.files) && a.files.length ? await Promise.all(a.files.map(f => this.safeFile(f, false))) : undefined;
		if (a.base !== undefined && !DIFF_BASES.includes(a.base as DiffBase)) {
			throw new Error(`base must be one of ${DIFF_BASES.join(', ')}.`);
		}
		const base = (a.base as DiffBase | undefined) ?? 'uncommitted';
		const changes = await this.collectChanges(only, base);
		const { list, repos, since, notes } = changes;
		if (!list.length) {
			const none = only ? 'No changes in the given files' : `No ${since ? `changes since ${since}` : 'uncommitted changes'} in ${repos} git repositor${repos === 1 ? 'y' : 'ies'} of this workspace`;
			return text([`${none}.`, ...notes].join('\n'));
		}
		const title = typeof a.title === 'string' && a.title.trim() ? a.title.trim().slice(0, 80) : `Axle: ${since ? `Changes since ${since}` : 'Changes'} (${list.length} file${list.length === 1 ? '' : 's'})`;
		await this.openChanges(changes, title);
		const multi = new Set(list.map(r => r.repo)).size > 1;
		const out = [
			`Opened the diff of ${list.length} file${list.length === 1 ? '' : 's'} in Axle (working tree against ${since ?? 'HEAD'}; A new, M modified, D deleted, R renamed):`,
			...list.slice(0, 60).map(r => `${r.mark} ${this.rel(r.uri.fsPath)}${multi ? `  [${r.repo}]` : ''}`),
			list.length > 60 ? `... and ${list.length - 60} more` : '',
			...notes,
		].filter(Boolean);
		// `flow: true`: the same changes on the flow canvas too (every flow they reach, cut down to the changed methods).
		if (a.flow === true) {
			out.push('', (await this.changesInFlow(changes)).message);
		}
		return text(out.join('\n'));
	}

	changesOf(only?: string[], base: DiffBase = 'uncommitted') {
		return this.collectChanges(only, base);
	}

	/** The changes in VS Code's multi-file diff editor (nothing opens when there are none). */
	async openChanges(changes: Changes, title: string) {
		if (changes.list.length) {
			await vscode.commands.executeCommand('vscode.changes', title, changes.list.map(r => [r.uri, r.original, r.modified]));
		}
	}

	/**
	 * The changes of an agent worktree flow-agent made (`<repo>/.axle/worktrees/<slug>`) since its branch left `base`. Only a
	 * linked worktree of a repository the Git extension already has open for this window is accepted: its git folder must be
	 * `<that repo's .git>/worktrees/<name>`, so it shares that repository's config (already trusted by opening it) and
	 * opening it cannot run anything new. `base` is a branch name, checked here and resolved to a commit before use.
	 */
	async worktreeChanges(root: string, base: string): Promise<Changes> {
		if (!/^[A-Za-z0-9._/-]{1,200}$/.test(base) || base.startsWith('-') || base.includes('..')) {
			throw new Error(`"${base}" is not a branch name.`);
		}
		const dir = resolveInWorkspace(root, this.folders);
		if (!dir) {
			throw new Error('That worktree is outside this workspace.');
		}
		const m = /^gitdir:\s*(.+)$/m.exec(await fs.readFile(path.join(dir, '.git'), 'utf8').catch(() => ''));
		if (!m) {
			throw new Error(`${dir} is not a git worktree.`);
		}
		const gitDir = path.resolve(dir, m[1].trim());
		// Windows paths ignore case, and git and VS Code do not always spell a drive letter alike.
		const same = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
		const api = await this.gitApi();
		const owner = api.repositories.find(r => {
			return same(path.dirname(gitDir), path.join(r.rootUri.fsPath, '.git', 'worktrees')) && (!!resolveInWorkspace(r.rootUri.fsPath, this.folders) || this.folders.some(f => resolveInWorkspace(f, [r.rootUri.fsPath])));
		});
		if (!owner) {
			throw new Error(`${path.basename(dir)} is not a worktree of a repository open in this window.`);
		}
		const repo = api.repositories.find(r => same(r.rootUri.fsPath, dir)) ?? await api.openRepository(vscode.Uri.file(dir)).catch(() => null);
		if (!repo) {
			throw new Error(`The Git extension could not open ${dir}.`);
		}
		const hash = await within(repo.getMergeBase('HEAD', base), 15_000, 'finding the base commit').catch(() => undefined);
		if (!hash || !/^[0-9a-f]{7,64}$/i.test(hash)) {
			throw new Error(`${path.basename(dir)} has no common commit with ${base}.`);
		}
		return this.collectChanges(undefined, { hash, name: base }, repo);
	}

	/**
	 * The commit `base` stands for in one repository, and what to call it. Only fixed names reach git (no agent-chosen ref),
	 * resolved to a hash here. On the main branch itself, "branch" means the commits not pushed yet.
	 */
	private async baseCommit(repo: GitRepo, base: Exclude<DiffBase, 'uncommitted'>): Promise<{ hash: string; name: string } | string> {
		if (base === 'last_commit') {
			const parent = await repo.getCommit('HEAD~1').catch(() => undefined);
			return parent ? { hash: parent.hash, name: 'HEAD~1' } : 'it has only one commit';
		}
		const head = repo.state.HEAD;
		const onMain = !!head?.name && ['main', 'master'].includes(head.name);
		const candidates = onMain ? (head?.upstream ? [`${head.upstream.remote}/${head.upstream.name}`] : []) : MAIN_BRANCHES;
		for (const name of candidates) {
			const hash = await repo.getMergeBase('HEAD', name).catch(() => undefined);
			if (hash && /^[0-9a-f]{7,64}$/i.test(hash)) {
				return { hash, name };
			}
		}
		return onMain ? `${head!.name} has no upstream branch to compare with` : `no ${MAIN_BRANCHES.slice(0, 2).join(' or ')} branch to compare with`;
	}

	/**
	 * The working-tree changes of every git repository of this workspace against HEAD (or `base`), narrowed to `only` (files
	 * or folders). A repository whose base cannot be found is left out, with a note saying why.
	 */
	private async collectChanges(only?: string[], base: DiffBase | { hash: string; name: string } = 'uncommitted', single?: GitRepo): Promise<Changes> {
		const api = await this.gitApi();
		// `single`: one repository against a commit already resolved (an agent worktree), no others.
		const repos = new Map<string, GitRepo>(single ? [[single.rootUri.fsPath, single]] : api.repositories.map(r => [r.rootUri.fsPath, r]));
		for (const root of single ? [] : await this.nestedRepos()) {
			if (!repos.has(root)) {
				const opened = await api.openRepository(vscode.Uri.file(root)).catch(() => null);
				if (opened) {
					repos.set(opened.rootUri.fsPath, opened);
				}
			}
		}
		const rows = new Map<string, ChangeRow>();
		const notes: string[] = [];
		const names = new Set<string>();
		for (const repo of repos.values()) {
			const root = repo.rootUri.fsPath;
			// A repository that belongs to this window: inside a workspace folder, or one that contains it.
			if (!resolveInWorkspace(root, this.folders) && !this.folders.some(f => resolveInWorkspace(f, [root]))) {
				continue;
			}
			await within(repo.status(), 15_000, 'git status').catch(e => this.d.log.warn(`open_diff: ${(e as Error).message}`));
			let ref = 'HEAD';
			// With git.untrackedChanges "separate" the new files are not in workingTreeChanges.
			let all = [...repo.state.workingTreeChanges, ...(repo.state.untrackedChanges ?? []), ...repo.state.indexChanges, ...repo.state.mergeChanges];
			if (base !== 'uncommitted') {
				const found = typeof base === 'object' ? base : await within(this.baseCommit(repo, base), 15_000, 'finding the base commit').catch(e => (e as Error).message);
				if (typeof found === 'string') {
					notes.push(`${path.basename(root)}: left out, ${found}.`);
					continue;
				}
				ref = found.hash;
				names.add(found.name);
				// The base against the working tree (committed and uncommitted work alike); new files git does not track yet come on top.
				const diff = await within(repo.diffWith(ref), 30_000, 'git diff').catch(e => {
					notes.push(`${path.basename(root)}: ${(e as Error).message}`);
					return undefined;
				});
				if (!diff) {
					continue;
				}
				all = [...diff, ...(repo.state.untrackedChanges ?? []), ...repo.state.workingTreeChanges.filter(c => c.status === GitStatus.Untracked)];
			}
			for (const c of all) {
				const file = c.uri.fsPath;
				// A submodule shows up as a changed "file" in its superproject: it is a folder with a repository of its own.
				if (repos.has(file)) {
					continue;
				}
				if (!resolveInWorkspace(file, this.folders) || (only && !only.some(o => file === o || resolveInWorkspace(file, [o])))) {
					continue;
				}
				// A symbolic link inside the workspace can point anywhere: the file is read below, so it must be inside by its real path too.
				if (!await this.inside(c.uri)) {
					continue;
				}
				const kinds = all.filter(x => x.uri.fsPath === file).map(x => x.status);
				const added = kinds.some(k => k === GitStatus.IndexAdded || k === GitStatus.Untracked || k === GitStatus.IntentToAdd);
				const deleted = !added && kinds.every(k => k === GitStatus.IndexDeleted || k === GitStatus.Deleted);
				const renamed = kinds.includes(GitStatus.IndexRenamed) || kinds.includes(GitStatus.IntentToRename);
				rows.set(file, {
					uri: c.uri,
					original: added ? undefined : api.toGitUri(renamed ? c.originalUri : c.uri, ref),
					modified: deleted ? undefined : c.uri,
					mark: added ? 'A' : deleted ? 'D' : renamed ? 'R' : 'M',
					repo: path.basename(root),
				});
			}
		}
		const since = base === 'uncommitted' ? undefined : [...names].join(', ') || (base === 'branch' ? 'the main branch' : 'HEAD~1');
		return { list: [...rows.values()].sort((x, y) => x.uri.fsPath.localeCompare(y.uri.fsPath)), repos: repos.size, since, notes };
	}

	/**
	 * Review a change set on the flow canvas: the files count as changed since HEAD (or the base), so the methods they touch show
	 * their diff on the cards, and one canvas shows every endpoint flow that reaches them, cut down to the changed cards, next to
	 * the changed methods no endpoint reaches.
	 */
	async changesInFlow(changes?: Changes): Promise<{ ok: boolean; opened: boolean; message: string }> {
		const { list, since, notes } = changes ?? await this.collectChanges();
		const code = list.filter(r => r.modified && CODE_FILE.test(r.uri.fsPath));
		if (!code.length) {
			return { ok: false, opened: false, message: ['No changed source files to show on the flow canvas.', ...notes].join(' ') };
		}
		const entries = await Promise.all(code.map(async r => ({
			file: r.uri.fsPath,
			before: r.original ? await Promise.resolve(vscode.workspace.openTextDocument(r.original)).then(d => d.getText(), () => '') : undefined,
		})));
		await this.d.trackChanges(entries, since);
		const label = since ? `Changes since ${since}` : 'Uncommitted changes';
		const opened = `Opened "${label}" on the flow canvas: ${code.length} changed source file${code.length === 1 ? '' : 's'}, every flow they reach cut down to the changed methods (green added, red removed lines).`;
		let trace: ChangeSetTrace;
		try {
			trace = await within(this.d.showChanges({ label, files: code.map(r => r.uri.fsPath) }), 40_000, 'tracing the changes');
		} catch (e) {
			return { ok: true, opened: true, message: `${opened} Which endpoints they reach is not known yet: ${(e as Error).message}.` };
		}
		const { impact, failed } = trace;
		const byTable = tableEndpoints(impact);
		const ids = (list: { label: string; id: string }[]) => list.slice(0, 12).map(f => `${f.label} (id=${f.id})`).join(', ') + (list.length > 12 ? ` and ${list.length - 12} more` : '');
		const reach = [
			impact.flows.length ? ` Endpoints they reach: ${ids(impact.flows)}${impact.more ? ` and ${impact.more} more` : ''}; show_flow with an id opens one in full.` : '',
			byTable.length ? ` Endpoints that read or write a changed table: ${ids(byTable)}.` : '',
			!impact.flows.length && !byTable.length ? ' No endpoint reaches them; the changed methods are shown on their own.' : '',
		].join('');
		const tables = impact.tables.length
			? ` Changed tables: ${impact.tables.map(t => `${t.entity} → table ${t.table}${t.guess ? ' (table? name is a guess)' : ''}, ${usedBy(t)}`).join('; ')}; impact with the table name lists them. Not checked: ${NOT_CHECKED}.`
			: '';
		const issues = [failed ? `${failed} flows or methods could not be traced` : '', impact.note ?? '', ...notes].filter(Boolean).join('; ');
		return { ok: true, opened: true, message: `${opened}${reach}${tables}${issues ? ` (${issues})` : ''}` };
	}

	// ── diagnostics, symbols, definitions, references ───────────────────────

	private async getDiagnostics(a: Record<string, unknown>): Promise<ToolResult> {
		const level = a.severity === 'error' ? 0 : a.severity === 'all' ? 3 : 1;
		const limit = num(a.limit, 100, 500);
		const names = ['error', 'warning', 'info', 'hint'];
		const only = typeof a.file === 'string' ? vscode.Uri.file(await this.safeFile(a.file)) : undefined;
		const entries = only ? [[only, vscode.languages.getDiagnostics(only)] as const] : vscode.languages.getDiagnostics();
		const lines: { sev: number; text: string }[] = [];
		let files = 0;
		for (const [uri, list] of entries) {
			if (uri.scheme !== 'file' || !vscode.workspace.getWorkspaceFolder(uri)) {
				continue;
			}
			const hit = list.filter(d => d.severity <= level);
			files += hit.length ? 1 : 0;
			for (const d of hit) {
				const code = typeof d.code === 'object' ? d.code.value : d.code;
				lines.push({ sev: d.severity, text: `${this.rel(uri.fsPath)}:${d.range.start.line + 1}:${d.range.start.character + 1} ${names[d.severity]}${d.source ? ` [${d.source}${code !== undefined ? ` ${code}` : ''}]` : ''} ${d.message.split('\n')[0].slice(0, 300)}` });
			}
		}
		lines.sort((x, y) => x.sev - y.sev);
		if (!lines.length) {
			return text(`No ${level === 0 ? 'errors' : level === 1 ? 'errors or warnings' : 'diagnostics'}${only ? ` in ${this.rel(only.fsPath)}` : ' in the workspace'}.`);
		}
		return text([`${lines.length} diagnostic${lines.length === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}:`, ...lines.slice(0, limit).map(l => l.text), lines.length > limit ? `... and ${lines.length - limit} more (raise limit or pass a file)` : ''].filter(Boolean).join('\n'));
	}

	private async findSymbol(a: Record<string, unknown>): Promise<ToolResult> {
		const query = typeof a.query === 'string' ? a.query.trim() : '';
		if (!query) {
			throw new Error('`query` is required.');
		}
		const limit = num(a.limit, 30, 100);
		const found = await within(Promise.resolve(vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', query)), 20_000, 'the symbol search') ?? [];
		const inside: vscode.SymbolInformation[] = [];
		for (const sym of found) {
			if (await this.inside(sym.location.uri)) {
				inside.push(sym);
			}
		}
		if (!inside.length) {
			return text(`No symbol matches "${query}". The language servers may still be loading: try again in a few seconds, or use grep.`);
		}
		return text([`${Math.min(inside.length, limit)} of ${inside.length} symbols for "${query}":`, ...inside.slice(0, limit).map(s => `- ${vscode.SymbolKind[s.kind].toLowerCase()} ${s.containerName ? `${s.containerName}.` : ''}${s.name}  ${this.rel(s.location.uri.fsPath)}:${s.location.range.start.line + 1}`)].join('\n'));
	}

	/** The position a tool call points at: `symbol` found on the line, else `column`, else the line's first token. */
	private async locate(a: Record<string, unknown>) {
		const file = await this.safeFile(a.file);
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const line = typeof a.line === 'number' ? Math.floor(a.line) : 0;
		if (line < 1 || line > doc.lineCount) {
			throw new Error(`\`line\` must be between 1 and ${doc.lineCount} for ${this.rel(file)}.`);
		}
		const row = doc.lineAt(line - 1);
		let character = row.firstNonWhitespaceCharacterIndex;
		if (typeof a.symbol === 'string' && a.symbol) {
			const at = row.text.indexOf(a.symbol);
			if (at < 0) {
				throw new Error(`"${a.symbol}" is not on line ${line} of ${this.rel(file)}: ${row.text.trim().slice(0, 160)}`);
			}
			// For "a.b" or "A::B" the editor resolves the last segment.
			const last = a.symbol.split(/[.:>]+/).filter(Boolean).pop() ?? a.symbol;
			character = at + a.symbol.lastIndexOf(last);
		} else if (typeof a.column === 'number' && a.column >= 1) {
			character = Math.min(Math.floor(a.column) - 1, row.text.length);
		}
		return { file, doc, position: new vscode.Position(line - 1, character) };
	}

	/** Whether a file is inside the workspace by the same test `safeFile` applies (symbolic links resolved). */
	private async inside(uri: vscode.Uri): Promise<boolean> {
		return uri.scheme === 'file' && await this.safeFile(uri.fsPath).then(() => true, () => false);
	}

	private where(l: vscode.Location | vscode.LocationLink) {
		const uri = 'targetUri' in l ? l.targetUri : l.uri;
		const range = 'targetUri' in l ? l.targetSelectionRange ?? l.targetRange : l.range;
		return { uri, range, shown: uri.scheme === 'file' ? this.rel(uri.fsPath) : uri.toString() };
	}

	private async definition(a: Record<string, unknown>): Promise<ToolResult> {
		const { file, doc, position } = await this.locate(a);
		const [defs, hovers] = await Promise.all([
			within(Promise.resolve(vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', doc.uri, position)), 20_000, 'the definition lookup'),
			within(Promise.resolve(vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, position)), 10_000, 'the hover lookup').catch(() => [] as vscode.Hover[]),
		]);
		const word = doc.getText(doc.getWordRangeAtPosition(position)) || `${path.basename(file)}:${position.line + 1}`;
		const out: string[] = [];
		const info = (hovers ?? []).flatMap(h => h.contents).map(c => typeof c === 'string' ? c : c.value).join('\n').replace(/```\w*/g, '').trim();
		if (info) {
			out.push(`${word}:`, info.slice(0, 800), '');
		}
		if (!defs?.length) {
			out.push(`No definition found for ${word} at ${this.rel(file)}:${position.line + 1}. The language server may still be loading.`);
			return text(out.join('\n'));
		}
		for (const d of defs.slice(0, 5)) {
			const w = this.where(d);
			out.push(`Definition: ${w.shown}:${w.range.start.line + 1}`);
			// The code of a definition is shown only when it lies inside the workspace (framework sources elsewhere: the place only).
			if (await this.inside(w.uri)) {
				const target = await vscode.workspace.openTextDocument(w.uri);
				const from = w.range.start.line;
				out.push(...Array.from({ length: Math.min(10, target.lineCount - from) }, (_, i) => `  ${from + i + 1}| ${target.lineAt(from + i).text.slice(0, 200)}`));
			}
		}
		return text(out.join('\n'));
	}

	private async references(a: Record<string, unknown>): Promise<ToolResult> {
		const { file, doc, position } = await this.locate(a);
		const limit = num(a.limit, 40, 150);
		const refs = await within(Promise.resolve(vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', doc.uri, position)), 30_000, 'the reference search') ?? [];
		const inside: vscode.Location[] = [];
		for (const r of refs) {
			if (await this.inside(r.uri)) {
				inside.push(r);
			}
		}
		const word = doc.getText(doc.getWordRangeAtPosition(position)) || `${path.basename(file)}:${position.line + 1}`;
		if (!inside.length) {
			return text(`No references to ${word} found. The language server may still be loading.`);
		}
		const lines: string[] = [];
		for (const r of inside.slice(0, limit)) {
			const target = await vscode.workspace.openTextDocument(r.uri);
			lines.push(`${this.rel(r.uri.fsPath)}:${r.range.start.line + 1}  ${target.lineAt(r.range.start.line).text.trim().slice(0, 160)}`);
		}
		const files = new Set(inside.map(r => r.uri.fsPath)).size;
		return text([`${inside.length} reference${inside.length === 1 ? '' : 's'} to ${word} in ${files} file${files === 1 ? '' : 's'}:`, ...lines, inside.length > limit ? `... and ${inside.length - limit} more (raise limit)` : ''].filter(Boolean).join('\n'));
	}

	// ── entry points ────────────────────────────────────────────────────────

	/**
	 * The entry points, without ever asking the user anything: the cache first, then the backends that can start
	 * quietly. `note` says what is missing (a C# solution not chosen, an index still building).
	 */
	private async entries(): Promise<{ list: Entry[]; note?: string }> {
		const cached = this.d.endpoints.cached();
		if (cached.length) {
			return { list: cached };
		}
		const list: Entry[] = [];
		const notes: string[] = [];
		if (this.d.poly.isReady) {
			list.push(...(await within(this.d.poly.entryPoints(), 20_000, 'the code index').catch(() => [])).map(e => ({ ...e, source: 'poly' as const })));
		} else {
			notes.push('the code index is still building');
		}
		const roslyn = await this.roslynState();
		if (roslyn === 'ready') {
			try {
				list.push(...(await within(this.d.analyzer.entryPoints(), 30_000, 'the C# analyzer')).map(e => ({ ...e, source: 'roslyn' as const })));
			} catch (e) {
				notes.push(`the C# analyzer is not available (${(e as Error).message})`);
			}
		} else if (roslyn !== 'none') {
			notes.push(ROSLYN_WAIT[roslyn]);
		}
		return { list, note: notes.length ? `Note: ${notes.join('; ')}.` : undefined };
	}

	private async find(a: Record<string, unknown>): Promise<ToolResult> {
		const { list, note } = await this.entries();
		const query = typeof a.query === 'string' ? a.query : '';
		const hits = searchEntries(list, query, num(a.limit, 10, 50));
		if (!hits.length) {
			return text(`No entry point matches "${query}" among ${list.length}.${note ? ` ${note}` : ''}${list.length ? ' Try fewer words (a noun such as "user").' : ''}`);
		}
		const lines = hits.map(({ entry: e }) => `- ${e.http} ${entryName(e)}  ${this.rel(e.file)}:${e.line}  id=${e.id}`);
		return text([`${hits.length} of ${list.length} entry points${query ? ` for "${query}"` : ''}:`, ...lines, note ?? ''].filter(Boolean).join('\n'));
	}

	/**
	 * Where the C# analyzer stands, without ever asking the user anything or making the agent wait for a solution load:
	 * ready; loading (it was just started in the background: ask again in a moment); choose (several solutions, none picked);
	 * or none (no solution in this workspace).
	 */
	private async roslynState(): Promise<'ready' | 'loading' | 'choose' | 'none'> {
		const a = this.d.analyzer;
		if (a.isReady) {
			return 'ready';
		}
		if (!await a.hasSolution()) {
			return 'none';
		}
		if (await a.canStartQuietly()) {
			void a.port().catch(e => this.d.log.warn(`agent bridge: analyzer start failed: ${(e as Error).message}`));
			return 'loading';
		}
		return 'choose';
	}

	/** The flow target an `id`, or a `file` with `method`/`line`, stands for. */
	private async resolve(a: Record<string, unknown>): Promise<Resolved> {
		if (typeof a.id === 'string' && a.id) {
			const known = this.d.endpoints.cached().find(e => e.id === a.id) ?? (await this.entries()).list.find(e => e.id === a.id);
			const source: Source = known?.source ?? (a.id.startsWith('poly:') ? 'poly' : 'roslyn');
			if (source === 'roslyn') {
				const state = await this.roslynState();
				if (state !== 'ready') {
					throw new Error(state === 'none' ? 'This workspace has no C# solution.' : ROSLYN_WAIT[state]);
				}
			}
			return { target: { kind: source, id: a.id }, label: known ? entryName(known) : a.id.split(/[#:]/).pop() || a.id, source, id: a.id, file: known?.file };
		}
		if (typeof a.file !== 'string') {
			throw new Error('Pass an `id` from find_entry_points, or `file` with `method` or `line`.');
		}
		const file = await this.safeFile(a.file);
		const method = typeof a.method === 'string' ? a.method.trim().toLowerCase() : '';
		const line = typeof a.line === 'number' ? Math.floor(a.line) : undefined;
		if (!method && !line) {
			throw new Error('Pass `method` or `line` with `file`.');
		}
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const matches = (name: string) => { const n = name.toLowerCase(); return n === method || n.endsWith(`.${method}`) || n.endsWith(`#${method}`) || n.endsWith(`::${method}`); };
		const unknownMethod = (names: string[]) => new Error(`No method "${a.method}" in ${this.rel(file)}. Methods there: ${names.slice(0, 30).join(', ') || 'none found'}.`);

		if (POLY_LANGUAGES.has(doc.languageId)) {
			if (!this.d.poly.isReady) {
				throw new Error('The code index is still building; retry in a few seconds.');
			}
			if (line) {
				const hit = await this.d.poly.functionAt(file, line);
				if (!hit) {
					throw new Error(`No function contains line ${line} of ${this.rel(file)}.`);
				}
				return { target: { kind: 'poly', id: hit.id }, label: hit.label, source: 'poly', id: hit.id, file };
			}
			const all = await this.d.poly.methods(file);
			const hit = all.find(m => matches(m.name));
			if (!hit) {
				throw unknownMethod(all.map(m => m.name));
			}
			return { target: { kind: 'poly', id: hit.id }, label: hit.name, source: 'poly', id: hit.id, file };
		}
		const roslyn = doc.languageId === 'csharp' ? await this.roslynState() : 'none';
		if (roslyn === 'loading' || roslyn === 'choose') {
			throw new Error(ROSLYN_WAIT[roslyn]);
		}
		if (roslyn === 'ready') {
			const all = await this.d.analyzer.methods(file);
			const hit = line ? innermost(all, line) : all.find(m => matches(m.name));
			if (!hit) {
				throw line ? new Error(`No method contains line ${line} of ${this.rel(file)}.`) : unknownMethod(all.map(m => m.name));
			}
			return { target: { kind: 'roslyn', id: hit.id }, label: hit.name, source: 'roslyn', id: hit.id, file };
		}
		// Any other language: its language server's symbols.
		const position = line ? new vscode.Position(Math.min(line, doc.lineCount) - 1, Math.max(0, doc.lineAt(Math.min(line, doc.lineCount) - 1).firstNonWhitespaceCharacterIndex)) : await this.symbolPosition(doc, matches, unknownMethod);
		return { target: { kind: 'lsp', uri: doc.uri.toString(), line: position.line, character: position.character }, label: a.method ? String(a.method) : `${path.basename(file)}:${line}`, source: 'lsp', file };
	}

	private async symbolPosition(doc: vscode.TextDocument, matches: (n: string) => boolean, unknownMethod: (names: string[]) => Error): Promise<vscode.Position> {
		const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', doc.uri) ?? [];
		const all: vscode.DocumentSymbol[] = [];
		const walk = (list: vscode.DocumentSymbol[]) => list.forEach(s => { all.push(s); walk(s.children ?? []); });
		walk(symbols);
		const callable = all.filter(s => s.kind === vscode.SymbolKind.Method || s.kind === vscode.SymbolKind.Function || s.kind === vscode.SymbolKind.Constructor);
		const hit = callable.find(s => matches(s.name));
		if (!hit) {
			throw unknownMethod(callable.map(s => s.name));
		}
		return hit.selectionRange.start;
	}

	// ── flows ───────────────────────────────────────────────────────────────

	private async flow(a: Record<string, unknown>, open: boolean): Promise<ToolResult> {
		const r = await this.resolve(a);
		if (open) {
			if (r.source === 'lsp') {
				await this.d.showTarget(r.target, r.label);
			} else {
				await this.d.showEntry(r.id!, r.label, r.source);
			}
		}
		const root = await within(this.d.providerFor(r.target).graph(r.target), 120_000, 'the flow');
		const t = flowToText(root, { depth: num(a.depth, 6, 12), rel: f => this.rel(f) });
		return text([
			open ? `Opened the flow of ${r.label} in Axle.` : `Flow of ${r.label}:`,
			'Format: "-> L<n>" is the line in the caller where the call is made; [db] marks a table; ~table after a [db] line means the table name is a guess (a naming default or raw SQL, not ORM metadata).',
			'',
			t.text,
			t.tables.length ? `\nTables touched: ${t.tables.join(', ')}${t.guessed.length ? ` (guessed, ~table: ${t.guessed.join(', ')})` : ''}` : '',
		].join('\n'));
	}

	/** A table name or an entity class: the endpoints that write and read it, from the code index and (when it is loaded) the C# analyzer. */
	private async tableImpact(name: string): Promise<ToolResult> {
		const found = await within(this.d.tables.lookup(name, 10_000), 90_000, 'the table lookup');
		if (!found) {
			const known = await this.d.tables.known().catch(() => [] as string[]);
			return text([
				`No entity or table named "${name}" is known to Axle's code index or, when it is loaded, the C# analyzer.`,
				known.length ? `Tables it knows (${known.length}): ${known.slice(0, 40).join(', ')}${known.length > 40 ? ', ...' : ''}.` : 'It knows no tables yet: the index may still be building, or the project has no ORM entities in a language with schema cards.',
				`Not checked: ${NOT_CHECKED}.`,
			].join('\n'));
		}
		return text(tableImpactText(found, f => this.rel(f)).join('\n'));
	}

	private async impact(a: Record<string, unknown>): Promise<ToolResult> {
		const asked = [a.table, a.entity].find((v): v is string => typeof v === 'string' && !!v.trim());
		if (asked) {
			if (a.id || a.file) {
				throw new Error('Pass a `table` or `entity`, or a method (`id`, or `file` with `method` or `line`), not both.');
			}
			return this.tableImpact(asked.trim());
		}
		const r = await this.resolve(a);
		const provider = this.d.providerFor(r.target);
		const [callers, affected] = await Promise.all([
			within(provider.callers(r.target), 60_000, 'the callers').catch(() => null),
			within(provider.impact(r.target), 60_000, 'the impact').catch((e: Error) => ({ label: 'entry point', items: [], error: e.message })),
		]);
		const out = [`Impact of changing ${r.label}:`];
		if (callers) {
			const t = flowToText(callers, { depth: num(a.depth, 3, 6), rel: f => this.rel(f) }, 'callers');
			out.push('', t.nodes > 1 ? 'Callers ("<- L<n>" is the line in the caller):' : 'No callers found in the index.', t.nodes > 1 ? t.text : '');
		}
		const items = (affected as { items: string[] }).items;
		out.push('', items.length ? `${items.length} ${(affected as { label: string }).label}${items.length > 1 ? 's' : ''} reach it:` : 'No entry point reaches it.', ...items.slice(0, 60).map(i => `- ${i}`));
		return text(out.join('\n'));
	}

	// ── context ─────────────────────────────────────────────────────────────

	private async gitChanges(): Promise<{ branch?: string; files: string[] } | undefined> {
		try {
			const ext = vscode.extensions.getExtension('vscode.git');
			const api = (ext?.isActive ? ext.exports : await ext?.activate())?.getAPI?.(1);
			const repo = api?.repositories?.find((r: { rootUri: vscode.Uri }) => this.folders.some(f => resolveInWorkspace(r.rootUri.fsPath, [f]) || resolveInWorkspace(f, [r.rootUri.fsPath])));
			if (!repo) {
				return undefined;
			}
			const s = repo.state;
			const files = new Set<string>();
			for (const c of [...s.workingTreeChanges, ...s.indexChanges, ...s.mergeChanges]) {
				files.add(this.rel(c.uri.fsPath));
			}
			return { branch: s.HEAD?.name, files: [...files].slice(0, 50) };
		} catch {
			return undefined;
		}
	}

	private diagnostics() {
		const sev = ['error', 'warning', 'info', 'hint'];
		const perFile: { file: string; errors: number; warnings: number; first: string[] }[] = [];
		let errors = 0;
		let warnings = 0;
		for (const [uri, list] of vscode.languages.getDiagnostics()) {
			if (uri.scheme !== 'file' || !vscode.workspace.getWorkspaceFolder(uri)) {
				continue;
			}
			const e = list.filter(d => d.severity === vscode.DiagnosticSeverity.Error);
			const w = list.filter(d => d.severity === vscode.DiagnosticSeverity.Warning);
			errors += e.length;
			warnings += w.length;
			if (e.length || w.length) {
				perFile.push({ file: this.rel(uri.fsPath), errors: e.length, warnings: w.length, first: e.slice(0, 2).map(d => `L${d.range.start.line + 1} ${(sev[d.severity])}: ${d.message.split('\n')[0].slice(0, 160)}`) });
			}
		}
		perFile.sort((a, b) => b.errors - a.errors || b.warnings - a.warnings);
		return { errors, warnings, files: perFile.slice(0, 10), moreFiles: Math.max(0, perFile.length - 10) };
	}

	private async context(): Promise<ToolResult> {
		const ed = vscode.window.activeTextEditor;
		const active = ed && ed.document.uri.scheme === 'file' ? {
			file: this.rel(ed.document.uri.fsPath),
			language: ed.document.languageId,
			dirty: ed.document.isDirty,
			cursor: { line: ed.selection.active.line + 1, column: ed.selection.active.character + 1 },
			selection: ed.selection.isEmpty ? undefined : { startLine: ed.selection.start.line + 1, endLine: ed.selection.end.line + 1, text: ed.document.getText(ed.selection).slice(0, 4000) },
			visibleLines: ed.visibleRanges[0] ? [ed.visibleRanges[0].start.line + 1, ed.visibleRanges[0].end.line + 1] : undefined,
		} : undefined;
		const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input instanceof vscode.TabInputText && t.input.uri.scheme === 'file').slice(0, 30)
			.map(t => ({ file: this.rel((t.input as vscode.TabInputText).uri.fsPath), active: t.isActive || undefined, dirty: t.isDirty || undefined }));
		const flow = this.d.currentFlow();
		const [git] = await Promise.all([within(this.gitChanges(), 4000, 'git').catch(() => undefined)]);
		return text(JSON.stringify({
			workspace: this.folders,
			activeFile: active,
			flowOnCanvas: flow ? { label: flow.label, id: flow.id } : undefined,
			openEditors: tabs,
			git,
			diagnostics: this.diagnostics(),
			boards: this.d.boards.list().slice(0, 10).map(b => ({ id: b.id, title: b.spec.title, kind: b.spec.kind })),
		}, null, 1));
	}

	// ── boards ──────────────────────────────────────────────────────────────

	private async draw(a: Record<string, unknown>): Promise<ToolResult> {
		let raw = a.board;
		if (typeof raw === 'string') {
			try {
				raw = JSON.parse(raw);
			} catch {
				throw new Error('`board` must be an object (or JSON text of one).');
			}
		}
		if (JSON.stringify(raw ?? null).length > 1_500_000) {
			throw new Error('The board is too large; draw fewer nodes or split it into several boards.');
		}
		const spec = parseBoard(raw);
		const warnings: string[] = [];
		const sent = raw as { nodes?: unknown[]; edges?: unknown[] };
		const droppedEdges = (Array.isArray(sent.edges) ? sent.edges.length : 0) - spec.edges.length;
		if (droppedEdges > 0) {
			warnings.push(`${droppedEdges} edge(s) were dropped because they name a node id that does not exist (or exceed the limit).`);
		}
		const droppedNodes = (Array.isArray(sent.nodes) ? sent.nodes.length : 0) - spec.nodes.length;
		if (droppedNodes > 0) {
			warnings.push(`${droppedNodes} node(s) were dropped (not objects, or without an id or label).`);
		}
		// Links to code: only files inside the workspace; a path outside is dropped, not followed.
		for (const n of spec.nodes) {
			if (n.file) {
				const resolved = resolveInWorkspace(n.file, this.folders);
				if (resolved) {
					n.file = vscode.Uri.file(resolved).fsPath;
				} else {
					warnings.push(`node "${n.id}": file "${n.file}" is outside the workspace and was not linked.`);
					n.file = undefined;
					n.line = undefined;
				}
			}
		}
		const wanted = cleanBoardId(a.id);
		const replaced = wanted ? !!this.d.boards.get(wanted) : false;
		const id = await this.d.boards.set(spec, { id: wanted, origin: 'agent' });
		return text([
			`Board "${id}" ${replaced ? 'replaced' : 'drawn'} and shown to the user in Axle: ${spec.kind}, ${spec.nodes.length} nodes, ${spec.edges.length} edges.`,
			spec.kind === 'plan' ? `Tick steps off with update_board (id "${id}", nodeId one of: ${spec.nodes.slice(0, 20).map(n => n.id).join(', ')}).` : `Use id "${id}" again to replace it.`,
			...warnings,
		].join('\n'));
	}

	private async update(a: Record<string, unknown>): Promise<ToolResult> {
		const id = cleanBoardId(a.id);
		if (!id || typeof a.nodeId !== 'string') {
			throw new Error('`id` and `nodeId` are required.');
		}
		const status = typeof a.status === 'string' ? a.status : undefined;
		if (status !== undefined && !(NODE_STATUSES as readonly string[]).includes(status)) {
			throw new Error(`status must be one of: ${NODE_STATUSES.join(', ')}.`);
		}
		if (status === undefined && typeof a.note !== 'string') {
			throw new Error('Pass `status` and/or `note`.');
		}
		const node = await this.d.boards.updateNode(id, a.nodeId, { status: status as (typeof NODE_STATUSES)[number] | undefined, note: typeof a.note === 'string' ? a.note : undefined });
		return text(`Board "${id}": node "${node.id}" is now ${node.status ?? 'unmarked'}${typeof a.note === 'string' ? ' (note updated)' : ''}.`);
	}
}
