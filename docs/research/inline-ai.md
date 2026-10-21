# Selection actions: "ask AI" and "edit inline with AI"

Question: when code is selected, in the editor or on a flow card, what should Axle offer? Cursor-like actions, adapted to an editor that has no model of its own and drives agents (Claude Code, Codex) through the dock.

## What others do

Written from the products' documented behaviour; none of it was run for this note.

| Product | On a selection | Edit | Context handed to the model |
|---|---|---|---|
| Cursor | A hint pops up: **Add to chat** (Ctrl+L) and **Edit** (Ctrl+K). | Ctrl+K opens a one-line prompt at the selection; the model rewrites the lines and they show as a red/green inline diff with Accept / Reject. | File, lines and text are attached as a chip in the chat. |
| VS Code Copilot | Lightbulb / right-click: **Explain**, **Fix**, **Generate Tests**, **Generate Docs**; Ctrl+I opens inline chat. | Inline chat shows a diff in the editor with Accept / Discard. | Selection plus the open file. |
| Zed | Ctrl+Enter inline assist on the selection (or the cursor). | The model streams into the buffer, tinted; Accept is "leave it", Undo is the reject. | Selection, plus anything added to the thread. |
| Windsurf | Cmd+I inline Cascade edit; "Explain" and "Refactor" code lenses above a function. | Inline diff with Accept / Reject. | Selection and the surrounding file. |
| JetBrains AI | Context-menu AI Actions: Explain Code, Suggest Refactoring, Find Problems, Generate Tests; Alt+Enter on a problem. | Applied through a diff you can review. | Selection plus the project index. |
| Claude Code IDE integration | The selection is shared with the connected CLI; `Alt+Ctrl+K` (Cmd+Alt+K) inserts an `@file#L5-10` mention. | The CLI proposes a file edit; the IDE shows a diff tab and the user accepts or rejects. | Current selection and open files, by mention. |

Common shape: **(1)** a selection-bound entry point (hint, lightbulb, context menu, key), **(2)** one small prompt box at the selection, **(3)** the answer goes to a chat (ask) or to a reviewable diff (edit), **(4)** the selection travels as file + lines, not pasted text.

## What fits Axle

Axle already has the plumbing for 2 to 4:

- `flow.agents.ask` sends a line of text (and files) to the agent the user picked, a running session or a new one, with a picker the first time. It handles busy sessions, the clipboard fallback and `oneLine` sanitising.
- Edits an agent makes in a terminal are tracked (`willEdit` / `didEdit`) and shown as a diff with Keep / Undo on the canvas; Claude's own `openDiff` shows a diff to accept or reject (`ide.ts`). The "diff to accept" is therefore already built; we only have to *route the request*.
- Point-and-ask on a card (`pointAsk`) and `?` with lines selected: the answer comes back as a tour. `flow.ide.mention` is the @-mention.

So the selection actions are thin: build a good prompt from a file and a line range and hand it to `flow.agents.ask`.

### Chosen set (MVP)

1. **Ask** — "ask about this selection"; the agent answers with a tour starting at that code (the same prompt point-and-ask uses).
2. **Explain** — Ask without typing: one click, the agent walks through the selection as a tour. This is the "Explain" of Copilot / JetBrains, done the way Axle explains things.
3. **Edit with agent…** — the Cmd-K equivalent: a one-line instruction; the agent edits *only those lines*; the change arrives as the usual reviewable diff (Claude `openDiff`, or the canvas Keep / Undo for any agent).
4. **Add to agent context** — existing `flow.ide.mention` (kept as is).

Entry points:

- **Editor**: right-click menu group "Axle", a lightbulb code action on a non-empty selection (the selection hint; no extra UI of our own to maintain), and keys `Ctrl+Alt+A` (ask), `Ctrl+Alt+J` (edit); `Ctrl+Alt+I` is VS Code's chat view and `Ctrl+K` is a chord prefix, so neither is taken.
- **Flow card**: select lines in a card's code and a small bar appears next to the selection: Ask · Explain · Edit · Mention. Ask and Edit open the existing point-and-ask box (Edit with its own placeholder); Explain and Mention send at once.

Both paths go through one prompt builder (`src/tour/ask.ts`), so the host builds the text; the canvas only says a file, lines and a kind.

### Not building, and why

- **A streaming in-buffer diff of our own, and Accept/Reject decorations.** Axle has no model; an agent edits files through its own tools, and the review UI for that (diff tab, canvas Keep/Undo, timeline) exists. A second review surface would disagree with it.
- **Tab / ghost-text completion.** Needs a low-latency model; agents in terminals are not one.
- **Pasting the selected text into the prompt.** The agent reads the file; the prompt carries `path:lines` and `@file` mentions. It keeps the prompt on one line, short, and free of whatever the code contains.
- **Generate tests / docs / Fix as separate actions.** They are Edit with a sentence; an instruction box covers them without three more commands to maintain. Revisit if people ask.
- **Our own chat panel for answers.** Answers are tours or the agent's terminal.
- **Selection actions in diff editors, notebooks and terminals.** Out of scope for the MVP.

## What "accept the diff" means here

The review is the one that already exists, and it depends on the agent. Claude Code connected through `/ide` in a mode that asks before editing shows its diff tab first (accept or reject before the edit lands). Codex, or Claude in an auto-accept mode, edit straight away and the review is the canvas Keep / Undo after the fact. Edit with agent does not change which of the two happens; it only says which lines.

## Safety

- Canvas → host messages carry no text from the code: file (checked to be inside the workspace), whole line numbers, a kind from a fixed set and a short plain-text instruction. The host builds the prompt and quotes the instruction as the user's words.
- Everything sent to a terminal goes through `oneLine`.
- No new command id is taken from a webview; the new message types are not commands.

## Probe (web mode, Claude Haiku 5.5 started per session through `ANTHROPIC_MODEL`)

- Editor: select lines 17-18 of `server/orders.js`, right-click shows Edit / Ask / Explain / Mention under "Axle"; Edit asks for an instruction, the picker offers a new Claude Code session, the prompt (`server/orders.js:17-18 … edit only those lines`) is typed into it. The session added the 404 guard to `refundOrder` and touched nothing else (`git diff`: one line). It ran in auto-accept mode, so the review is after the fact (git / canvas Keep-Undo), as described above. Screenshots:.
- Card (real mouse drag in the web-mode pane, a real Claude Code session on Haiku 5.5): select lines 12-13 of a card's code, the bar shows (Ask · Explain · Edit · @). Explain: the agent answered with a 3-step tour on the canvas, the first note being "Explain this code." Ask: the box shows "lines 12-13", the question became the first note of the tour the agent made. Edit: "throw an Error when the response is not ok" changed `web/src/api.js` (3 added, 1 removed lines), the card showed the change in red/green with "Review 1 change", and Keep accepted it. Screenshots:.
- Found on the way: a mouse drag in a card panned the canvas and the text was not selectable at all (React Flow sets `user-select: none` on nodes), so selecting lines in a card never worked; the code view is now `nodrag nopan` with `user-select: text`.
- Not covered: a selection inside a card that is being edited (Monaco) gets no bar; Codex was not run. In the web-mode pane the Enter that submits a typed prompt to Claude sometimes has to be sent by hand (once or twice); the typing itself is flow-agent's existing `typeInto`.
