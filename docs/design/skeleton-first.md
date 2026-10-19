# Skeleton first (variant A)

Status: built on `claude/skeleton-first-067ed6`, on top of guided tours (PR #8). Written 2026-10-20.

Research: `docs/research/skeleton-first-landscape.md` and `skeleton-first-council.md` (in the main checkout, not committed).

## The problem

AI writes so much code that developers lose the know-how of their own system. Skeleton first is an opt-in mode in which the developer writes the *structure* of a change themselves: the types, entities, interfaces and signatures. The agent designs it, checks it, explains it and fills the bodies.

## The user's decisions

1. **Variant A order.** After a plan is approved, the agent draws the target design (class or ER) with `draw_board`. The developer then writes the skeleton in the editor: types, entities, interfaces, signatures, empty bodies.
2. **The diagram is corrected by talking.** "Make DiscountPolicy an interface", "remove the repository": the agent redraws the same board. This repeats until the developer accepts it. Nothing is edited by dragging.
3. **An on/off switch, never imposed.** A "Skeleton first" switch in the agent dock, and the setting `axle.skeletonFirst.enabled` (default off). When it is on, the mode is offered only when the plan adds or changes types, entities or interfaces. "Just do it" is always one click, and the same size as the other choice. Turning it off takes effect at once.
4. **Live plan vs actual.** While the developer writes, the board is recomputed from the real type index on every save. Each type and member is marked **matches**, **missing** or **differs**. The diagram is the plan and the code is the truth; nothing round-trips.
5. **Check.** A dock button, or the read-only MCP tool `check_skeleton`, returns the structured diff. The agent explains each difference with a reason and does not fix the code. When the developer answers "mine is better", the agent argues its case or updates the plan.
6. **Hand over.** The agent fills the bodies. There is **no lock, only a warning**: if the agent changes a signature, a name or a relation the developer wrote, a passive warning shows in the dock and on the board, with the before and after text and Accept / Revert.
7. **A closing tour** of what was filled, with the `tour` tool.
8. **No scores, no metrics, nothing leaves the machine.**

The council's main objection: in variant A the developer types out a design they have already seen, which is transcription rather than generation. The user chose A knowingly, so it is built as decided. The way to test the objection later is to swap steps 1 and 2: the developer sketches first and the agent reveals its design afterwards.

## Where "plan approved" is detected: an MCP handshake

Claude Code keeps working in the same turn after the user approves `ExitPlanMode`. Axle's hooks only observe, so `PostToolUse ExitPlanMode` fires after the agent is already on its way to its first edit. The dock cannot type into a working session either. A dock-only gate would therefore come too late. Hooking `ExitPlanMode` is also version-dependent, and Codex has no such tool.

So the gate is something the agent does **before its first edit**: it calls `check_skeleton`.

- The server instructions (`src/mcp/protocol.ts`) and the `skeleton_first` MCP prompt say: after a plan is approved, and before writing code for a plan that adds or changes types, entities or interfaces, call `check_skeleton` once.
- The tool reads the live setting in the window, not anything fixed when the MCP server started, so turning the mode off works at once:
  - **Off:** "Skeleton first is off: implement the plan as usual." One fast call, nothing else.
  - **On, no design yet:** "Draw the design with `draw_board` (id `skeleton-…`, kind class or er, members as signatures), then STOP and tell the user in one line." The dock then offers **Write the skeleton** and **Just do it**, side by side.
  - **Later:** the diff (see Check).
- The dock owns the stage after that: each later step is a click in the dock, which types the next prompt into the same session (as "Explain this" does).

This works for any agent that reads MCP server instructions, Codex included. The limit: an agent that skips the call just implements the plan as usual. The design is not forced on anyone, and the tool answer is the only thing that stops the agent. The probe with Haiku checks whether it makes the call.

## Stages

Per agent session, held in the window's memory (`src/skeleton/sessions.ts`). A window reload loses them.

| Stage | Entered by | The dock row shows | `check_skeleton` answers |
| --- | --- | --- | --- |
| (none) | | | Off, or "draw the design and stop" (and the stage becomes `design`) |
| `design` | The agent's first `check_skeleton` while the switch is on | The design board link, **Write the skeleton** / **Just do it**, "Not right? Tell the agent what to change" | "Wait for the developer" |
| `skeleton` | **Write the skeleton** | Live counts (matches / missing / differs), **Check**, **Hand over**, **Just do it** | The diff, and "explain, do not fix" |
| `handover` | **Hand over** (types the handover prompt) | Warnings, **Tour**, **Finish** | The diff, warnings, and "fill the bodies, keep the signatures" |

- **Just do it** types "implement the approved plan now" and drops the stage.
- **Finish** drops the stage and the colours.
- Turning the switch off drops every stage, clears the board colours and hides the chips at once.

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

The **Check** button types a prompt into the session: call `check_skeleton`, explain each difference with a reason phrased as a trade-off, and do not edit any file. If the developer says theirs is better, the agent argues its case or, if it agrees, redraws the plan with the same board id. The board recolours from the new plan straight away.

## Hand over and the signature warning

**Hand over** records the developer's own declarations: for each planned type and member that exists in the code now, its file and header text (the declaration lines up to `{`, `;`, `=>` or a trailing `:`). It then types the handover prompt: fill the bodies, keep every signature, name and relation, say why if one must change, and end with a closing tour.

- After each agent edit (flow-agent's `flow.agent.edited`, after the tool ran), the files it touched are re-read.
- A recorded header that is no longer in its file is a **warning**: changed, renamed, or removed. Each warning carries the before text and the after text.
- When the developer saves a file in the editor, the recorded headers in that file are taken from it again. The developer's own changes are never warned about.
- Warnings are passive: a chip on the dock row and an amber mark on the board member. They never block, steal focus or pop up.
  - **Accept** takes the new header as the recorded one.
  - **Revert** writes the recorded header back over the current declaration lines only, never the whole file, so the bodies stay. It is offered for changed and renamed declarations, not removed ones.
  - **Open** shows the place.
- The dock sends an index into the warning list it was given, never a file or an id.

## The closing tour

The handover prompt ends with "play a closing tour with `tour` on `{"changes": true}`: one step per filled method". The dock's **Tour** button sends the same request again later.

## Pieces

| Piece | Where |
| --- | --- |
| Matcher, header guard, stages (pure) | `flow-view/src/skeleton/{match,guard,sessions}.ts` |
| Host: graph refresh, board decorator, commands, push to the dock | `flow-view/src/skeletonHost.ts` |
| `check_skeleton` tool, `skeleton_first` prompt, instructions | `flow-view/src/mcp/{tools,handlers,prompts,protocol,register}.ts` |
| `check` and `checkNote` on board nodes and members | `flow-view/src/board/spec.ts` = `ui/src/board/spec.ts`, rendered in `ui/src/board/cards.tsx` |
| Switch, row actions, prompts | `flow-agent/src/{skeleton,dockMessage,dockPage,dock}.ts`, the setting in `flow-agent/package.json` |

Commands across the boundary (all registered, checked by `test/arch/commands.test.mjs`):
- flow-agent → flow-view: `flow.skeleton.choose`, `flow.skeleton.handover`, `flow.skeleton.finish`, `flow.skeleton.warning`.
- flow-view → flow-agent: `flow.agents.skeleton` (the row view).

## Out of scope

- Locks.
- Diagram editing and stub generation (variant B).
- Levels.
- Team policy.
- Any record that outlives the window.
- The council's sketch-first ordering.
