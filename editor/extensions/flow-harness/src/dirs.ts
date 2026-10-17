/*---------------------------------------------------------------------------------------------
 *  Axle Harness: where the agents keep their own files. Claude Code reads CLAUDE_CONFIG_DIR in
 *  place of ~/.claude (as flow-agent does), and Codex CODEX_HOME in place of ~/.codex, so the
 *  map, the X-ray and the usage counts look where the agents themselves write.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';

/** Claude Code's configuration folder: settings, CLAUDE.md, skills, agents, and the transcripts under projects/. */
export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

/** Codex's home folder: config.toml, AGENTS.md, memories. */
export const codexDir = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
