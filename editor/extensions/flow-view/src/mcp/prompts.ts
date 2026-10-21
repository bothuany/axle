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

Use a tour whenever the user asks how something works, to be walked through it or for an explanation ("walk me through how an order is placed", "explain this flow", "anlat", "nasıl çalışıyor"): showing the code beats a long text answer, and the message you write next stays one or two lines.

1. Get the places first. Use \`find_entry_points\`, then \`flow_text\` (or \`find_symbol\`) to learn the call order and the file:line of each method. Do not guess lines.
2. Start at the entry point, or at the user's question, and follow the order the code runs. Do not jump around the file system.
3. One step per idea. If a caption needs "and also", split the step. Aim for 3-12 steps; if it needs more, offer a second tour instead of a longer one.
4. Captions say WHY and WHAT TO WATCH: invariants, side effects, what breaks, what is surprising. Do not restate the code, the user can read it. One or two sentences, at most 600 characters. Short Markdown is fine (\`code\`, **bold**, a list); HTML is not shown.
5. Write the captions in the language the user is writing to you in.
6. Name code by \`file\` + \`method\` (e.g. "OrderService.Place") and add a \`line\` hint inside it. The method survives edits; the line does not. Highlight (\`lines\`) only the few lines the caption is about.
7. For a change you made: say what changed, why, and what you did not test. Order the steps the way a request runs through them (entry first), include the tables a change touches (\`table\`), and end with a step (caption only) about the risks.
8. A step with only a caption is an intro or an outro: the cursor stays where it is and the caption is centred.
9. Read the answer of the tool. Each step is marked ok, moved (the code is somewhere else than your line hint: fine), offflow (not on the drawn flow: it is shown as a side card), or missing (nothing was found: the answer says what is closest). Fix missing steps by calling \`tour\` again with the same \`id\`.
10. The tool returns at once. The user paces the tour; if they ask a question during it, it comes back to you as a new message that names the step and quotes the question.
11. Answer a question with \`tour_control\`: action \`note\` with a short plain-text answer (it is pinned to that step's card, 10 per step at most), action \`go\` with the step that answers it better if there is one, then action \`resume\`. If the answer needs more than a note, start a new tour with \`tour\` instead. The same goes for a question about code the user pointed at: answer by showing, with a tour of 1 to 5 steps that starts at that code.

Example:
{"id":"place-order","title":"How an order is placed","flow":{"id":"<id from find_entry_points>"},"steps":[{"caption":"Placing an order starts at the controller; it only validates and hands over."},{"file":"src/Orders/OrderService.cs","method":"OrderService.Place","line":58,"lines":[[71,76]],"caption":"Prices are copied onto the order here so a later price change cannot alter it."},{"table":"orders","caption":"The only write: a failure after this point leaves the order without its invoice."}]}
`;

const EXPLAIN_CHANGE = [
	"Explain the change you just made as a tour on Axle's flow canvas, so I can follow it.",
	'',
	'1. Know what changed: the files and methods you edited this turn (`get_context` lists the files changed in git; `impact` tells which endpoints and tables a changed method or table reaches).',
	'2. Call `tour` with `flow: {"changes": true}`: the canvas then shows every flow the changed files reach, cut down to the changed cards. One step per changed method, named by `file` + `method`, in the order a request runs through them (the entry first); a `table` step for each changed table.',
	'3. Each caption says WHY the method changed and what could break, in the language I am writing to you in. Highlight (`lines`) the lines you added.',
	'4. End with a caption-only step on the risks: what you did not test, what a reviewer should look at first.',
	'5. Read the answer: fix a step marked missing by calling `tour` again with the same `id`. Follow the advice of the `tour_guide` prompt.',
	'',
].join('\n');

const SKELETON_FIRST = `# Skeleton first in Axle

Skeleton first is an opt-in switch on your row in Axle's agent dock (one per agent). When it is on, the developer writes the structure of a change (types, entities, interfaces, signatures, empty bodies) themselves, so they keep the know-how of their own system. You design, check, explain and fill the bodies. It is never imposed: \`check_skeleton\` says whether it is on, and the developer can say "just do it" at any point. The dock shows no buttons for the stages: the developer drives them by talking to you, and you pass their reply to \`check_skeleton\` as its \`step\`.

1. Before your first edit for a request or an approved plan that adds or changes types, entities or interfaces, in plan mode or not, call \`check_skeleton\` once. A bug fix, a rename, a small edit or a question does not need it. While the switch is on, Axle reminds you of this with each prompt.
2. Off: implement the plan as usual.
3. On: draw your target design with \`draw_board\` (the id it names; kind "class", or "er" for tables). Draw one node per type, with a \`label\` (its name) and kind interface / class / service / repository / entity / dto / enum. Every type you add or change MUST list the members the developer is to write, as signature objects: all fields and methods of a new type, and only the members this change adds to an existing type, e.g. \`"members": [{"text": "findByStatus(status: BillStatus): List<Bill>"}, {"text": "amount: BigDecimal"}]\`. A new type without members is turned down and you are asked to redraw. Add edges for extends / implements / has / has-many / uses. Then STOP. \`draw_board\` answers which types are new and which existing types get which members: tell the developer that in a few short lines, that the design is on the board and they can ask you to change it, that they write those types and signatures with empty bodies and the board colours them as they save, and that they say "check" for a review, "hand over" for you to fill the bodies, or "just do it".
4. If the user asks for a change ("make DiscountPolicy an interface", "remove the repository"), redraw with the same id and stop again. Nothing is edited by dragging: the conversation is how the design changes.
5. The developer then writes the skeleton. Axle works out where each new type goes (the module the plan is about, the package its siblings of the same kind sit in) and shows that path on the node, with a click to create the empty file; draw_board's answer lists the paths: give them to the developer in your reply, and do not invent your own. A type written in another module or package than that is DIFFERS, with the reason. The board colours each planned type and member matches, MISSING or DIFFERS from the real code after every save; a type that was already in the code is "existing" (neutral) and only the members the plan adds to it are coloured. Do not write that code for them.
6. When they ask you to check, call \`check_skeleton\`. Explain each MISSING or DIFFERS line: what the plan intended and why, phrased as a trade-off, not a verdict. Do not edit their files. If they say theirs is better, argue your case with reasons, or, if they are right, redraw the plan so it follows their design. "Differs" is not "wrong".
7. "Just do it" → \`check_skeleton\` with step "just", then implement as usual.
8. "Hand over" → \`check_skeleton\` with step "handover", then fill in the method bodies. Keep every type, signature, name and relation they wrote.
9. After filling, call \`check_skeleton\` again. It lists every declaration of theirs that changed as a numbered warning (the board marks it too). Tell the developer each one in your reply, before → after, and why. "Keep it" → step "accept" with that warning number. "Revert" → put their declaration back exactly as it was, keeping the body; they can also run "Axle: Revert an Agent's Change to Your Declaration".
10. Close with a tour: \`tour\` with \`flow: {"changes": true}\`, one step per method you filled, in the order a request runs through them, and a last caption-only step on what you did not test. When they say they are done → step "finish".

Nothing is scored and nothing leaves the machine.
`;

const PROMPTS: { def: PromptDef; text: (args: Record<string, string>) => string }[] = [
	{
		def: { name: 'skeleton_first', title: 'Skeleton first: how it works', description: 'The skeleton-first flow: when to call check_skeleton, how to draw the design, check the developer\'s skeleton without fixing it, fill the bodies and close with a tour.' },
		text: () => SKELETON_FIRST,
	},
	{
		def: { name: 'tour_guide', title: 'How to make a good Axle tour', description: "Advice for the `tour` tool: what to point at, how to write captions, how to fix a step that was not found." },
		text: () => TOUR_GUIDE,
	},
	{
		def: { name: 'explain_change', title: 'Explain your change as a tour', description: 'Ask the agent to explain the change it just made, step by step, on the flow canvas.' },
		text: () => EXPLAIN_CHANGE,
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
