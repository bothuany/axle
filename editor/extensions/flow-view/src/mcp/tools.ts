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
		name: 'open_diff',
		description: "Show git changes in Axle's diff view (a multi-file diff editor), so the user can REVIEW them. Use this when the user asks to open, show or review the diff or the changes in the IDE, including after you finished a piece of work (\"show what you did\"). By default the uncommitted changes against HEAD; `base` \"branch\" shows everything since the branch left main (committed or not), \"last_commit\" the last commit plus anything on top. It covers modified, staged, deleted and brand-new untracked files (no `git add -N` needed) and finds nested git repositories inside the workspace. Pass `files` (files or folders) to narrow it; without it every changed file of every repository is shown. Returns the list of files it opened.",
		inputSchema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' }, description: 'Files or folders to show (absolute, or relative to the workspace folder). Omit for all changes.' }, base: { type: 'string', enum: ['uncommitted', 'branch', 'last_commit'], description: 'What to compare with: uncommitted (HEAD, default), branch (where this branch left main/master; on main itself, its upstream: the unpushed commits) or last_commit (HEAD~1). Use branch or last_commit when your work is already committed.' }, title: str('Title of the diff tab.'), flow: { type: 'boolean', description: "Also show the changes on Axle's flow canvas, all on one canvas: every endpoint flow they reach, cut down to the changed methods, plus changed methods no endpoint reaches; each changed card shows added lines in green and removed lines in red. Use it when the user wants the diff or the work \"in flow\"." } }, additionalProperties: false },
		annotations: ro('Open diff in Axle'),
	},
	{
		name: 'get_diagnostics',
		description: "The errors and warnings Axle's language servers report right now (the Problems panel), for one file or the whole workspace, as `file:line:col severity [source] message`. Use it after editing to check your change compiles and lints, instead of running a build.",
		inputSchema: { type: 'object', properties: { file: str('File to check (absolute, or relative to the workspace folder). Omit for the whole workspace.'), severity: { type: 'string', enum: ['error', 'warning', 'all'], description: 'Lowest-priority severity to include: error (only errors), warning (errors and warnings, default) or all (also info and hints).' }, limit: int('Maximum lines (default 100, at most 500).') }, additionalProperties: false },
		annotations: ro('Get diagnostics'),
	},
	{
		name: 'find_symbol',
		description: "Search the workspace's symbols (classes, methods, functions, fields) by name with the language servers, e.g. \"OrderService\" or \"Delete\". Returns kind, name, container and file:line. Faster and more precise than grep for \"where is X defined\".",
		inputSchema: { type: 'object', properties: { query: str('Symbol name or part of it.'), limit: int('Maximum matches (default 30, at most 100).') }, required: ['query'], additionalProperties: false },
		annotations: ro('Find symbol'),
	},
	{
		name: 'go_to_definition',
		description: "Where a symbol is defined, with its type/signature and the first lines of its definition, using the language servers (so it follows interfaces, imports and generics like the editor's F12). Give `file` and `line`, plus `symbol` (the identifier on that line) to pick which one.",
		inputSchema: { type: 'object', properties: { file: str('File that uses the symbol.'), line: int('1-based line of the usage.'), symbol: str('The identifier on that line (first occurrence). Without it the first token on the line is used.'), column: int('1-based column, instead of `symbol`.') }, required: ['file', 'line'], additionalProperties: false },
		annotations: ro('Go to definition'),
	},
	{
		name: 'find_references',
		description: "Every place that uses a symbol, with the line of code, using the language servers. Use it before changing or renaming something. Give `file` and `line`, plus `symbol` (the identifier on that line) to pick which one. For who calls a method through the whole flow (interfaces, mediators) prefer `impact`.",
		inputSchema: { type: 'object', properties: { file: str('File that declares or uses the symbol.'), line: int('1-based line.'), symbol: str('The identifier on that line (first occurrence).'), column: int('1-based column, instead of `symbol`.'), limit: int('Maximum references (default 40, at most 150).') }, required: ['file', 'line'], additionalProperties: false },
		annotations: ro('Find references'),
	},
	{
		name: 'find_entry_points',
		description: "Find the entry points (HTTP endpoints, jobs, listeners) of the open project by a free-text query such as \"delete user\" or \"POST orders\", using Axle's code index. Returns each match with its HTTP verb and route, controller.method, file:line and an `id`. Use it first when the user names a feature (\"the delete-users flow\"), then pass the id to show_flow or flow_text. An empty query lists the entry points.",
		inputSchema: { type: 'object', properties: { query: str('Free text: verbs (delete, create, update, list), nouns (user, order), a route or a class name.'), limit: int('Maximum matches (default 10, at most 50).') }, additionalProperties: false },
		annotations: ro('Find entry points'),
	},
	{
		name: 'show_flow',
		description: 'Open the Axle flow canvas for an entry point or method, so the user SEES the runtime call chain (callers on the left, the method, everything it calls on the right, with the database tables it touches), and return the same call chain as text. Use this when the user asks to open a flow in the IDE ("open the delete-users flow"). To explain how it works, walk the user through it with `tour`. Pass an `id` from find_entry_points, or `file` plus `method` or `line`.',
		inputSchema: { type: 'object', properties: { ...TARGET, depth: int('How many call levels to include in the returned text (default 6).') }, additionalProperties: false },
		annotations: ro('Show flow in Axle'),
	},
	{
		name: 'flow_text',
		description: 'Return the runtime call chain of an entry point or method as indented text: each step with file:line, calls through interfaces and mediators resolved, and the database tables touched. Does not open anything. Call this BEFORE reading many files to understand how a feature works; one call replaces dozens of reads. To explain a feature to the user, do not paste this text: SHOW it with `tour`. Pass an `id` from find_entry_points, or `file` plus `method` or `line`.',
		inputSchema: { type: 'object', properties: { ...TARGET, depth: int('Call levels to include (default 6).') }, additionalProperties: false },
		annotations: ro('Flow as text'),
	},
	{
		name: 'impact',
		description: 'What breaks if this changes. For a method: who calls it (callers, up to `depth` levels) and which entry points (endpoints, jobs) reach it; pass `file` plus `method` or `line`, or an `id` from find_entry_points. For a table: pass `table` (a table name) or `entity` (an entity or model class) to get the endpoints that write it and the endpoints that read it, each with the method and database card it goes through; a guessed link (raw SQL, a naming default) is marked ~table?. It follows ORM calls and string SQL only, and says what it did not check (dynamic SQL, views, other services, migrations). A migration file or an entity file alone (`file` without `method` or `line`) gives the same for the tables it changes: what the migration does to each table (adds, drops, renames), the endpoints that use it, and the code that may still use a column it drops. Use it before editing shared code, an entity, a migration or a column to know the blast radius.',
		inputSchema: { type: 'object', properties: { ...TARGET, depth: int('Caller levels to include (default 3).'), table: str('A table name, e.g. "orders" (case and schema prefix ignored). Instead of a method.'), entity: str('An entity or model class name, e.g. "Order". Instead of a method.') }, additionalProperties: false },
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
	{
		name: 'tour',
		description: "The way to EXPLAIN code to the user in Axle: a narrated walkthrough on the flow canvas, where a cursor moves from card to card, dims the rest, highlights lines and shows your caption. Use it INSTEAD of a long text answer whenever the user asks how something works or to be walked through it (\"walk me through how an order is placed\", \"how does X work\", \"explain this flow\", \"show me\", \"anlat\", \"bana göster\", \"nasıl çalışıyor\"), after finishing work (\"explain what you changed\"), or to answer a question about code by SHOWING it; then keep your own message to one line. Get file:line from flow_text or find_symbol first. 3-12 steps, one idea each, in the order the code runs; captions say WHY and what to watch, not what the code says, in the user's language. Name each step's code by `file` + `method` (preferred: it survives edits) with a `line` hint, and `lines` for the few lines the caption talks about; a step with only a caption is an intro or an outro; `table` points at a database card. The tool returns at once with each step marked ok / moved / missing / offflow: fix a missing step by calling tour again with the same id. The user steps through it; questions they ask come back to you as a new message. Run the `tour_guide` prompt for the full advice.",
		inputSchema: {
			type: 'object',
			properties: {
				id: str('Stable name (letters, digits, - _ .). Reuse it to replace the tour.'),
				title: { type: 'string', maxLength: 120, description: 'What the tour is about.' },
				flow: {
					type: 'object',
					description: 'The canvas to play on. Omit to stay on the canvas the user has open, or to let Axle open the flow of the first step. Use {"changes": true} for the current git changes.',
					properties: {
						id: str('Entry point id from find_entry_points.'),
						file: str('Source file of the method whose flow to show. Use with `method` or `line`.'),
						method: str('Method or function name in `file`.'),
						line: int('1-based line inside the method.'),
						changes: { type: 'boolean', description: 'Play on the change set (the flows the changed files reach, cut down to the changed cards).' },
						base: { type: 'string', enum: ['uncommitted', 'branch', 'last_commit'], description: 'With changes: what they are measured against (default uncommitted).' },
					},
					additionalProperties: false,
				},
				steps: {
					type: 'array', minItems: 1, maxItems: 30,
					items: {
						type: 'object',
						properties: {
							file: str('Workspace file of the code this step points at.'),
							method: str('Method or function, e.g. "OrderService.Place". Preferred: survives edits.'),
							line: int('1-based line inside the method (a hint when method is given).'),
							lines: { type: 'array', maxItems: 3, description: 'Line ranges to highlight, current-file 1-based, e.g. [[42,47]].', items: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1, maxItems: 2 } },
							table: str('A database card instead of code: the table name.'),
							title: { type: 'string', maxLength: 80, description: 'Short label for the step list; defaults to the method.' },
							caption: { type: 'string', maxLength: 600, description: 'What to say here: one or two sentences on WHY, not a restatement of the code. Plain text; `code` in backticks is shown as code.' },
						},
						required: ['caption'],
						additionalProperties: false,
					},
				},
				start: int('Step to open on (default 1).'),
			},
			required: ['title', 'steps'],
			additionalProperties: false,
		},
		annotations: ro('Play a tour in Axle'),
	},
	{
		name: 'check_skeleton',
		description: "Skeleton first, the developer's choice in Axle to write the structure of a change themselves. Call it ONCE right after the user approves a plan that adds or changes types, entities or interfaces, BEFORE you create or edit any file; it answers at once. If Axle says skeleton first is off, implement as usual. If it is on, it tells you to draw the design with draw_board and stop; later calls return the developer's skeleton against your design as a structured diff (each type and member matches, MISSING or DIFFERS, with what the code has), which you explain without fixing their code. Read-only.",
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		annotations: ro('Check the skeleton', false),
	},
	{
		name: 'tour_control',
		description: "Drive the tour you started with `tour`, or answer the user's question during it. go: jump the user to a step (only while they are paused or waiting for your answer: the user paces the tour, so do not fight them) · note: pin your answer to a step's card, shown until the tour ends (plain text) · resume: continue after a question · end: close it. When the user asks a question during the tour it comes to you as a message: answer with note (for the step they asked about, and go to a step that answers it better), then resume; if the answer needs more than a note, start a new tour. Returns where the user is and whether they paused.",
		inputSchema: {
			type: 'object',
			properties: {
				id: str('Tour id.'),
				action: { type: 'string', enum: ['go', 'note', 'resume', 'end'] },
				step: int('go: the step to jump to; note: the step the note is for (default: the step the user is on). 1-based.'),
				text: { type: 'string', maxLength: 2000, description: 'note: your answer, plain text, a few sentences.' },
			},
			required: ['id', 'action'],
			additionalProperties: false,
		},
		annotations: ro('Control the tour', false),
	},
];

export const TOOL_NAMES = new Set(TOOLS.map(t => t.name));
