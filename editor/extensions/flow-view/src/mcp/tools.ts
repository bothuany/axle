/*---------------------------------------------------------------------------------------------
 *  Axle agent bridge: the tools the `axle` MCP server offers a model (they show up as mcp__axle__*).
 *  The descriptions are written for the model: they say when to reach for each tool. All tools only
 *  read, open or display; none writes a file or runs a command. Keep draw_board's schema in sync with
 *  ../board/spec.ts (a test compares the enums).
 *--------------------------------------------------------------------------------------------*/

export interface ToolDef {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	annotations: { title: string; readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
}

export const BOARD_KINDS = ['flow', 'plan', 'class', 'er', 'sequence', 'architecture'] as const;
export const NODE_KINDS = ['entry', 'controller', 'service', 'repository', 'entity', 'dto', 'enum', 'interface', 'class', 'external', 'step', 'decision', 'note', 'actor'] as const;
export const NODE_STATUSES = ['todo', 'doing', 'done', 'skipped', 'blocked'] as const;
export const EDGE_KINDS = ['calls', 'extends', 'implements', 'uses', 'has', 'has-many', 'depends', 'next', 'yes', 'no', 'reads', 'writes', 'message'] as const;

const str = (description: string) => ({ type: 'string', description });
const int = (description: string) => ({ type: 'integer', description, minimum: 1 });

/** What the flow tools accept as the target: an id from find_entry_points, or a place in the code. */
const TARGET = {
	id: str('Entry point id exactly as find_entry_points printed it (preferred).'),
	file: str('Source file (absolute, or relative to the workspace folder). Use with `method` and/or `line`.'),
	method: str('Method or function name in `file`, e.g. "Delete" or "UserService.remove".'),
	line: int('1-based line inside the method (alternative to `method`).'),
};

const ro = (title: string, idempotent = true): ToolDef['annotations'] => ({ title, readOnlyHint: true, destructiveHint: false, idempotentHint: idempotent, openWorldHint: false });

export const BOARD_SCHEMA = {
	type: 'object',
	description: 'The board to draw.',
	properties: {
		kind: { type: 'string', enum: [...BOARD_KINDS], description: 'flow: how a request/process runs · plan: ordered steps to do · class: classes and their relations · er: tables/entities · sequence: messages between actors in order · architecture: layers/services.' },
		title: str('Short title shown above the diagram.'),
		description: str('Optional one or two sentences.'),
		direction: { type: 'string', enum: ['LR', 'TB'], description: 'Left-to-right (default for flows) or top-to-bottom (default for plans).' },
		nodes: {
			type: 'array',
			description: 'At most 400. Each node needs a unique id.',
			items: {
				type: 'object',
				properties: {
					id: str('Unique within the board; edges refer to it.'),
					label: str('Text on the node.'),
					kind: { type: 'string', enum: [...NODE_KINDS], description: 'Picks the shape/colour. For plans use step (default), decision or note.' },
					detail: str('One line under the label.'),
					group: str('Id of a group in `groups` this node belongs to.'),
					file: str('Source file the node stands for (workspace path); clicking it opens the file.'),
					line: int('1-based line in `file`.'),
					status: { type: 'string', enum: [...NODE_STATUSES], description: 'Progress of a plan step. Update later with update_board.' },
					note: str('Longer free text, e.g. what a plan step changes.'),
					members: {
						type: 'array',
						description: 'Fields/methods listed inside a class or entity node.',
						items: {
							type: 'object',
							properties: {
								text: str('e.g. "id: Guid" or "Save(order): void".'),
								kind: { type: 'string', enum: ['field', 'method', 'property'] },
								visibility: { type: 'string', enum: ['+', '-', '#', '~'] },
								ref: str('Id of the node this member refers to.'),
							},
							required: ['text'],
						},
					},
				},
				required: ['id', 'label'],
			},
		},
		edges: {
			type: 'array',
			description: 'Connections between node ids. Edges naming unknown nodes are dropped.',
			items: {
				type: 'object',
				properties: {
					from: str('Node id.'),
					to: str('Node id.'),
					label: str('Text on the arrow.'),
					kind: { type: 'string', enum: [...EDGE_KINDS] },
					fromCard: str('ER cardinality at the `from` end, e.g. "1".'),
					toCard: str('ER cardinality at the `to` end, e.g. "0..*".'),
				},
				required: ['from', 'to'],
			},
		},
		groups: {
			type: 'array',
			description: 'Optional boxes around nodes (a layer, a service, a phase).',
			items: {
				type: 'object',
				properties: { id: str('Group id.'), label: str('Title of the box.'), parent: str('Id of an enclosing group.'), collapsed: { type: 'boolean' } },
				required: ['id', 'label'],
			},
		},
	},
	required: ['title', 'nodes'],
} as const;

export const TOOLS: ToolDef[] = [
	{
		name: 'open',
		description: "Open a file in the user's Axle editor, scrolled to a line and optionally with a line range selected. Use this when the user asks you to open, show or go to a file or place in the IDE/editor. It does not take keyboard focus from the terminal. To show how a feature runs (an endpoint, a job) use show_flow instead.",
		inputSchema: {
			type: 'object',
			properties: {
				file: str('File to open: absolute, or relative to the workspace folder. Must be inside the workspace.'),
				line: int('1-based line to reveal.'),
				endLine: int('1-based last line to select (with `line`).'),
				preview: { type: 'boolean', description: 'Open as a preview tab that the next open replaces (default true). Pass false to keep the tab.' },
			},
			required: ['file'],
			additionalProperties: false,
		},
		annotations: ro('Open file in Axle'),
	},
	{
		name: 'find_entry_points',
		description: "Find the entry points (HTTP endpoints, jobs, listeners) of the open project by a free-text query such as \"delete user\" or \"POST orders\", using Axle's code index. Returns each match with its HTTP verb and route, controller.method, file:line and an `id`. Use it first when the user names a feature (\"the delete-users flow\"), then pass the id to show_flow or flow_text. An empty query lists the entry points.",
		inputSchema: { type: 'object', properties: { query: str('Free text: verbs (delete, create, update, list), nouns (user, order), a route or a class name.'), limit: int('Maximum matches (default 10, at most 50).') }, additionalProperties: false },
		annotations: ro('Find entry points'),
	},
	{
		name: 'show_flow',
		description: 'Open the Axle flow canvas for an entry point or method, so the user SEES the runtime call chain (callers on the left, the method, everything it calls on the right, with the database tables it touches), and return the same call chain as text. Use this when the user asks to open or show a flow in the IDE ("open the delete-users flow"). Pass an `id` from find_entry_points, or `file` plus `method` or `line`.',
		inputSchema: { type: 'object', properties: { ...TARGET, depth: int('How many call levels to include in the returned text (default 6).') }, additionalProperties: false },
		annotations: ro('Show flow in Axle'),
	},
	{
		name: 'flow_text',
		description: 'Return the runtime call chain of an entry point or method as indented text: each step with file:line, calls through interfaces and mediators resolved, and the database tables touched. Does not open anything. Call this BEFORE reading many files to understand how a feature works; one call replaces dozens of reads. Pass an `id` from find_entry_points, or `file` plus `method` or `line`.',
		inputSchema: { type: 'object', properties: { ...TARGET, depth: int('Call levels to include (default 6).') }, additionalProperties: false },
		annotations: ro('Flow as text'),
	},
	{
		name: 'impact',
		description: 'What breaks if this method changes: who calls it (callers, up to `depth` levels) and which entry points (endpoints, jobs) reach it. Use it before editing shared code to know the blast radius. Pass `file` plus `method` or `line`, or an `id` from find_entry_points.',
		inputSchema: { type: 'object', properties: { ...TARGET, depth: int('Caller levels to include (default 3).') }, additionalProperties: false },
		annotations: ro('Change impact'),
	},
	{
		name: 'get_context',
		description: 'What the user is looking at in Axle right now: the active file with cursor and selected text, the flow shown on the canvas, open editor tabs, files changed in git, and a summary of editor errors and warnings. Use it when the user says "this", "here" or "the selected code", or to see which files are in play.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		annotations: ro('Editor context'),
	},
	{
		name: 'draw_board',
		description: 'Draw a diagram that Axle shows to the user next to the editor, like an artifact. Use it in plan mode to show the flow or architecture you designed, when explaining a design, or to lay out a multi-step plan the user can follow. kinds: flow (how something runs), plan (ordered steps with status), class, er (tables), sequence, architecture. Give every node a unique id and a short label; link nodes to code with file (+ line); connect them with edges. Passing the same `id` again replaces that board, so redraw instead of drawing a second copy. Example: {"id":"order-flow","board":{"kind":"flow","title":"Place order","nodes":[{"id":"api","label":"POST /orders","kind":"entry","file":"src/OrdersController.cs","line":24},{"id":"svc","label":"OrderService.Place","kind":"service"},{"id":"db","label":"orders","kind":"entity"}],"edges":[{"from":"api","to":"svc"},{"from":"svc","to":"db","kind":"writes","label":"insert"}]}}. For a plan use kind "plan" with step nodes in order joined by "next" edges, then tick them off with update_board while you work.',
		inputSchema: { type: 'object', properties: { board: BOARD_SCHEMA, id: str('Stable name for the board (letters, digits, - _ . :). Reuse it to replace the board; omit for a new one.') }, required: ['board'], additionalProperties: false },
		annotations: ro('Draw a board', true),
	},
	{
		name: 'update_board',
		description: 'Update one node of a board you drew with draw_board: set its status (todo, doing, done, skipped, blocked) and/or its note. Use it to tick plan steps as you work so the user sees progress on the board.',
		inputSchema: {
			type: 'object',
			properties: {
				id: str('Board id returned by draw_board.'),
				nodeId: str('Node id within that board.'),
				status: { type: 'string', enum: [...NODE_STATUSES], description: 'New status of the node.' },
				note: str('New note text for the node.'),
			},
			required: ['id', 'nodeId'],
			additionalProperties: false,
		},
		annotations: ro('Update a board node'),
	},
];

export const TOOL_NAMES = new Set(TOOLS.map(t => t.name));
