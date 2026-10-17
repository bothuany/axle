/*---------------------------------------------------------------------------------------------
 *  Axle Harness: harness engineering inside the editor. A merged map with a health score,
 *  the context budget, a hook studio and a permission inbox that turns answers into rules.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { isTracked, itemKey, usageLabel, type HookLike } from './activity';
import { ContextBudget } from './context';
import { costLabel, delta, loadCosts, tok, totals, totalsBefore, trackCosts, type Cost } from './cost';
import { FrictionView } from './frictionView';
import { HookStudio } from './hooks';
import { Live } from './live';
import { PermissionInbox, type PermissionRequest } from './permissions';
import { totalsBySource, unusedGap } from './gaps';
import { scan, type Harness, type HarnessItem } from './scan';
import { registerPreviewProvider } from './settings';
import { HarnessTree, itemOf } from './tree';
import { WhyView } from './why';
import { XrayView } from './xray';

export function activate(context: vscode.ExtensionContext) {
	let harness: Harness | undefined;
	const tree = new HarnessTree();
	const view = vscode.window.createTreeView('flowHarness.map', { treeDataProvider: tree, showCollapseAll: true });
	const budget = new ContextBudget();
	const studio = new HookStudio(() => harness?.root);
	const inbox = new PermissionInbox(() => harness?.root, () => void refresh());
	const inboxView = vscode.window.createTreeView('flowHarness.permissions', { treeDataProvider: inbox });
	const diagnostics = vscode.languages.createDiagnosticCollection('harness');
	const live = new Live(context.workspaceState, () => (harness?.items ?? []).flatMap(i => i.hook ? [i.hook as HookLike] : []));
	const friction = new FrictionView(live, inbox, () => harness);
	const frictionView = vscode.window.createTreeView('flowHarness.friction', { treeDataProvider: friction });
	const why = new WhyView(() => harness);
	const xray = new XrayView(() => harness, live);
	const usageOf = (i: HarnessItem) => {
		if (!isTracked(i)) {
			return undefined;
		}
		const s = live.summary(itemKey(i));
		const covered = live.covered;
		const facts = [
			`${s.week} this week, ${s.month} in 30 days`,
			s.failures ? `${s.failures} failed` : '',
			s.avgMs !== undefined ? `${s.avgMs} ms on average (measured)` : '',
		].filter(Boolean).join(', ');
		return {
			label: usageLabel(s, covered, live.sessionsSeen) + (s.failures ? `, ${s.failures} failed` : ''),
			detail: `Used ${facts}.${s.inferred ? ' Hook runs are counted from the events and matchers that fire them.' : ''} The counts cover ${covered} days and ${live.sessionsSeen} sessions of this project.`,
		};
	};
	tree.setUsage(usageOf);
	// What each file costs, and the costs at the last scan, so an edit shows as before/after.
	let costs = loadCosts(context.workspaceState.get('flowHarness.costs'));
	const costKinds = new Set(['instructions', 'rules', 'skills', 'agents']);
	const trackHarnessCosts = (h: Harness) => {
		const current: Record<string, Cost> = {};
		for (const i of h.items.filter(x => costKinds.has(x.kind) && x.agents.includes('Claude'))) {
			const c = current[i.file] ??= { always: 0, onDemand: 0 };
			c.always += i.tokens ?? 0;
			c.onDemand += i.onDemand ?? 0;
		}
		costs = trackCosts(costs, current, Date.now());
		void context.workspaceState.update('flowHarness.costs', costs);
	};
	tree.setCost(i => {
		const c = costs.files[i.file];
		if (!costKinds.has(i.kind) || !c || !(c.always || c.onDemand)) {
			return undefined;
		}
		const change = costs.changes[i.file];
		const when = i.kind === 'skills' ? 'when the skill is used' : i.kind === 'agents' ? "in the subagent's own window when it is spawned" : 'when the agent works on files it covers';
		return {
			label: costLabel(c, change),
			detail: [
				c.always ? `About ${c.always.toLocaleString()} tokens in every session (always-on).` : '',
				c.onDemand ? `About ${c.onDemand.toLocaleString()} more ${when} (on demand).` : '',
				change ? `Before the edit of ${new Date(change.at).toLocaleString()}: ${change.before.always.toLocaleString()} always-on, ${change.before.onDemand.toLocaleString()} on demand.` : '',
				'Estimates: about 4 characters per token.',
			].filter(Boolean).join(' '),
		};
	});
	/** Skills unused for the whole window: an info line on each, and a gap entry. Applied after the scan, so the health score does not change. */
	const markUnused = (h: Harness) => {
		const idle = h.items.filter(i => i.kind === 'skills' && live.summary(itemKey(i)).month === 0);
		const gap = unusedGap(idle.map(i => i.label), live.covered, live.sessionsSeen);
		h.gaps = h.gaps.filter(g => g.key !== 'unused');
		for (const i of h.items) {
			i.issues = i.issues.filter(x => !x.message.startsWith('Not used in 30 days'));
		}
		if (gap) {
			h.gaps.push(gap);
			idle.forEach(i => i.issues.push({ severity: 'info', message: 'Not used in 30 days: prune it, or sharpen its description so the agent knows when to use it' }));
		}
	};
	let liveTimer: NodeJS.Timeout | undefined;
	live.onDidChange(() => {
		clearTimeout(liveTimer);
		liveTimer = setTimeout(() => {
			if (harness) {
				const before = harness.gaps.find(g => g.key === 'unused')?.message;
				markUnused(harness);
				tree.set(harness);
				// The view's summary line names the gaps: when the unused-skills one comes or goes (the first backfill), say it there too.
				if (harness.gaps.find(g => g.key === 'unused')?.message !== before) {
					void refresh();
				}
			}
			const n = friction.count;
			frictionView.badge = n ? { value: n, tooltip: `${n} proposals from repeated friction` } : undefined;
		}, 800);
	});

	let running: Promise<void> | undefined;
	let dirty = false;
	let lastScan = 0;
	const rescan = async () => {
		try {
			harness = await scan();
			if (harness) {
				markUnused(harness);
				void live.backfill(harness.root);
			}
			tree.set(harness);
			budget.setHarness(harness);
			void friction.setHarness(harness);
			if (harness) {
				const { score, counts, startupTokens, gaps } = harness;
				trackHarnessCosts(harness);
				const now = totals(costs.files);
				const was = totalsBefore(costs);
				const problems = counts.error + counts.warning;
				const trimmed = was.always !== now.always ? ` (${delta(now.always - was.always)} after your recent edits)` : '';
				const tokens = `About ${(startupTokens / 1000).toFixed(1)}k tokens load before your first prompt${trimmed}${now.onDemand ? `, and about ${tok(now.onDemand)} more on demand` : ''}.`;
				// "Nothing broken" alone read as "all set" for a project with no harness at all: say what is missing too.
				const notSetUp = gaps.filter(g => g.key !== 'unused');
				const unused = gaps.find(g => g.key === 'unused');
				const missing = (notSetUp.length ? ` Not set up here: ${notSetUp.map(g => g.label).join(', ')}.` : '') + (unused ? ` ${unused.label.replace(/^\w/, c => c.toUpperCase())} in 30 days.` : '');
				view.description = `Health ${score} · ${tok(now.always)} always-on${now.onDemand ? ` · ${tok(now.onDemand)} on demand` : ''}`;
				view.message = problems
					? `${counts.error ? `${counts.error} broken, ` : ''}${counts.warning} to look at.${missing} ${tokens}`
					: `Nothing broken.${missing} ${tokens}`;
				view.badge = problems ? { value: problems, tooltip: `${problems} harness problems` } : undefined;
				// Line-level problems also show in the editor and the Problems panel.
				diagnostics.clear();
				const byFile = new Map<string, vscode.Diagnostic[]>();
				for (const i of harness.items) {
					for (const issue of i.issues.filter(x => x.line !== undefined)) {
						const d = new vscode.Diagnostic(new vscode.Range(issue.line!, 0, issue.line!, 999), issue.fix ? `${issue.message}. Fix: ${issue.fix}` : issue.message,
							issue.severity === 'error' ? vscode.DiagnosticSeverity.Error : issue.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information);
						d.source = 'Axle harness';
						byFile.set(i.file, [...(byFile.get(i.file) ?? []), d]);
					}
				}
				byFile.forEach((d, f) => diagnostics.set(vscode.Uri.file(f), d));
			}
		} catch (e) {
			// A file that cannot be scanned must say so, not leave a stale map behind without a word.
			view.message = `The harness scan failed: ${(e as Error).message ?? e}`;
			console.error('flow-harness: scan failed', e);
		}
		lastScan = Date.now();
	};
	/** One scan at a time; a request that arrives while one runs (a file saved meanwhile) makes it run once more, so the map never ends up older than the last change. */
	const refresh = () => {
		if (running) {
			dirty = true;
			return running;
		}
		return running = (async () => {
			try {
				do {
					dirty = false;
					await rescan();
				} while (dirty);
			} finally {
				running = undefined;
			}
		})();
	};

	// Only files that shape an agent (not .claude/worktrees or session logs) mean a fresh look; home-folder files refresh on focus.
	const watcher = vscode.workspace.createFileSystemWatcher('**/{CLAUDE.md,CLAUDE.local.md,AGENTS.md,.mcp.json,.claude/{settings*.json,rules/**,skills/**,agents/**,hooks/**,commands/**},.cursor/rules/**,.agents/skills/**}');
	const ignored = /[\\/](?:\.claude[\\/]worktrees|node_modules|\.git)[\\/]/;
	let timer: NodeJS.Timeout | undefined;
	const soon = (uri?: vscode.Uri) => {
		if (uri && ignored.test(uri.fsPath)) {
			return;
		}
		clearTimeout(timer);
		timer = setTimeout(() => void refresh(), 600);
	};
	// Coming back to the window or the view: only worth a scan when the last one is a while old.
	const ifStale = () => Date.now() - lastScan > 30_000 && soon();

	context.subscriptions.push(
		view, inboxView, budget, studio, diagnostics, watcher, registerPreviewProvider(),
		live, frictionView, why, xray, { dispose: () => clearTimeout(liveTimer) },
		watcher.onDidChange(soon), watcher.onDidCreate(soon), watcher.onDidDelete(soon),
		{ dispose: () => clearTimeout(timer) },
		vscode.window.onDidChangeWindowState(s => s.focused && ifStale()),
		view.onDidChangeVisibility(v => v.visible && ifStale()),
		vscode.commands.registerCommand('flowHarness.refresh', () => refresh()),
		vscode.commands.registerCommand('flowHarness.testHook', (arg: unknown) => {
			const item = itemOf(arg);
			return item && studio.test(item);
		}),
		vscode.commands.registerCommand('flowHarness.addHook', async () => {
			await studio.add();
			await refresh();
		}),
		vscode.commands.registerCommand('flowHarness.promote', (arg: unknown) => inbox.promote(arg, 'allow')),
		vscode.commands.registerCommand('flowHarness.promoteDeny', (arg: unknown) => inbox.promote(arg, 'deny')),
		vscode.commands.registerCommand('flowHarness.showContext', () => budget.showDetails()),
		// Called by flow-agent: usage after each update, and every permission question with its answer.
		vscode.commands.registerCommand('flowHarness.reportUsage', (u: { agent: string; used: number; size: number }) => budget.report(u)),
		vscode.commands.registerCommand('flowHarness.recordPermission', (r: PermissionRequest) => inbox.record(r)),
		// Called by flow-agent with every hook event of the agents it runs: what they used, what failed, what you typed.
		vscode.commands.registerCommand('flowHarness.recordEvent', (e: unknown) => live.record(e)),
		// From the Agents dock (one agent's session) or the Harness view (asks which session).
		vscode.commands.registerCommand('flowHarness.contextXray', (s?: unknown) => xray.show(s)),
		vscode.commands.registerCommand('flowHarness.why', (uri?: unknown) => why.show(uri)),
		vscode.commands.registerCommand('flowHarness.simulatePermission', (call: unknown, agent?: unknown) => typeof call === 'string' ? why.simulate(call, agent === 'Codex' ? 'Codex' : 'Claude') : undefined),
		vscode.commands.registerCommand('flowHarness.applyProposal', (arg: unknown) => friction.apply(arg)),
		vscode.commands.registerCommand('flowHarness.dismissProposal', (arg: unknown) => friction.dismiss(arg)),
		vscode.commands.registerCommand('flowHarness.clearFriction', async () => {
			const ok = await vscode.window.showWarningMessage('Forget the prompts and tool failures the friction inbox kept for this folder?', { modal: true, detail: 'Usage counts stay. Past transcripts are not read again unless they change.' }, 'Forget');
			if (ok === 'Forget') {
				live.clearFriction();
			}
		}),
		// For Axle Home: the health summary in one call.
		vscode.commands.registerCommand('flowHarness.health', async () => {
			if (!harness) {
				await refresh();
			}
			const h = harness;
			return h && {
				score: h.score,
				counts: h.counts,
				startupTokens: h.startupTokens,
				totals: Object.fromEntries(['instructions', 'rules', 'skills', 'agents', 'hooks', 'mcp', 'permissions'].map(k => [k, h.items.filter(i => i.kind === k).length])),
				// Home says which counts are the project's and which are the user's own (~/.claude), and what is missing.
				bySource: totalsBySource(h.items, ['instructions', 'skills', 'hooks', 'mcp', 'permissions']),
				// Home lists these as "not set up here": unused skills are set up, so they stay in the map.
				gaps: h.gaps.filter(g => g.key !== 'unused').map(g => ({ label: g.label, message: g.message })),
				issues: h.items.flatMap(i => i.issues.filter(x => x.severity !== 'info').map(x => ({ ...x, label: i.label, file: i.file }))).slice(0, 6),
			};
		}),
	);
	void refresh();
}

export function deactivate() { }
