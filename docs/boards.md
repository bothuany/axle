# Boards: the diagram format agents draw

An agent draws a board with the `draw_board` tool of the `axle` MCP server (`editor/extensions/flow-view/src/mcp`). The board is JSON, checked by `parseBoard` (`src/board/spec.ts`, mirrored byte for byte in `ui/src/board/spec.ts`), laid out automatically (agents never send coordinates) and drawn by the board canvas (`ui/src/board`). The research behind the design is `docs/research/agent-diagrams.md`.

`version: 1` stays: every field below is optional and old boards parse unchanged.

## Board

| Field | Meaning |
| --- | --- |
| `kind` | `flow`, `plan`, `class`, `er`, `sequence`, `architecture`, `state`. An unknown kind is drawn as `flow` and the answer says so. |
| `title`, `description`, `direction` | As before (`LR` or `TB`). |
| `level` | `architecture` only (C4): `context`, `container`, `component`. |
| `legend` | `[{ key, text }]`: what an agent's own colours or edge kinds mean. |
| `focus` | Node or group id opened first. |
| `base` | Id of another board to compare with: the host marks what is added, removed or changed (phase 4). |
| `steps` | `[{ title, caption, nodes?, edges?: [from, to][], focus? }]`: played like a tour (phase 3). |
| `highlight` | `[{ path: [id, ...], label? }]`: a route drawn bold, the rest dimmed. |
| `callouts` | `[{ node | edge: [from, to], text }]`: a note drawn as a bubble on a node or an edge. |

## Node

`id`, `label`, `kind`, `detail`, `group`, `file`, `line`, `status`, `members`, `note` as before; `status` and `note` work on every kind of board.

| Field | Meaning |
| --- | --- |
| `symbol` | A real code symbol (`OrderService.Place`). `draw_board` checks it against the index, fills `file` and `line` when the node has none, and suggests the closest symbols when it is not found. Leave it off for something that does not exist yet. |
| `tech` | C4: the technology, shown as `[tech]` under the label. |
| `shape` | `rect`, `round`, `diamond`, `cylinder`, `actor`, `cloud`, `initial`, `final`, `choice`. `initial`, `final` and `choice` are small marks without text (the label is the tooltip). |
| `change` | `added`, `removed`, `changed`. The host fills it for a board with a `base`; an agent may set it on a proposed design. |
| `lane` | Id of a group of kind `lane` (swimlane). |
| `zoom` | Id of the board that shows this box one level down (C4). |

## Edge

`from`, `to`, `label`, `kind`, `fromCard`, `toCard` as before.

| Field | Meaning |
| --- | --- |
| `order` | 1, 2, 3...: shown as a number badge; a sequence is drawn in this order; the default step order. |
| `style` | `solid`, `dashed` (a return or reply), `dotted`. |
| `async` | An asynchronous message: open arrow head. |
| `guard` | A state transition's condition, shown as `[guard]` before the label. |
| `change` | `added`, `removed`, `changed`. |
| `fragment` | Sequence: id of the `alt`, `loop` or `opt` group this message sits in. |

## Group

`id`, `label`, `parent`, `collapsed` as before.

| Field | Meaning |
| --- | --- |
| `kind` | `boundary` (C4), `lane`, `layer`, and the sequence fragments `alt`, `loop`, `opt`. |
| `tech` | C4: the technology of a boundary. |

A fragment boxes the messages whose `fragment` names it; its label is the condition. A group of the same kind whose `parent` is an `alt` group is that alt's else branch.

## What the answer of `draw_board` says

The first line names the board: `Board "id" drawn ...: kind, N nodes, M edges, V visible, ~C crossings.` Then a numbered `LINT` list (at most 10 lines, errors first):

- what `parseBoard` dropped or changed (an unknown kind, status, shape or style; an edge to a node that does not exist, with the nearest id; a duplicate id; a step or callout that names nothing);
- files that are outside the workspace or do not exist, a `line` past the end of the file, symbols that are not in the index (with the closest ones);
- orphan nodes, two nodes with the same label, unlabelled flow or sequence edges, a decision with fewer than two branches, a plan with a cycle, empty or single-node groups, nesting deeper than 2;
- more than 25 visible nodes, more than 35 edges, more than 12 estimated crossings, more than 8 lifelines, a sequence without `order`;
- hints: no initial state, no `tech` on a C4 container, no `steps` on a board of more than 6 nodes, nothing linked to code.

Draw again with the same `id` to fix it. The previous version of a board is kept in memory (`StoredBoard.previous`).

`update_board` changes a node's `status`, `note` or `change`, takes several nodes in `updates`, and sets the `highlight` routes, without a redraw.

The `diagram_guide` MCP prompt (`src/mcp/prompts.ts`) holds the full advice an agent gets.
