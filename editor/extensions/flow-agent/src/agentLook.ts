/*---------------------------------------------------------------------------------------------
 *  Axle: how an agent looks on the flow canvas: the name of its row in the dock and the colour of its avatar, for the ghost cursor
 *  of a tour it made. The colours are the avatar's (src/avatars.ts keeps its own table: that file is copied byte for byte into the
 *  core patch, so it is not imported from here). Pure: no vscode.
 *--------------------------------------------------------------------------------------------*/

import type { AgentCli } from './askTarget';

const COLOR: Record<AgentCli, string> = { claude: '#ff9d7d', codex: '#7fe0d6', custom: '#c6a8ff' };

/** What flow-view shows on the cursor of a tour: `label` (at most 40 characters, one line) and `color` (a hex colour). */
export function agentLook(s: { name: string; cli: AgentCli }): { label: string; color: string } {
	// eslint-disable-next-line no-control-regex
	const label = s.name.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 40);
	return { label: label || (s.cli === 'codex' ? 'Codex' : s.cli === 'custom' ? 'Agent' : 'Claude'), color: COLOR[s.cli] ?? COLOR.custom };
}
