/*---------------------------------------------------------------------------------------------
 *  Flow Harness: permission inbox. Every permission an agent asked for, in one list, with what
 *  was answered; any of them can become a standing rule so it is never asked again.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { previewAndWrite } from './settings';

export interface PermissionRequest {
	at: number;
	agent: string;
	/** ACP tool kind: edit, execute, read, fetch, … */
	kind?: string;
	title: string;
	files: string[];
	rawInput?: Record<string, unknown>;
	decision: 'allowed' | 'denied' | 'auto' | 'cancelled';
}

/** The Claude Code permission rule that would cover this request next time. */
export function ruleFor(r: PermissionRequest, root: string | undefined): string | undefined {
	const input = r.rawInput ?? {};
	const command = typeof input.command === 'string' ? input.command : undefined;
	if (r.kind === 'execute' || command) {
		const words = (command ?? r.title).trim().split(/\s+/).slice(0, 2).join(' ');
		return `Bash(${words}:*)`;
	}
	if (r.kind === 'edit' || r.kind === 'delete' || r.kind === 'move') {
		const f = r.files[0] ?? (typeof input.file_path === 'string' ? input.file_path : undefined);
		const dir = f && root && f.startsWith(root) ? path.relative(root, path.dirname(f)) : undefined;
		return dir ? `Edit(${dir}/**)` : 'Edit';
	}
	if (r.kind === 'read' || r.kind === 'search') {
		return 'Read';
	}
	if (r.kind === 'fetch') {
		const url = typeof input.url === 'string' ? input.url : undefined;
		try {
			return url ? `WebFetch(domain:${new URL(url).hostname})` : 'WebFetch';
		} catch {
			return 'WebFetch';
		}
	}
	const mcp = /mcp__[\w-]+__[\w-]+/.exec(r.title)?.[0];
	return mcp;
}

type Row = { type: 'req'; r: PermissionRequest } | { type: 'empty' };

export class PermissionInbox implements vscode.TreeDataProvider<Row> {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;
	readonly requests: PermissionRequest[] = [];

	constructor(private readonly root: () => string | undefined, private readonly onRule: () => void) { }

	record(r: PermissionRequest) {
		this.requests.unshift(r);
		this.requests.splice(100);
		this.changed.fire();
	}

	getChildren(row?: Row): Row[] {
		if (row) {
			return [];
		}
		return this.requests.length ? this.requests.map(r => ({ type: 'req', r })) : [{ type: 'empty' }];
	}

	getTreeItem(row: Row): vscode.TreeItem {
		if (row.type === 'empty') {
			const t = new vscode.TreeItem('Permission requests from agents show up here');
			t.description = 'one click turns one into a rule';
			return t;
		}
		const r = row.r;
		const t = new vscode.TreeItem(r.title);
		const colors = { allowed: 'flowHarness.allow', auto: 'flowHarness.allow', denied: 'flowHarness.deny', cancelled: 'descriptionForeground' } as const;
		const icons = { allowed: 'pass', auto: 'pass-filled', denied: 'circle-slash', cancelled: 'circle-outline' } as const;
		t.iconPath = new vscode.ThemeIcon(icons[r.decision], new vscode.ThemeColor(colors[r.decision]));
		t.description = `${r.agent}  ${r.decision === 'auto' ? 'auto-allowed' : r.decision}  ${new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
		const rule = ruleFor(r, this.root());
		t.tooltip = new vscode.MarkdownString(`**${r.title}**\n\n${r.files.map(f => `\`${vscode.workspace.asRelativePath(f)}\``).join('  \n')}${rule ? `\n\nAs a rule: \`${rule}\`` : ''}`);
		t.contextValue = rule ? 'request.promotable' : 'request';
		(t as vscode.TreeItem & { req?: PermissionRequest }).req = r;
		return t;
	}

	/** Turn a request into an allow (or deny) rule in the settings file the user picks. */
	async promote(arg: unknown, effect: 'allow' | 'deny' = 'allow') {
		const r = (arg as { r?: PermissionRequest })?.r ?? (arg as { req?: PermissionRequest })?.req;
		const root = this.root();
		if (!r) {
			return;
		}
		const suggested = ruleFor(r, root);
		const rule = await vscode.window.showInputBox({
			title: effect === 'allow' ? 'Always allow' : 'Always deny',
			value: suggested,
			prompt: 'Claude Code permission rule, e.g. Bash(npm test:*), Edit(src/**), WebFetch(domain:github.com)',
		});
		if (!rule) {
			return;
		}
		const where = await vscode.window.showQuickPick([
			{ label: 'This repo, just me', detail: '.claude/settings.local.json', file: root && path.join(root, '.claude', 'settings.local.json') },
			{ label: 'This repo, shared', detail: '.claude/settings.json (committed)', file: root && path.join(root, '.claude', 'settings.json') },
			{ label: 'All my projects', detail: '~/.claude/settings.json', file: path.join(os.homedir(), '.claude', 'settings.json') },
		].filter(x => x.file), { title: `Where should "${rule}" live?` });
		if (!where?.file) {
			return;
		}
		const written = await previewAndWrite(where.file, `${effect === 'allow' ? 'Allow' : 'Deny'} ${rule}`, (s: { permissions?: { allow?: string[]; deny?: string[] } }) => {
			s.permissions ??= {};
			const list = (s.permissions[effect] ??= []);
			if (!list.includes(rule)) {
				list.push(rule);
			}
		});
		if (written) {
			this.onRule();
		}
	}
}
