/*---------------------------------------------------------------------------------------------
 *  Flow Harness: harness engineering inside the editor. A merged map with a health score,
 *  the context budget, a hook studio and a permission inbox that turns answers into rules.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ContextBudget } from './context';
import { HookStudio } from './hooks';
import { PermissionInbox, type PermissionRequest } from './permissions';
import { scan, type Harness } from './scan';
import { registerPreviewProvider } from './settings';
import { HarnessTree, itemOf } from './tree';

export function activate(context: vscode.ExtensionContext) {
	let harness: Harness | undefined;
	const tree = new HarnessTree();
	const view = vscode.window.createTreeView('flowHarness.map', { treeDataProvider: tree, showCollapseAll: true });
	const budget = new ContextBudget();
	const studio = new HookStudio(() => harness?.root);
	const inbox = new PermissionInbox(() => harness?.root, () => void refresh());
	const inboxView = vscode.window.createTreeView('flowHarness.permissions', { treeDataProvider: inbox });
	const diagnostics = vscode.languages.createDiagnosticCollection('harness');
	const changed = new vscode.EventEmitter<void>();

	let running: Promise<void> | undefined;
	const refresh = () => running ??= (async () => {
		try {
			harness = await scan();
			tree.set(harness);
			budget.setHarness(harness);
			if (harness) {
				const { score, counts, startupTokens } = harness;
				const problems = counts.error + counts.warning;
				view.description = `Health ${score}`;
				view.message = problems
					? `${counts.error ? `${counts.error} broken, ` : ''}${counts.warning} to look at. About ${(startupTokens / 1000).toFixed(1)}k tokens load before your first prompt.`
					: `Nothing broken. About ${(startupTokens / 1000).toFixed(1)}k tokens load before your first prompt.`;
				view.badge = problems ? { value: problems, tooltip: `${problems} harness problems` } : undefined;
				// Line-level problems also show in the editor and the Problems panel.
				diagnostics.clear();
				const byFile = new Map<string, vscode.Diagnostic[]>();
				for (const i of harness.items) {
					for (const issue of i.issues.filter(x => x.line !== undefined)) {
						const d = new vscode.Diagnostic(new vscode.Range(issue.line!, 0, issue.line!, 999), issue.message,
							issue.severity === 'error' ? vscode.DiagnosticSeverity.Error : issue.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information);
						d.source = 'Flow harness';
						byFile.set(i.file, [...(byFile.get(i.file) ?? []), d]);
					}
				}
				byFile.forEach((d, f) => diagnostics.set(vscode.Uri.file(f), d));
			}
			changed.fire();
		} finally {
			running = undefined;
		}
	})();

	// Any harness file changing (in the repo) means a fresh look; home-folder files refresh on focus.
	const watcher = vscode.workspace.createFileSystemWatcher('**/{CLAUDE.md,CLAUDE.local.md,AGENTS.md,.mcp.json,.claude/**,.cursor/rules/**,.agents/**}');
	let timer: NodeJS.Timeout | undefined;
	const soon = () => {
		clearTimeout(timer);
		timer = setTimeout(() => void refresh(), 600);
	};

	context.subscriptions.push(
		view, inboxView, budget, studio, diagnostics, changed, watcher, registerPreviewProvider(),
		watcher.onDidChange(soon), watcher.onDidCreate(soon), watcher.onDidDelete(soon),
		vscode.window.onDidChangeWindowState(s => s.focused && soon()),
		view.onDidChangeVisibility(v => v.visible && soon()),
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
		// For Flow Home: the health summary in one call.
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
				issues: h.items.flatMap(i => i.issues.filter(x => x.severity !== 'info').map(x => ({ ...x, label: i.label, file: i.file }))).slice(0, 6),
			};
		}),
	);
	void refresh();
}

export function deactivate() { }
