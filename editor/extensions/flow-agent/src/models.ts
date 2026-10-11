/*---------------------------------------------------------------------------------------------
 *  Axle: the chat UI binds every request to a language model. Our agents bring their own model
 *  (picked in the session's Model picker), so each session type gets one placeholder model that
 *  only exists for that type and never answers directly.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const MODELS: vscode.LanguageModelChatInformation[] = [
	{ id: 'flow-claude', name: 'Claude Code', family: 'flow', version: '1', maxInputTokens: 200_000, maxOutputTokens: 64_000, capabilities: {}, targetChatSessionType: 'flow-claude', isUserSelectable: true, isDefault: true } as vscode.LanguageModelChatInformation,
	{ id: 'flow-codex', name: 'Codex', family: 'flow', version: '1', maxInputTokens: 200_000, maxOutputTokens: 64_000, capabilities: {}, targetChatSessionType: 'flow-codex', isUserSelectable: true, isDefault: true } as vscode.LanguageModelChatInformation,
];

export function registerPlaceholderModels(): vscode.Disposable {
	return vscode.lm.registerLanguageModelChatProvider('flow', {
		provideLanguageModelChatInformation: () => MODELS,
		provideLanguageModelChatResponse: async () => {
			throw new Error('This model only runs inside a Claude or Codex chat session.');
		},
		provideTokenCount: async (_model, text) => (typeof text === 'string' ? text.length : 0) / 4,
	});
}
