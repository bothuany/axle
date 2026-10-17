/*---------------------------------------------------------------------------------------------
 *  Axle Harness: harness engineering inside the editor. A merged map with a health score,
 *  each agent's context fill, the plans' usage limits, a hook studio and a permission inbox that
 *  turns answers into rules.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ContextBudget, UsageLimits } from './context';
import { HookStudio } from './hooks';
import { PermissionInbox, type PermissionRequest } from './permissions';
import { totalsBySource } from './gaps';
import { scan, type Harness } from './scan';
import { registerPreviewProvider } from './settings';
import { agentOf, HarnessTree, itemOf } from './tree';

export function activate(context: vscode.ExtensionContext) {
	let harness: Harness | undefined;
	const budget = new ContextBudget();
	const limits = new UsageLimits();
	const tree = new HarnessTree(budget);
	const view = vscode.window.createTreeView('flowHarness.map', { treeDataProvider: tree, showCollapseAll: true });
	const studio = new HookStudio(() => harness?.root);
	const inbox = new PermissionInbox(() => harness?.root, () => void refresh());
	const inboxView = vscode.window.createTreeView('flowHarness.permissions', { treeDataProvider: inbox });
	const diagnostics = vscode.languages.createDiagnosticCollection('harness');

	let running: Promise<void> | undefined;
	let dirty = false;
	let lastScan = 0;
	const rescan = async () => {
		try {
			harness = await scan();
			// The Context row reads the startup tokens from the budget: give it the harness before the tree redraws.
			budget.setHarness(harness);
			tree.set(harness);
			if (harness) {
				const { score, counts, startupTokens, gaps } = harness;
				const problems = counts.error + counts.warning;
				const tokens = `About ${(startupTokens / 1000).toFixed(1)}k tokens load before your first prompt.`;
				// "Nothing broken" alone read as "all set" for a project with no harness at all: say what is missing too.
				const missing = gaps.length ? ` Not set up here: ${gaps.map(g => g.label).join(', ')}.` : '';
				view.description = `Health ${score}`;
				view.message = problems
					? `${counts.error ? `${counts.error} broken, ` : ''}${counts.warning} to look at.${missing} ${tokens}`
					: `Nothing broken.${missing} ${tokens}`;
				view.badge = problems ? { value: problems, tooltip: `${problems} harness problems` } : undefined;
				// Line-level problems also show in the editor and the Problems panel.
				diagnostics.clear();
				const byFile = new Map<string, vscode.Diagnostic[]>();
				for (const i of harness.items) {
					for (const issue of i.issues.filter(x => x.line !== undefined)) {
						const d = new vscode.Diagnostic(new vscode.Range(issue.line!, 0, issue.line!, 999), issue.message,
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
		view, inboxView, budget, limits, studio, diagnostics, watcher, registerPreviewProvider(),
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
		vscode.commands.registerCommand('flowHarness.compact', (arg: unknown) => budget.compact(agentOf(arg))),
		// Called by flow-agent: each agent's context after each update, the plans' usage limits, and every permission
		// question with its answer.
		vscode.commands.registerCommand('flowHarness.reportUsage', (u: unknown) => budget.report(u)),
		vscode.commands.registerCommand('flowHarness.reportLimits', (l: unknown) => limits.report(l)),
		vscode.commands.registerCommand('flowHarness.recordPermission', (r: PermissionRequest) => inbox.record(r)),
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
				gaps: h.gaps.map(g => ({ label: g.label, message: g.message })),
				issues: h.items.flatMap(i => i.issues.filter(x => x.severity !== 'info').map(x => ({ ...x, label: i.label, file: i.file }))).slice(0, 6),
			};
		}),
	);
	void refresh();
}

export function deactivate() { }
