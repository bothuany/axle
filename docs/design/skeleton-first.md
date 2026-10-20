# Skeleton first (variant A)

Status: built on `claude/skeleton-first-067ed6`, on top of guided tours (PR #8). Written 2026-10-20.

Research: `docs/research/skeleton-first-landscape.md` and `skeleton-first-council.md` (in the main checkout, not committed).

## The problem

AI writes so much code that developers lose the know-how of their own system. Skeleton first is an opt-in mode in which the developer writes the *structure* of a change themselves: the types, entities, interfaces and signatures. The agent designs it, checks it, explains it and fills the bodies.

## The user's decisions

1. **Variant A order.** After a plan is approved, the agent draws the target design (class or ER) with `draw_board`. The developer then writes the skeleton in the editor: types, entities, interfaces, signatures, empty bodies.
2. **The diagram is corrected by talking.** "Make DiscountPolicy an interface", "remove the repository": the agent redraws the same board. This repeats until the developer accepts it. Nothing is edited by dragging.
3. **An on/off switch, never imposed, per agent.** Each agent row in the dock has one "Skeleton" button (pressed when on), explained in its tooltip, and nothing else. The setting `axle.skeletonFirst.enabled` (default off) is only the starting value for an agent nobody has switched. When it is on for an agent, the mode is offered only when the plan adds or changes types, entities or interfaces. "Just do it" is always one sentence to the agent. Turning it off takes effect at once.
4. **Live plan vs actual.** While the developer writes, the board is recomputed from the real type index on every save. Each type and member is marked **matches**, **missing** or **differs**. The diagram is the plan and the code is the truth; nothing round-trips.
5. **Check.** The developer says "check"; the MCP tool `check_skeleton` returns the structured diff. The agent explains each difference with a reason and does not fix the code. When the developer answers "mine is better", the agent argues its case or updates the plan.
6. **Hand over.** The agent fills the bodies. There is **no lock, only a warning**: if the agent changes a signature, a name or a relation the developer wrote, a passive warning shows on the board and in the agent's own reply, with the before and after text; keep or revert is the developer's call.
7. **A closing tour** of what was filled, with the `tour` tool.
8. **No scores, no metrics, nothing leaves the machine.**

The council's main objection: in variant A the developer types out a design they have already seen, which is transcription rather than generation. The user chose A knowingly, so it is built as decided. The way to test the objection later is to swap steps 1 and 2: the developer sketches first and the agent reveals its design afterwards.

## The gate: an MCP handshake before the first edit, in any mode

Claude Code keeps working in the same turn after the user approves `ExitPlanMode`. Axle's hooks only observe, so `PostToolUse ExitPlanMode` fires after the agent is already on its way to its first edit. The dock cannot type into a working session either. A dock-only gate would therefore come too late. Hooking `ExitPlanMode` is also version-dependent, and Codex has no such tool. And many requests never go through plan mode at all.

So the gate is something the agent does **before its first edit**, plan mode or not: it calls `check_skeleton`.

- The server instructions (`src/mcp/protocol.ts`) and the `skeleton_first` MCP prompt say: before your first edit for a request or an approved plan that adds or changes types, entities or interfaces, call `check_skeleton` once. A bug fix, a small edit or a question does not need it.
- The tool reads the live setting in the window, not anything fixed when the MCP server started, so turning the mode off works at once:
  - **Off:** "Skeleton first is off: implement the plan as usual." One fast call, nothing else.
  - **On, no design yet:** "Draw the design with `draw_board` (id `skeleton-…`, kind class or er, members as signatures), then STOP and tell the user in one line." The agent tells the developer, in two or three lines, what to do next and what to say.
  - **Later:** the diff (see Check).
- After that the developer drives the stages by talking to the agent: "check", "hand over", "just do it", "done", "keep it", "revert". The agent passes the reply to `check_skeleton` as its `step` (`handover`, `just`, `finish`, `accept` with a warning number); the window moves the stage. Every answer repeats what the next replies map to, and the prompt-time reminder says the same, so a small model stays in step.

The instructions alone are not enough. In the first probe, Haiku went straight from plan approval to writing `Order.ts` and never called the tool. So for Claude Code the dock adds two reminders while the switch is on for that agent (`flow-agent/src/skeleton.ts`, `HOOK_CONTEXT`):
- **With every prompt** (`UserPromptSubmit`): "skeleton first is ON. If this request makes you add or change types, entities or interfaces, call `check_skeleton` once before your first edit… For a bug fix, a small edit or a question, go ahead as usual." This is what makes it work outside plan mode. It is under 400 characters, since it rides along with each prompt.
- **When a plan is approved** (`PostToolUse` on `ExitPlanMode`): the same rule for the plan just approved.

The hooks still decide nothing. They are not a lock and never deny; they only hand the agent text to read. The hook script (`flow-agent/src/hookScript.ts`, tested end to end in `test/hookScript.test.mjs`) is strict about what it prints:
- only those two exact texts, each for its own event;
- a reply over 8000 characters is dropped whole;
- any other text, a reminder on the wrong event, or a decision field prints nothing.

So whatever else answers on the hook port cannot put words into the agent's context. With the agent's switch off, every event answers `{}` as before.

In the probes, Haiku called the tool before its first edit, both after plan approval and for a plain request outside plan mode.

Codex gets neither reminder (its hooks are separate and not wired for this), so it relies on the server instructions alone. The limit for any agent: one that skips the call just implements the plan as usual. Nothing is forced, and the tool's answer is the only thing that stops the agent.

## Stages

Per agent session, held in the window's memory (`src/skeleton/sessions.ts`). A window reload loses them.

| Stage | Entered by | `check_skeleton` answers |
| --- | --- | --- |
| (none) | | Off, or "draw the design and stop, and tell the developer what to say" (the stage becomes `design`) |
| `design` | The agent's first `check_skeleton` while its switch is on | The same, until a class or ER board is drawn |
| `skeleton` | The agent drew the design (the board colours it at once: everything missing until written) | The diff, "explain, do not fix", and the replies mapped to steps |
| `handover` | Step `handover` (the developer said "hand over") | The diff, numbered warnings, "fill the bodies, keep the signatures, report each warning, close with a tour" |

- Step `just` drops the stage ("implement as usual"); step `finish` drops it at the end.
- Turning an agent's switch off ends its stage at once (the board loses its colours); other agents keep theirs. `check_skeleton` asks the dock for that agent's switch (`flow.agents.skeletonOn`); an agent Axle did not start has no switch and follows the setting.

## Plan vs actual: the matcher

`src/skeleton/match.ts` is pure (no `vscode`). It takes the plan board (a `BoardSpec` of kind class or er) and the `TypeGraph`, and returns one result per node and per member.

- **Types** are matched by name: case-insensitive, with the qualified prefix ignored.
  - When two types share the name, the one in a file changed since the design was drawn wins. Otherwise the result says it is ambiguous; it never picks silently.
  - A type with no exact name match is matched to an unplanned type of a similar name, in which the planned members mostly appear. It is then marked **differs (renamed?)**.
- **Kinds.** A planned `interface` or `enum` must be one. All the class-like roles are the same here: class, service, controller, repository, entity and dto may be a class, record or struct. Any other combination **differs**.
- **Members.** The planned text is parsed in either style: `name(T a, U b): R`, `R name(T a)`, `name: T` or `T name`.
  - A field and a property are the same thing. A planned property also matches a Java getter (`getName`/`isName`).
  - Parameter names and package qualifiers are ignored, as is whitespace.
  - Types are compared by the identifiers they are made of. Collection wrappers are equal to each other (`List<T>`, `T[]`, `IEnumerable<T>`, `Set<T>`, `Sequence[T]`), and so are optional ones (`T?`, `Optional<T>`, `T | null`, `Optional[T]`).
  - A different parameter count or type, or a different return or field type, is **differs**, and the actual text is shown.
  - An unmatched planned member and an unmatched actual member with the same shape are a rename: **differs (renamed?)**.
  - Extra members are fine: private ones, constructors and accessors are ignored, and extra public members are listed but never coloured.
- **Relations.** `extends`/`implements` edges are checked against the type's supers. `has`/`has-many`/`uses`/`depends` edges are checked against the graph's edges between the two types (field, method, constructor or generic). A missing relation makes its node **differs**.
- **Node colour.**
  - **differs** when anything differs.
  - Otherwise **missing** when the type or any planned member is missing.
  - Otherwise **matches**.
- When the index is still building, the answer is "not checked yet", never "missing". False reds would teach people to ignore the colours.

The board is recomputed from the index after every save of a file the index reads (`TypeService.refreshFiles`). The plan stays as the agent drew it in `BoardStore`. A decorator adds `check` and `checkNote` to the copy that is shown. These fields are host-only: `parseBoard` drops them, so an agent cannot paint its own board green.

Languages: whatever the type graph covers, which is Java, TypeScript/JavaScript, Python, Go, PHP, Ruby and Rust through the code index, and C# through the analyzer. Golden tests cover Java, TypeScript, Python and C#.

## Check and "mine is better"

The developer says "check". The agent calls `check_skeleton`, explains each difference with a reason phrased as a trade-off, and does not edit any file. If the developer says theirs is better, the agent argues its case or, if it agrees, redraws the plan with the same board id. The board recolours from the new plan straight away.

## Hand over and the signature warning

The developer says "hand over"; the agent calls `check_skeleton` with step `handover`. The window records the developer's own declarations: for each planned type and member that exists in the code now, its file and header text (the declaration lines up to `{`, `;`, `=>` or a trailing `:`). The answer tells the agent to fill the bodies and keep every signature, name and relation.

- After each agent edit (flow-agent's `flow.agent.edited`, after the tool ran), the files it touched are re-read.
- A recorded header that is no longer in its file is a **warning**: changed, renamed, or removed, numbered, with the before text and the after text.
- When the developer saves a file in the editor, the recorded headers in that file are taken from it again. The developer's own changes are never warned about.
- Warnings are passive. They never block, steal focus or pop up. They show:
  - **on the board**, as an amber mark on the member, its tooltip naming the change and how to put it back;
  - **in the agent's reply**: after filling, the agent calls `check_skeleton` again, which lists the numbered warnings, and tells the developer each one, before → after, and why.
- The developer answers in the chat. "Keep it" → step `accept` with the warning number (the new header becomes the recorded one). "Revert" → the agent puts the recorded header back, keeping the body.
- **Revert without the agent:** the command **Axle: Revert an Agent's Change to Your Declaration** lists the warnings. It writes the recorded header back over the current declaration lines only, never the whole file, and refuses a file with unsaved changes or one that moved on since the warning. It is a command the developer runs, never an MCP tool, because tools write nothing.

## The closing tour

The hand-over answer ends with "play a closing tour with `tour` on `{"changes": true}`: one step per filled method". The developer can ask for it again in the chat.

## Pieces

| Piece | Where |
| --- | --- |
| Matcher, header guard, stages (pure) | `flow-view/src/skeleton/{match,guard,sessions}.ts` |
| Host: graph refresh, board decorator, steps, the Revert command | `flow-view/src/skeletonHost.ts` |
| `check_skeleton` tool (with `step`), `skeleton_first` prompt, instructions | `flow-view/src/mcp/{tools,handlers,prompts,protocol,register}.ts` |
| `check` and `checkNote` on board nodes and members | `flow-view/src/board/spec.ts` = `ui/src/board/spec.ts`, rendered in `ui/src/board/cards.tsx` |
| The Skeleton button, the per-agent switch, the hook reminders | `flow-agent/src/{skeleton,hookScript,dockMessage,dockPage,dock,agents}.ts`, the setting in `flow-agent/package.json` |

Commands across the boundary (all registered, checked by `test/arch/commands.test.mjs`):
- flow-view → flow-agent: `flow.agents.skeletonOn` (this agent's switch).
- flow-agent → flow-view: `flow.skeleton.finish` (the switch went off).

## Out of scope

- Locks.
- Diagram editing and stub generation (variant B).
- Levels.
- Team policy.
- Any record that outlives the window.
- The council's sketch-first ordering.

## Probe (2026-10-20)

The probe ran in web mode with a real Claude Code session (Haiku 5.5, set in the demo project's `.claude/settings.json`) on a TypeScript change to the demo shop. All eight steps worked:

1. **Switch on.**
2. **Plan, then the design.** The plan was approved, then Haiku called `check_skeleton`, drew a 6-type class board and stopped. This needed the approval-time reminder: without it, Haiku went straight to writing.
3. **Change by talking.** "Rename Receipt to CheckoutResult" redrew the same board.
4. **Live colours.** After a save, the board showed matches, missing and differs per type and member.
5. **Check.** The agent explained each difference as a trade-off and edited nothing. When told "mine is better", it agreed and redrew the plan, and the type turned green.
6. **Hand over.** The agent filled the bodies without touching a signature. When asked to add a parameter, the dock and the board showed the warning. Revert put the header back and kept the body. The agent then noticed the body still used the removed parameter.
7. **Closing tour.** It ran on the change set: 5 steps.
8. **Switch off.** The row and the colours went at once, and `check_skeleton` answered "off".

Fixed after the probe:
- A planned `constructor(...)` now matches the language's constructor.
- An empty workspace counts as checked.
- "Just do it" is now styled like "Write the skeleton".

## The dock: one button per agent

At the user's request the dock row has a single "Skeleton" button and nothing else.
- It is pressed (`aria-pressed`, filled) when skeleton first is on for that agent.
- Its tooltip explains what it does and what to say to the agent.
- It is reachable with the keyboard; Enter and Space press it.
- There are no status lines, stage labels, counts, choice buttons or warning blocks on the row: the stages are talked through with the agent.
- The board's plan-vs-code colours stay.

## Probe outside plan mode (2026-10-20, Haiku 5.5, auto mode)

- **Switch on, "add discount codes to orders":** the reminder arrived with the prompt, then `check_skeleton` and `draw_board` ran with no edit. The design came first.
- **Switch on, "fix the typo in CONFIRMATION":** the reminder arrived, and the agent made a direct edit. The design offer stayed open for the other change.
- **Switch off, "add a Coupon type":** no reminder. The agent called `check_skeleton` from the server instructions, got "off" and wrote the file.
- **Board colours re-checked on a partial skeleton:** DiscountCode matches, applyDiscount is missing, Order differs (`discount` against the planned `discountCode`), and DiscountRepository has one member missing.

## Chat-driven flow: trust and probe (2026-10-20)

- **Steps rest on the agent's honesty.** A step from the agent (`handover`, `just`, `accept`, `finish`) is taken on the agent's word that the developer asked for it. Every step is logged with the session. A keep (`accept`) never disappears silently: the board still marks it, as "Kept (the agent was told to keep it)".
- **Agents Axle did not start** have no switch: they may check, but their steps are refused.
- **Probe**, Haiku 5.5 in auto mode, outside plan mode:
  - The button rendered off, on hover and on.
  - Turned on, "add loyalty points": the agent called `check_skeleton`, drew the design and stopped. The board was already comparing the design with the code, and the agent told the developer in the chat what to say next.
  - "Check" explained the one difference, `earn` without `amount`, as a trade-off, with no edits.
  - "Hand over, and add reason to redeem": step `handover`, then the bodies, then `check_skeleton`, then a 3-step tour. The reply listed "Warning 1: redeem signature changed", before → after, and asked keep or revert.
  - "Keep it, we are done": step `accept` (warning 1), then step `finish`; the board went plain.
  - Turned off, "add a Referral type": `check_skeleton` answered off, and the agent wrote the file.

## Known gaps

- TypeScript interface method signatures are not in the type graph, so a planned interface method shows as missing. This needs work in the poly index.
- Codex gets no approval-time reminder; it has only the server instructions.
- The stages live in window memory, so a reload ends them.
- A file written outside the editor (not saved in it) recolours only on the next save or index refresh.
- Revert leaves a body that may use the reverted parameter. The agent is not told automatically; the warning text says what changed.
