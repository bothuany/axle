/*---------------------------------------------------------------------------------------------
 *  Axle Harness: how full each running agent's context window is (shown as rows in the Harness
 *  map), how much of it the harness itself takes before you type, and the plan's usage limits of
 *  each harness in use (the only part left in the status bar). Every number comes from the agent's
 *  own report; a window it did not report is never assumed.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { fmtTokens, limitLevel, limitLines, limitsText, toLimits, toUsage, type AgentUsage, type HarnessLimits } from './budget';
import type { Harness } from './scan';

export class ContextBudget implements vscode.Disposable {
	/** The last report of each agent, by its session id (or its name). Insertion order is report order. */
	private readonly usages = new Map<string, AgentUsage>();
	private harness: Harness | undefined;
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;
	private readonly closeListener: vscode.Disposable;

	constructor() {
		// An agent whose terminal is closed is gone: its numbers must not stay on show.
		this.closeListener = vscode.window.onDidCloseTerminal(t => {
			const gone = [...this.usages.values()].filter(u => u.agent === t.name);
			gone.forEach(u => this.usages.delete(u.key));
			if (gone.length) {
				this.changed.fire();
			}
		});
	}

	/** Newest report first: the agent that spoke last leads the list. */
	get agents(): AgentUsage[] {
		return [...this.usages.values()].reverse();
	}

	/** Tokens the harness loads into every session before the first prompt. */
	get startupTokens(): number {
		return this.harness?.startupTokens ?? 0;
	}

	setHarness(h: Harness | undefined) {
		this.harness = h;
	}

	report(arg: unknown) {
		const u = toUsage(arg);
		if (!u) {
			return;
		}
		this.usages.delete(u.key);
		if (!('ended' in u)) {
			this.usages.set(u.key, u);
		}
		this.changed.fire();
	}

	async showDetails() {
		const h = this.harness;
		const heavy = (h?.items ?? []).filter(i => i.tokens && i.agents.includes('Claude')).sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0)).slice(0, 12);
		const by = (k: string) => (h?.items ?? []).filter(i => i.kind === k && i.agents.includes('Claude')).reduce((a, i) => a + (i.tokens ?? 0), 0);
		const picks: (vscode.QuickPickItem & { file?: string; compact?: boolean })[] = [
			...(this.usages.size ? [{ label: '$(fold) Compact the conversation', detail: 'Sends /compact to the agent: keeps a summary, frees most of the window', compact: true }] : []),
			{ label: `Harness, loaded in every session: ${fmtTokens(this.startupTokens)}`, kind: vscode.QuickPickItemKind.Separator },
			{ label: `Instructions ${fmtTokens(by('instructions'))} · Always-on rules ${fmtTokens(by('rules'))} · Skill descriptions ${fmtTokens(by('skills'))} · Subagent descriptions ${fmtTokens(by('agents'))}` },
			{ label: 'Heaviest parts of the harness', kind: vscode.QuickPickItemKind.Separator },
			...heavy.map(i => ({ label: `${fmtTokens(i.tokens ?? 0)}  ${i.label}`, description: i.kind, detail: i.detail, file: i.file })),
		];
		const pick = await vscode.window.showQuickPick(picks, { title: 'Context budget', matchOnDetail: true });
		if (pick?.compact) {
			await this.compact();
		} else if (pick?.file) {
			await vscode.window.showTextDocument(vscode.Uri.file(pick.file));
		}
	}

	/**
	 * Types /compact into the agent's terminal; the agent's own chat is the fallback where it has no terminal.
	 * Run from a row, it compacts that agent; otherwise it asks which one when more than one is running.
	 */
	async compact(agent?: string) {
		let pick: string | undefined = agent ?? this.agents[0]?.agent;
		if (!agent && this.usages.size > 1) {
			pick = (await vscode.window.showQuickPick(this.agents.map(u => ({ label: u.agent, description: u.size ? `${fmtTokens(u.used)} of ${fmtTokens(u.size)} tokens` : `${fmtTokens(u.used)} tokens` })), { title: 'Compact which agent?' }))?.label;
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
		this.changed.dispose();
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
			// The context of each agent lives in the Harness view: a click goes there.
			item.command = 'flowHarness.map.focus';
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
		tip.appendMarkdown(`\n\nAs ${l.harness} last reported it. Context per agent is in the Harness view.`);
		item.tooltip = tip;
		item.show();
	}

	dispose() {
		clearInterval(this.timer);
		this.items.forEach(i => i.dispose());
	}
}
