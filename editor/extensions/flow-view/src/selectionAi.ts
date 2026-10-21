/*---------------------------------------------------------------------------------------------
 *  Axle: selection actions in the editor. With code selected the user can ask the agent about it, have it
 *  explained as a tour, or ask the agent to change it (docs/research/inline-ai.md). They are the same three
 *  things the canvas offers on a card (`pointAsk`), and they share one prompt builder (tour/ask.ts): Axle has
 *  no model of its own, so each is a prompt with a file and lines, sent to the agent the user chose
 *  (flow.agents.ask). An edit comes back as the usual reviewable change; nothing here shows a diff itself.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { askInDock } from './askAgent';
import { MAX_QUESTION, oneLine, place, selectedRange, selectionPrompt, type PointKind } from './tour/ask';

export const SelectionCommand = {
	ask: 'flow.selection.ask',
	explain: 'flow.selection.explain',
	edit: 'flow.selection.edit',
} as const;

const PROMPT: Record<PointKind, { title: string; placeHolder: string } | undefined> = {
	ask: { title: 'Ask the agent about this code', placeHolder: 'What would you like to know?' },
	edit: { title: 'Edit this code with the agent', placeHolder: 'How should it change? (e.g. "return early when the list is empty")' },
	explain: undefined,
};

async function run(kind: PointKind): Promise<void> {
	const ed = vscode.window.activeTextEditor;
	const range = ed && selectedRange(ed.selection);
	if (!ed || !range) {
		void vscode.window.showInformationMessage('Select some code first.');
		return;
	}
	if (ed.document.uri.scheme !== 'file' || !vscode.workspace.getWorkspaceFolder(ed.document.uri)) {
		void vscode.window.showInformationMessage('The agent can only be pointed at a file in this workspace.');
		return;
	}
	const file = ed.document.uri.fsPath;
	let question = '';
	const ask = PROMPT[kind];
	if (ask) {
		const answer = await vscode.window.showInputBox({ ...ask, prompt: place(vscode.workspace.asRelativePath(file, false).replace(/\\/g, '/'), range.startLine, range.endLine), ignoreFocusOut: true });
		question = oneLine(answer, MAX_QUESTION);
		if (!question) {
			return;
		}
	}
	const where = place(vscode.workspace.asRelativePath(file, false).replace(/\\/g, '/'), range.startLine, range.endLine);
	const label = vscode.workspace.asRelativePath(file, false).split(/[\\/]/).pop() ?? 'this code';
	const prompt = selectionPrompt({ kind, label, where, question });
	if (!await askInDock(prompt, true, 'editor', [file])) {
		await vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt, isPartialQuery: false, attachFiles: [ed.document.uri] });
	}
}

/** The lightbulb on a selection: the selection hint. */
class SelectionActions implements vscode.CodeActionProvider {
	static readonly kinds = [vscode.CodeActionKind.RefactorRewrite.append('axle')];

	provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection): vscode.CodeAction[] {
		if (range.isEmpty || document.uri.scheme !== 'file') {
			return [];
		}
		const make = (title: string, command: string, kind: vscode.CodeActionKind) => {
			const a = new vscode.CodeAction(title, kind);
			a.command = { title, command };
			return a;
		};
		const [rewrite] = SelectionActions.kinds;
		return [
			make('Axle: Edit with agent…', SelectionCommand.edit, rewrite),
			make('Axle: Ask agent about this…', SelectionCommand.ask, vscode.CodeActionKind.Empty.append('axle').append('ask')),
			make('Axle: Explain with a tour', SelectionCommand.explain, vscode.CodeActionKind.Empty.append('axle').append('explain')),
		];
	}
}

export function registerSelectionActions(): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand(SelectionCommand.ask, () => run('ask')),
		vscode.commands.registerCommand(SelectionCommand.explain, () => run('explain')),
		vscode.commands.registerCommand(SelectionCommand.edit, () => run('edit')),
		vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, new SelectionActions(), {
			providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite.append('axle'), vscode.CodeActionKind.Empty.append('axle')],
		}),
	];
}
