/*---------------------------------------------------------------------------------------------
 *  Axle agent bridge: the prompts the `axle` MCP server offers (in Claude Code they appear as /mcp__axle__<name>). They are text
 *  only: a prompt tells the agent how to use the tools, it runs nothing. Pure: no `vscode`.
 *--------------------------------------------------------------------------------------------*/

export interface PromptDef {
	name: string;
	title: string;
	description: string;
	arguments?: { name: string; description: string; required?: boolean }[];
}

const TOUR_GUIDE = `# How to make a good tour with Axle's \`tour\` tool

A tour is you pointing at the code on the user's flow canvas while you talk: a cursor moves from card to card, the rest dims, the lines you name light up and your caption is shown. The user steps through it with the arrow keys.

1. Get the places first. Use \`find_entry_points\`, then \`flow_text\` (or \`find_symbol\`) to learn the call order and the file:line of each method. Do not guess lines.
2. Start at the entry point, or at the user's question, and follow the order the code runs. Do not jump around the file system.
3. One step per idea. If a caption needs "and also", split the step. Aim for 3-12 steps; if it needs more, offer a second tour instead of a longer one.
4. Captions say WHY and WHAT TO WATCH: invariants, side effects, what breaks, what is surprising. Do not restate the code, the user can read it. One or two sentences, at most 600 characters. Plain text; \`code\` in backticks is shown as code.
5. Write the captions in the language the user is writing to you in.
6. Name code by \`file\` + \`method\` (e.g. "OrderService.Place") and add a \`line\` hint inside it. The method survives edits; the line does not. Highlight (\`lines\`) only the few lines the caption is about.
7. For a change you made: say what changed, why, and what you did not test. Order the steps the way a request runs through them (entry first), include the tables a change touches (\`table\`), and end with a step (caption only) about the risks.
8. A step with only a caption is an intro or an outro: the cursor stays where it is and the caption is centred.
9. Read the answer of the tool. Each step is marked ok, moved (the code is somewhere else than your line hint: fine), offflow (not on the drawn flow: it is shown as a side card), or missing (nothing was found: the answer says what is closest). Fix missing steps by calling \`tour\` again with the same \`id\`.
10. The tool returns at once. The user paces the tour; if they ask a question during it, it comes back to you as a new message.

Example:
{"id":"place-order","title":"How an order is placed","flow":{"id":"<id from find_entry_points>"},"steps":[{"caption":"Placing an order starts at the controller; it only validates and hands over."},{"file":"src/Orders/OrderService.cs","method":"OrderService.Place","line":58,"lines":[[71,76]],"caption":"Prices are copied onto the order here so a later price change cannot alter it."},{"table":"orders","caption":"The only write: a failure after this point leaves the order without its invoice."}]}
`;

const PROMPTS: { def: PromptDef; text: (args: Record<string, string>) => string }[] = [
	{
		def: { name: 'tour_guide', title: 'How to make a good Axle tour', description: "Advice for the `tour` tool: what to point at, how to write captions, how to fix a step that was not found." },
		text: () => TOUR_GUIDE,
	},
];

export const promptList = (): PromptDef[] => PROMPTS.map(p => p.def);

/** The messages of a prompt, or nothing when there is no such prompt. */
export function getPrompt(name: unknown, args: Record<string, unknown>): { description: string; messages: { role: 'user'; content: { type: 'text'; text: string } }[] } | undefined {
	const p = PROMPTS.find(x => x.def.name === name);
	if (!p) {
		return undefined;
	}
	const given: Record<string, string> = {};
	for (const a of p.def.arguments ?? []) {
		const v = args[a.name];
		given[a.name] = typeof v === 'string' ? v.slice(0, 2000) : '';
	}
	return { description: p.def.description, messages: [{ role: 'user', content: { type: 'text', text: p.text(given) } }] };
}
