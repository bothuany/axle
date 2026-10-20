/*---------------------------------------------------------------------------------------------
 *  Axle: skeleton first on the agent's side. The dock only has a Skeleton button per agent (on or off); the stages are driven by the
 *  developer talking to the agent, and flow-view's check_skeleton tells the agent what to do at each one. What lives here are the
 *  reminders the hooks hand Claude while the button is on. Pure (no vscode): tested on its own (test/skeleton.test.mjs, hookScript.test.mjs).
 *  See docs/design/skeleton-first.md.
 *--------------------------------------------------------------------------------------------*/

/**
 * What Claude Code reads with every prompt while the switch is on (a UserPromptSubmit hook), so the gate holds outside plan mode too.
 * Short on purpose: it rides along with each prompt. A request that adds no types is not held up by it.
 */
export const SKELETON_PROMPT_GATE = 'Axle: skeleton first is ON. Before your first edit for a change that adds or changes types, entities or interfaces, call the axle MCP tool check_skeleton (mcp__axle__check_skeleton) and follow its answer. When the developer says "check", "hand over", "just do it" or "done" about it, call check_skeleton with that step. Bug fixes, small edits, questions: as usual.';

/**
 * What Claude Code reads right after the user approves a plan while the switch is on (a PostToolUse hook on ExitPlanMode). The
 * server instructions say the same, but a small model goes straight to its first edit without this.
 */
export const SKELETON_GATE = 'Axle: skeleton first is ON (the developer chose it). Before you create or edit any file for this plan, call the axle MCP tool check_skeleton once (mcp__axle__check_skeleton; load it with ToolSearch if it is not loaded yet) and follow its answer. If the plan adds or changes no types, entities or interfaces, it tells you to go ahead as usual.';

/** Every reminder a hook may hand Claude, by the hook event it answers. The hook script prints these exact texts and nothing else. */
export const HOOK_CONTEXT: Readonly<Record<'PostToolUse' | 'UserPromptSubmit', string>> = { PostToolUse: SKELETON_GATE, UserPromptSubmit: SKELETON_PROMPT_GATE };
