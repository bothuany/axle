/*---------------------------------------------------------------------------------------------
 *  Axle Harness: the map. One tree, grouped by what each piece does, every row saying where it
 *  comes from (user, project, local, folder), what it costs, and whether it looks broken. On top,
 *  while agents run, how full each one's context window is.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { fmtTokens, share, usageLine, type AgentUsage } from './budget';
import type { ContextBudget } from './context';
import type { Harness, HarnessItem, Kind, Severity } from './scan';

const GROUPS: { kind: Kind; label: string; icon: string; color: string; empty: string }[] = [
	{ kind: 'instructions', label: 'Instructions', icon: 'book', color: 'flowHarness.instructions', empty: 'No CLAUDE.md or AGENTS.md yet' },
	{ kind: 'rules', label: 'Rules', icon: 'law', color: 'flowHarness.rules', empty: 'No path-scoped rules' },
	{ kind: 'skills', label: 'Skills', icon: 'sparkle', color: 'flowHarness.skills', empty: 'No skills in this repo or your home folder' },
	{ kind: 'agents', label: 'Subagents', icon: 'organization', color: 'flowHarness.agents', empty: 'No subagents' },
	{ kind: 'hooks', label: 'Hooks', icon: 'zap', color: 'flowHarness.hooks', empty: 'No hooks' },
	{ kind: 'mcp', label: 'MCP servers', icon: 'plug', color: 'flowHarness.mcp', empty: 'No MCP servers in settings or .mcp.json' },
	{ kind: 'permissions', label: 'Permission rules', icon: 'shield', color: 'flowHarness.permissions', empty: 'No allow or deny rules' },
];

const SCOPE_LABEL = { user: 'you', project: 'repo', local: 'local', directory: 'folder' } as const;
const tok = (n?: number) => n === undefined ? '' : n >= 1000 ? `${(n / 1000).toFixed(1)}k tok` : `${n} tok`;
const worst = (i: HarnessItem): Severity | undefined => i.issues.some(x => x.severity === 'error') ? 'error' : i.issues.some(x => x.severity === 'warning') ? 'warning' : i.issues.length ? 'info' : undefined;

type Node = { type: 'context' } | { type: 'agent'; usage: AgentUsage } | { type: 'group'; kind: Kind } | { type: 'item'; item: HarnessItem } | { type: 'issue'; item: HarnessItem; index: number };

export class HarnessTree implements vscode.TreeDataProvider<Node> {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;
	private harness: Harness | undefined;

	constructor(private readonly budget: ContextBudget) {
		budget.onDidChange(() => this.changed.fire());
	}

	set(h: Harness | undefined) {
		this.harness = h;
		this.changed.fire();
	}

	getChildren(node?: Node): Node[] {
		if (node?.type === 'context') {
			return this.budget.agents.map(usage => ({ type: 'agent', usage }));
		}
		const h = this.harness;
		if (!node) {
			// Agents can report before the first scan finishes, or in a folder with no harness at all.
			const context: Node[] = this.budget.agents.length ? [{ type: 'context' }] : [];
			return [...context, ...(h ? GROUPS.map(g => ({ type: 'group', kind: g.kind }) as Node) : [])];
		}
		if (!h) {
			return [];
		}
		if (node.type === 'group') {
			// Problems first, then by scope from widest to narrowest (the order they are layered in).
			const order = { user: 0, project: 1, local: 2, directory: 3 };
			const rank = (i: HarnessItem) => ({ error: 0, warning: 1, info: 2, none: 3 })[worst(i) ?? 'none'];
			return h.items.filter(i => i.kind === node.kind)
				.sort((a, b) => rank(a) - rank(b) || order[a.scope] - order[b.scope] || a.label.localeCompare(b.label))
				.map(item => ({ type: 'item', item }));
		}
		if (node.type === 'item') {
			return node.item.issues.map((_, index) => ({ type: 'issue', item: node.item, index }));
		}
		return [];
	}

	getTreeItem(node: Node): vscode.TreeItem {
		if (node.type === 'context') {
			const t = new vscode.TreeItem('Context', vscode.TreeItemCollapsibleState.Expanded);
			t.id = 'context';
			t.iconPath = new vscode.ThemeIcon('dashboard');
			const startup = this.budget.startupTokens;
			t.description = startup ? `harness ${fmtTokens(startup)} per session` : '';
			t.tooltip = 'How full each running agent\'s context window is, as the agent reports it. The harness part is what loads before your first prompt.';
			t.contextValue = 'context';
			return t;
		}
		if (node.type === 'agent') {
			const u = node.usage;
			const s = share(u);
			const t = new vscode.TreeItem(u.agent);
			t.id = `agent:${u.key}`;
			t.description = usageLine(u);
			t.iconPath = new vscode.ThemeIcon('pulse', s === undefined ? undefined : new vscode.ThemeColor(s > 0.85 ? 'flowHarness.deny' : s > 0.6 ? 'flowHarness.ask' : 'flowHarness.allow'));
			const tip = new vscode.MarkdownString(`**${u.agent}**${u.harness ? ` · ${u.harness}` : ''}${u.model ? ` · ${u.model}` : ''}\n\n`);
			tip.appendMarkdown(s === undefined
				? `${u.used.toLocaleString()} tokens in context. The agent has not said how large its window is, so there is no percentage.`
				: `${u.used.toLocaleString()} of ${u.size!.toLocaleString()} tokens in use (${Math.round(s * 100)}%).`);
			t.tooltip = tip;
			t.contextValue = 'contextAgent';
			return t;
		}
		if (node.type === 'group') {
			const g = GROUPS.find(x => x.kind === node.kind)!;
			const items = this.harness!.items.filter(i => i.kind === node.kind);
			const tokens = items.reduce((a, i) => a + (i.agents.includes('Claude') ? i.tokens ?? 0 : 0), 0);
			const problems = items.reduce((a, i) => a + i.issues.filter(x => x.severity !== 'info').length, 0);
			const t = new vscode.TreeItem(g.label, items.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
			t.iconPath = new vscode.ThemeIcon(g.icon, new vscode.ThemeColor(g.color));
			t.description = items.length
				? [String(items.length), tokens ? tok(tokens) : '', problems ? `${problems} to fix` : ''].filter(Boolean).join('  ')
				: g.empty;
			t.contextValue = `group.${g.kind}`;
			if (problems) {
				t.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
			}
			return t;
		}
		if (node.type === 'issue') {
			const issue = node.item.issues[node.index];
			const t = new vscode.TreeItem(issue.message);
			t.iconPath = new vscode.ThemeIcon(issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info',
				new vscode.ThemeColor(issue.severity === 'error' ? 'errorForeground' : issue.severity === 'warning' ? 'editorWarning.foreground' : 'descriptionForeground'));
			t.command = { title: 'Open', command: 'vscode.open', arguments: [vscode.Uri.file(node.item.file), { selection: new vscode.Range(issue.line ?? 0, 0, issue.line ?? 0, 0) }] };
			return t;
		}
		const i = node.item;
		const t = new vscode.TreeItem(i.label, i.issues.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
		const sev = worst(i);
		t.description = [SCOPE_LABEL[i.scope], i.kind === 'hooks' || i.kind === 'permissions' ? i.detail : tok(i.tokens)].filter(Boolean).join('  ');
		const tip = new vscode.MarkdownString(`**${i.label}**  \n${i.detail}\n\n${i.agents.join(', ')} · ${i.scope} scope${i.tokens ? ` · about ${i.tokens.toLocaleString()} tokens per session` : ''}\n\n\`${i.file}\``);
		if (i.hook) {
			tip.appendMarkdown(`\n\n\`\`\`sh\n${i.hook.command}\n\`\`\``);
		}
		t.tooltip = tip;
		if (sev) {
			t.iconPath = new vscode.ThemeIcon(sev === 'error' ? 'error' : sev === 'warning' ? 'warning' : 'info', new vscode.ThemeColor(sev === 'error' ? 'errorForeground' : sev === 'warning' ? 'editorWarning.foreground' : 'descriptionForeground'));
		} else if (i.rule) {
			t.iconPath = new vscode.ThemeIcon(i.rule.effect === 'deny' ? 'circle-slash' : i.rule.effect === 'ask' ? 'question' : 'pass', new vscode.ThemeColor(i.rule.effect === 'deny' ? 'flowHarness.deny' : i.rule.effect === 'ask' ? 'flowHarness.ask' : 'flowHarness.allow'));
		} else {
			t.iconPath = new vscode.ThemeIcon('circle-small-filled', new vscode.ThemeColor(GROUPS.find(g => g.kind === i.kind)!.color));
		}
		t.command = { title: 'Open', command: 'vscode.open', arguments: [vscode.Uri.file(i.file)] };
		t.contextValue = i.hook ? 'hook' : `item.${i.kind}`;
		t.resourceUri = undefined;
		(t as vscode.TreeItem & { item?: HarnessItem }).item = i;
		return t;
	}
}

/** An agent row carries its agent's name, so Compact knows which terminal to type into. */
export function agentOf(arg: unknown): string | undefined {
	const a = arg as { type?: string; usage?: AgentUsage } | undefined;
	return a?.type === 'agent' ? a.usage?.agent : undefined;
}

/** A hook row carries its item, so commands run from the tree know what to act on. */
export function itemOf(arg: unknown): HarnessItem | undefined {
	const a = arg as { type?: string; item?: HarnessItem } | undefined;
	return a?.item;
}
