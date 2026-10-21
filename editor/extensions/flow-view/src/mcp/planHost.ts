/*---------------------------------------------------------------------------------------------
 *  Insilode agent bridge: plans become boards. Looks up the files and `Class.method` names a plan
 *  mentions (workspace files, the entry-point index, the language servers' workspace symbols) within
 *  a short budget, so the pure parser can link steps to code. Never throws: a plan with no links is
 *  still a plan.
 *--------------------------------------------------------------------------------------------*/

import { existsSync } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { Endpoints } from '../backends';
import { mentions, type PlanLink, type PlanResolvers } from '../board/plan';
import { resolveInWorkspace } from './registry';

const BUDGET_MS = 3000;
const EXCLUDE = '**/{node_modules,bin,obj,dist,out,.git,.venv,__pycache__}/**';

export async function planResolvers(markdown: string, endpoints: Endpoints): Promise<PlanResolvers> {
	const { files, symbols } = mentions(markdown, 25);
	const folders = (vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file').map(f => f.uri.fsPath);
	const fileLinks = new Map<string, PlanLink>();
	const symbolLinks = new Map<string, PlanLink>();
	const deadline = Date.now() + BUDGET_MS;
	const left = () => deadline - Date.now() > 0;

	for (const m of files) {
		const direct = resolveInWorkspace(m, folders);
		if (direct && existsSync(direct)) {
			fileLinks.set(m, { file: vscode.Uri.file(direct).fsPath });
		} else if (left() && !path.isAbsolute(m)) {
			// "OrderService.cs" or "Orders/OrderService.cs" without the folder it lives in: a single match is the file.
			const found = await vscode.workspace.findFiles(`**/${m.replace(/\\/g, '/').replace(/^\.?\//, '')}`, EXCLUDE, 2).then(r => r, () => []);
			if (found.length === 1) {
				fileLinks.set(m, { file: found[0].fsPath });
			}
		}
	}

	const entries = endpoints.cached();
	for (const s of symbols) {
		if (!left()) {
			break;
		}
		const [cls, method] = s.split('.');
		const entry = entries.find(e => e.controller.replace(/Controller$/, '').toLowerCase() === cls.replace(/Controller$/, '').toLowerCase() && e.action.toLowerCase() === method.toLowerCase());
		if (entry) {
			symbolLinks.set(s, { file: entry.file, line: entry.line });
			continue;
		}
		const found = await Promise.race([
			vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', method),
			new Promise<undefined>(r => setTimeout(() => r(undefined), Math.max(200, deadline - Date.now()))),
		]).catch(() => undefined);
		const hit = found?.find(x => x.location.uri.scheme === 'file' && vscode.workspace.getWorkspaceFolder(x.location.uri)
			&& (x.name === s || (x.name === method && (x.containerName === cls || x.containerName.endsWith(`.${cls}`)))));
		if (hit) {
			symbolLinks.set(s, { file: hit.location.uri.fsPath, line: hit.location.range.start.line + 1 });
		}
	}
	return { file: m => fileLinks.get(m), symbol: n => symbolLinks.get(n) };
}
