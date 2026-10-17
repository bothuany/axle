/*---------------------------------------------------------------------------------------------
 *  Axle Harness: how much of the context window the harness itself takes before you type, and the
 *  plan's usage limits of each harness in use (the only part in the status bar). How full each
 *  agent's window is shows in the Agents dock, next to the agent. Every limit comes from the CLI's
 *  own report.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { fmtTokens, limitLevel, limitLines, limitsText, toLimits, type HarnessLimits } from './budget';
import type { Harness } from './scan';

/** The harness's share of every session: what the Show Context Budget command lists. */
export class ContextBudget {
	private harness: Harness | undefined;

	setHarness(h: Harness | undefined) {
		this.harness = h;
	}

	async showDetails() {
		const h = this.harness;
		const heavy = (h?.items ?? []).filter(i => i.tokens && i.agents.includes('Claude')).sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0)).slice(0, 12);
		const by = (k: string) => (h?.items ?? []).filter(i => i.kind === k && i.agents.includes('Claude')).reduce((a, i) => a + (i.tokens ?? 0), 0);
		const picks: (vscode.QuickPickItem & { file?: string })[] = [
			{ label: `Harness, loaded in every session: ${fmtTokens(h?.startupTokens ?? 0)}`, kind: vscode.QuickPickItemKind.Separator },
			{ label: `Instructions ${fmtTokens(by('instructions'))} · Always-on rules ${fmtTokens(by('rules'))} · Skill descriptions ${fmtTokens(by('skills'))} · Subagent descriptions ${fmtTokens(by('agents'))}` },
			{ label: 'Heaviest parts of the harness', kind: vscode.QuickPickItemKind.Separator },
			...heavy.map(i => ({ label: `${fmtTokens(i.tokens ?? 0)}  ${i.label}`, description: i.kind, detail: i.detail, file: i.file })),
		];
		const pick = await vscode.window.showQuickPick(picks, { title: 'Context budget', matchOnDetail: true });
		if (pick?.file) {
			await vscode.window.showTextDocument(vscode.Uri.file(pick.file));
		}
	}
}

/**
 * One status bar item per harness with the share of its plan's 5-hour and weekly limits in use, as the CLI
 * last reported them. Hidden until a harness reports any: no guessing, no account calls of Axle's own.
 */
export class UsageLimits implements vscode.Disposable {
	private readonly items = new Map<string, vscode.StatusBarItem>();
	private readonly limits = new Map<string, HarnessLimits>();
	/** Reset times pass while nobody reports: the tooltip's "in 2 h" is redrawn each minute. */
	private readonly timer = setInterval(() => this.limits.forEach(l => this.render(l)), 60_000);

	report(arg: unknown) {
		const l = toLimits(arg);
		if (!l) {
			return;
		}
		this.limits.set(l.harness, l);
		this.render(l);
	}

	private render(l: HarnessLimits) {
		let item = this.items.get(l.harness);
		if (!item) {
			const id = `flowHarness.limits.${l.harness.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
			item = vscode.window.createStatusBarItem(id, vscode.StatusBarAlignment.Right, 200 - this.items.size);
			item.name = `${l.harness} usage limits`;
			// The context of each agent lives in the Agents dock: a click goes there.
			item.command = 'flow.agents.focus';
			this.items.set(l.harness, item);
		}
		// A window past its reset no longer says anything true: drop it rather than show a stale share.
		const now = Date.now();
		const live = { ...l, windows: l.windows.filter(w => !w.resetsAt || w.resetsAt > now) };
		if (!live.windows.length) {
			item.hide();
			return;
		}
		const level = limitLevel(live);
		item.text = `$(pulse) ${limitsText(live)}`;
		item.color = level === 'high' ? new vscode.ThemeColor('flowHarness.deny') : level === 'warn' ? new vscode.ThemeColor('flowHarness.ask') : undefined;
		const tip = new vscode.MarkdownString(undefined, true);
		tip.appendMarkdown(`**${l.harness}: plan usage**\n\n`);
		const time = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
		tip.appendMarkdown(limitLines(live, now, time).map(line => `- ${line}`).join('\n'));
		tip.appendMarkdown(`\n\nAs ${l.harness} last reported it. Context per agent is in the Agents dock.`);
		item.tooltip = tip;
		item.show();
	}

	dispose() {
		clearInterval(this.timer);
		this.items.forEach(i => i.dispose());
	}
}
