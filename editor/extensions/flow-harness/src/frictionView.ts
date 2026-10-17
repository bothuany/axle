/*---------------------------------------------------------------------------------------------
 *  Axle Harness: the friction inbox view. Corrections you keep typing, tool calls that keep
 *  failing the same way, and permissions you keep granting, each with its evidence and a fix.
 *  A fix is applied only on a click, as an edit shown in the refactor preview (instruction
 *  lines, hook scripts, settings) that you review and accept or discard.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { appendLineReviewed } from './edits';
import { correctionProposals, failureProposals, guardFileName, guardScript, type Evidence, type Proposal } from './friction';
import type { Live } from './live';
import { ruleFor, type PermissionInbox, type PermissionRequest } from './permissions';
import type { Harness } from './scan';

type Group = 'corrections' | 'failures' | 'grants';
type Row =
	| { type: 'group'; group: Group }
	| { type: 'proposal'; p: Proposal }
	| { type: 'grant'; rule: string; requests: PermissionRequest[] }
	| { type: 'evidence'; e: Evidence }
	| { type: 'empty'; group: Group };

const GROUPS: Record<Group, { label: string; icon: string; empty: string }> = {
	corrections: { label: 'Corrections you repeat', icon: 'comment-discussion', empty: 'Nothing said twice yet' },
	failures: { label: 'Tool calls that keep failing', icon: 'error', empty: 'No repeated failures' },
	grants: { label: 'Permissions you keep granting', icon: 'shield', empty: 'No permission granted twice' },
};

const when = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export class FrictionView implements vscode.TreeDataProvider<Row> {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;
	private cache: { corrections: Proposal[]; failures: Proposal[] } | undefined;
	private instructions = '';

	constructor(private readonly live: Live, private readonly inbox: PermissionInbox, private readonly harness: () => Harness | undefined) {
		live.onDidChange(() => this.refresh());
		inbox.onDidChangeTreeData(() => this.refresh());
	}

	/** The text agents read already, so a proposal it covers says so. */
	async setHarness(h: Harness | undefined) {
		const files = (h?.items ?? []).filter(i => i.kind === 'instructions' && i.scope !== 'directory').map(i => i.file);
		this.instructions = (await Promise.all(files.map(f => fs.readFile(f, 'utf8').catch(() => '')))).join('\n');
		this.refresh();
	}

	private refresh() {
		this.cache = undefined;
		this.changed.fire();
	}

	private proposals() {
		if (!this.cache) {
			const d = this.live.frictionData;
			const open = (p: Proposal) => !d.dismissed.includes(p.id);
			this.cache = { corrections: correctionProposals(d.prompts, this.instructions).filter(open), failures: failureProposals(d.failures).filter(open) };
		}
		return this.cache;
	}

	/** Rules you allowed at least twice and that no settings file holds yet. */
	private grants() {
		const h = this.harness();
		const have = new Set((h?.items ?? []).filter(i => i.rule).map(i => i.rule!.pattern));
		const by = new Map<string, PermissionRequest[]>();
		for (const r of this.inbox.requests.filter(x => x.decision === 'allowed')) {
			const rule = ruleFor(r, h?.root);
			if (rule && !have.has(rule) && !this.live.frictionData.dismissed.includes(`grant:${rule}`)) {
				by.set(rule, [...(by.get(rule) ?? []), r]);
			}
		}
		return [...by].filter(([, list]) => list.length >= 2).map(([rule, requests]) => ({ rule, requests }));
	}

	/** How many proposals are waiting, for the view's badge. */
	get count() {
		const p = this.proposals();
		return p.corrections.length + p.failures.length + this.grants().length;
	}

	getChildren(row?: Row): Row[] {
		if (!row) {
			return (['corrections', 'failures', 'grants'] as Group[]).map(group => ({ type: 'group', group }));
		}
		if (row.type === 'group') {
			const list: Row[] = row.group === 'grants'
				? this.grants().map(g => ({ type: 'grant' as const, ...g }))
				: this.proposals()[row.group].map(p => ({ type: 'proposal' as const, p }));
			return list.length ? list : [{ type: 'empty', group: row.group }];
		}
		if (row.type === 'proposal') {
			return row.p.evidence.slice(0, 20).map(e => ({ type: 'evidence', e }));
		}
		if (row.type === 'grant') {
			return row.requests.slice(0, 20).map(r => ({ type: 'evidence', e: { text: r.title, at: r.at } }));
		}
		return [];
	}

	getTreeItem(row: Row): vscode.TreeItem {
		if (row.type === 'group') {
			const g = GROUPS[row.group];
			const n = row.group === 'grants' ? this.grants().length : this.proposals()[row.group].length;
			const t = new vscode.TreeItem(g.label, n ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
			t.iconPath = new vscode.ThemeIcon(g.icon);
			t.description = n ? String(n) : '';
			return t;
		}
		if (row.type === 'empty') {
			const t = new vscode.TreeItem(GROUPS[row.group].empty);
			t.description = row.group === 'corrections' ? 'from the prompts you send agents' : '';
			return t;
		}
		if (row.type === 'evidence') {
			const first = row.e.text.split('\n')[0];
			const t = new vscode.TreeItem(first.length > 90 ? `${first.slice(0, 87)}…` : first);
			t.description = when(row.e.at);
			t.tooltip = new vscode.MarkdownString().appendCodeblock(row.e.text, 'text');
			t.iconPath = new vscode.ThemeIcon('quote');
			return t;
		}
		if (row.type === 'grant') {
			const t = new vscode.TreeItem(row.rule, vscode.TreeItemCollapsibleState.Collapsed);
			t.description = `allowed ${row.requests.length}×`;
			t.tooltip = `You allowed this ${row.requests.length} times. As a standing rule it is never asked again.`;
			t.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('flowHarness.allow'));
			t.contextValue = 'friction.grant';
			(t as vscode.TreeItem & { row?: Row }).row = row;
			return t;
		}
		const p = row.p;
		const t = new vscode.TreeItem(p.title, vscode.TreeItemCollapsibleState.Collapsed);
		t.description = p.covered ? `already in ${p.targets.join(', ')}: consider a hook` : `→ ${p.kind === 'hook' ? 'guard hook' : p.targets.join(', ')}`;
		const tip = new vscode.MarkdownString(`**Proposed ${p.kind === 'hook' ? `PreToolUse guard for \`${p.prefix}\`` : `line for ${p.targets.join(' and ')}`}**\n\n`);
		tip.appendCodeblock(p.kind === 'hook' ? p.text : `- ${p.text}`, 'markdown');
		tip.appendMarkdown(`\n\nSeen ${p.evidence.length} times, last ${when(p.evidence[0].at)}. Nothing is written until you review the edit.`);
		t.tooltip = tip;
		t.iconPath = new vscode.ThemeIcon(p.kind === 'hook' ? 'zap' : 'book', new vscode.ThemeColor(p.kind === 'hook' ? 'flowHarness.hooks' : 'flowHarness.instructions'));
		t.contextValue = 'friction.proposal';
		(t as vscode.TreeItem & { row?: Row }).row = row;
		return t;
	}

	dismiss(arg: unknown) {
		const row = (arg as { row?: Row } | undefined)?.row ?? (arg as Row | undefined);
		if (row?.type === 'proposal') {
			this.live.dismiss(row.p.id);
		} else if (row?.type === 'grant') {
			this.live.dismiss(`grant:${row.rule}`);
		}
	}

	/** Applies a proposal as a reviewed edit: the line (or the hook's reason) can be reworded first, then the refactor preview shows every change. */
	async apply(arg: unknown) {
		const row = (arg as { row?: Row } | undefined)?.row ?? (arg as Row | undefined);
		const h = this.harness();
		if (!row || !h) {
			return;
		}
		if (row.type === 'grant') {
			await this.inbox.promote({ r: row.requests[0] }, 'allow');
			return;
		}
		if (row.type !== 'proposal') {
			return;
		}
		const p = row.p;
		const text = await vscode.window.showInputBox({
			title: p.kind === 'hook' ? `Guard for ${p.prefix}: what the agent is told` : 'The line to add',
			value: p.text,
			valueSelection: p.text.includes('<') ? [p.text.indexOf('<'), p.text.indexOf('>') + 1] : undefined,
			prompt: p.kind === 'hook' ? 'The hook stops the command and sends this to the agent instead' : 'Edit it before it is added; the next step shows the change',
			validateInput: v => !v.trim() ? 'Write something' : /<say [^>]*>/.test(v) ? 'Replace the <…> part with what to do instead' : undefined,
		});
		if (!text) {
			return;
		}
		const ok = p.kind === 'hook' ? await this.applyHook(h.root, p, text.trim()) : await this.applyLine(h.root, p, text.trim());
		if (ok) {
			this.live.dismiss(p.id);
		}
	}

	private async applyLine(root: string, p: Proposal, line: string): Promise<boolean> {
		let target = p.targets[0];
		if (p.targets.length > 1) {
			const pick = await vscode.window.showQuickPick(p.targets.map(t => ({ label: t, description: t === 'CLAUDE.md' ? 'Claude Code reads it' : 'Codex reads it' })), { title: 'Add the line to which file?' });
			if (!pick) {
				return false;
			}
			target = pick.label as typeof target;
		}
		return appendLineReviewed(root, target, `- ${line}`, `Add an instruction to ${target}`, 'From the friction inbox');
	}

	private async applyHook(root: string, p: Proposal, reason: string): Promise<boolean> {
		const where = await vscode.window.showQuickPick([
			{ label: 'This repo, shared', detail: '.claude/settings.json (committed)', file: '.claude/settings.json' },
			{ label: 'This repo, just me', detail: '.claude/settings.local.json', file: '.claude/settings.local.json' },
		], { title: `Where should the guard for "${p.prefix}" live?` });
		if (!where || !p.prefix) {
			return false;
		}
		const name = guardFileName(p.prefix);
		const script = vscode.Uri.file(path.join(root, '.claude', 'hooks', name));
		const settings = vscode.Uri.file(path.join(root, where.file));
		const before = await fs.readFile(settings.fsPath, 'utf8').catch(e => (e as NodeJS.ErrnoException).code === 'ENOENT' ? '' : undefined);
		let data: Record<string, unknown>;
		try {
			const parsed = before?.trim() ? JSON.parse(before) as unknown : {};
			if (before === undefined || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				throw new Error('not a JSON object');
			}
			data = parsed as Record<string, unknown>;
		} catch (e) {
			void vscode.window.showErrorMessage(`${where.file} cannot be read as settings (${(e as Error).message}). Fix it first, then try again.`);
			return false;
		}
		const hooks = (data.hooks && typeof data.hooks === 'object' && !Array.isArray(data.hooks) ? data.hooks : data.hooks = {}) as Record<string, unknown>;
		const pre = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : hooks.PreToolUse = [];
		if (!Array.isArray(pre)) {
			return false;
		}
		pre.push({ matcher: 'Bash', hooks: [{ type: 'command', command: `node "$CLAUDE_PROJECT_DIR/.claude/hooks/${name}"`, timeout: 10 }] });
		const after = `${JSON.stringify(data, null, 2)}\n`;
		const edit = new vscode.WorkspaceEdit();
		const meta = { needsConfirmation: true, label: `Guard ${p.prefix} with a PreToolUse hook`, description: 'From the friction inbox' };
		edit.createFile(script, { ignoreIfExists: false, contents: new TextEncoder().encode(guardScript(p.prefix, reason)) }, meta);
		if (before) {
			const doc = await vscode.workspace.openTextDocument(settings);
			edit.replace(settings, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), after, meta);
		} else {
			edit.createFile(settings, { ignoreIfExists: false, contents: new TextEncoder().encode(after) }, meta);
		}
		return vscode.workspace.applyEdit(edit, { isRefactoring: true });
	}
}
