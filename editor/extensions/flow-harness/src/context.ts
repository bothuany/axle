/*---------------------------------------------------------------------------------------------
 *  Flow Harness: the context budget, always in view. How full the agent's context window is,
 *  and how much of it the harness itself (memory files, skills, subagents) takes before you type.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { Harness } from './scan';

interface Usage { agent: string; used: number; size: number; at: number }

const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);

export class ContextBudget implements vscode.Disposable {
	private readonly item = vscode.window.createStatusBarItem('flowHarness.context', vscode.StatusBarAlignment.Right, 200);
	private usage: Usage | undefined;
	private harness: Harness | undefined;

	constructor() {
		this.item.name = 'Context budget';
		this.item.command = 'flowHarness.showContext';
		this.render();
	}

	setHarness(h: Harness | undefined) {
		this.harness = h;
		this.render();
	}

	report(u: { agent: string; used: number; size: number }) {
		this.usage = { ...u, at: Date.now() };
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
			{ label: '$(fold) Compact the conversation', detail: 'Sends /compact to the open chat: keeps a summary, frees most of the window', compact: true },
			{ label: 'Heaviest parts of the harness', kind: vscode.QuickPickItemKind.Separator },
			...heavy.map(i => ({ label: `${fmt(i.tokens ?? 0)}  ${i.label}`, description: i.kind, detail: i.detail, file: i.file })),
		];
		const pick = await vscode.window.showQuickPick(picks, { title: this.usage ? `Context: ${fmt(this.usage.used)} of ${fmt(this.usage.size)} tokens` : 'Context budget', matchOnDetail: true });
		if (pick?.compact) {
			await vscode.commands.executeCommand('workbench.action.chat.open', { query: '/compact', isPartialQuery: false });
		} else if (pick?.file) {
			await vscode.window.showTextDocument(vscode.Uri.file(pick.file));
		}
	}

	dispose() {
		this.item.dispose();
	}
}
