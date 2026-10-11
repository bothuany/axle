/*---------------------------------------------------------------------------------------------
 *  Axle Harness: the context budget, always in view. How full the agent's context window is,
 *  and how much of it the harness itself (memory files, skills, subagents) takes before you type.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { Harness } from './scan';

interface Usage { agent: string; used: number; size: number }

const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);

export class ContextBudget implements vscode.Disposable {
	private readonly item = vscode.window.createStatusBarItem('flowHarness.context', vscode.StatusBarAlignment.Right, 200);
	/** The last report of each agent, by its name (the name of its terminal, too). Insertion order is report order: the last entry spoke last. */
	private readonly usages = new Map<string, Usage>();
	private harness: Harness | undefined;
	private readonly closeListener: vscode.Disposable;

	constructor() {
		this.item.name = 'Context budget';
		this.item.command = 'flowHarness.showContext';
		// An agent whose terminal is closed is gone: its numbers must not stay on show.
		this.closeListener = vscode.window.onDidCloseTerminal(t => {
			if (this.usages.delete(t.name)) {
				this.render();
			}
		});
		this.render();
	}

	/** The agent that reported last: the status bar follows it. */
	private get usage(): Usage | undefined {
		let last: Usage | undefined;
		for (const u of this.usages.values()) {
			last = u;
		}
		return last;
	}

	setHarness(h: Harness | undefined) {
		this.harness = h;
		this.render();
	}

	report(u: { agent: string; used: number; size: number }) {
		this.usages.delete(u.agent);
		this.usages.set(u.agent, { agent: u.agent, used: u.used, size: u.size });
		this.render();
	}

	/** Ten cells, filled to the share of the window in use; colour moves from calm to warning near the limit. */
	private render() {
		const startup = this.harness?.startupTokens ?? 0;
		if (!this.usage && !startup) {
			this.item.hide();
			return;
		}
		const size = this.usage?.size ?? 200_000;
		const used = this.usage?.used ?? startup;
		const share = Math.min(1, used / size);
		const cells = Math.round(share * 10);
		this.item.text = `${'▰'.repeat(cells)}${'▱'.repeat(10 - cells)} ${Math.round(share * 100)}%`;
		this.item.color = share > 0.85 ? new vscode.ThemeColor('flowHarness.deny') : share > 0.6 ? new vscode.ThemeColor('flowHarness.ask') : undefined;
		const tip = new vscode.MarkdownString(undefined, true);
		tip.appendMarkdown(`**Context** ${this.usage ? `(${this.usage.agent})` : '(before the first prompt)'}\n\n`);
		tip.appendMarkdown(`$(circle-filled) ${fmt(used)} of ${fmt(size)} tokens in use\n\n`);
		if (this.harness) {
			const by = (k: string) => this.harness!.items.filter(i => i.kind === k && i.agents.includes('Claude')).reduce((a, i) => a + (i.tokens ?? 0), 0);
			tip.appendMarkdown(`Harness, loaded in every session: **${fmt(startup)}**\n\n`);
			tip.appendMarkdown(`- Instructions ${fmt(by('instructions'))}\n- Always-on rules ${fmt(by('rules'))}\n- Skill descriptions ${fmt(by('skills'))}\n- Subagent descriptions ${fmt(by('agents'))}\n\n`);
		}
		tip.appendMarkdown('Click for details and to compact the conversation.');
		this.item.tooltip = tip;
		this.item.show();
	}

	async showDetails() {
		const h = this.harness;
		const heavy = (h?.items ?? []).filter(i => i.tokens && i.agents.includes('Claude')).sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0)).slice(0, 12);
		const picks: (vscode.QuickPickItem & { file?: string; compact?: boolean })[] = [
			{ label: '$(fold) Compact the conversation', detail: 'Sends /compact to the agent: keeps a summary, frees most of the window', compact: true },
			{ label: 'Heaviest parts of the harness', kind: vscode.QuickPickItemKind.Separator },
			...heavy.map(i => ({ label: `${fmt(i.tokens ?? 0)}  ${i.label}`, description: i.kind, detail: i.detail, file: i.file })),
		];
		const pick = await vscode.window.showQuickPick(picks, { title: this.usage ? `Context: ${fmt(this.usage.used)} of ${fmt(this.usage.size)} tokens` : 'Context budget', matchOnDetail: true });
		if (pick?.compact) {
			await this.compact();
		} else if (pick?.file) {
			await vscode.window.showTextDocument(vscode.Uri.file(pick.file));
		}
	}

	/** Types /compact into the terminal of the agent that is running out of room; the agent's own chat is the fallback where it has no terminal. */
	private async compact() {
		const agents = [...this.usages.values()].reverse();
		let pick: string | undefined = agents[0]?.agent;
		if (agents.length > 1) {
			pick = (await vscode.window.showQuickPick(agents.map(u => ({ label: u.agent, description: `${fmt(u.used)} of ${fmt(u.size)} tokens` })), { title: 'Compact which agent?' }))?.label;
			if (!pick) {
				return;
			}
		}
		const terminal = vscode.window.terminals.find(t => t.name === pick);
		if (terminal) {
			terminal.show();
			terminal.sendText('/compact');
		} else {
			await vscode.commands.executeCommand('workbench.action.chat.open', { query: '/compact', isPartialQuery: false });
		}
	}

	dispose() {
		this.closeListener.dispose();
		this.item.dispose();
	}
}
