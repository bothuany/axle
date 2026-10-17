# Harness and agent-dock landscape

Researched 2026-10-17 from official docs, changelogs and repos. `[V]` = read on the primary page that day; `[S]` = secondary source or search snippet; `[U]` = unverified or sources disagree. Claude Code docs were current through v2.1.302 (2026-10-16). Raw per-area notes with every link live in the session notes folder (`research-A-harness.md`, `research-B-agents.md`, `research-C-memory.md`, under `%APPDATA%\Claude\side-session-notes\local_6da0ad94-…`). This report only keeps what matters for Axle.

Axle today, from README, `docs/agent-tools.md` and the command lists in `flow-harness` / `flow-agent`: a harness map with health score, Add Hook, Run Hook with Sample Input, Always Allow/Deny, Show Context Budget, Report Usage, Record Permission; an Agents dock (Claude Code / Codex / custom CLIs) with hook-driven status, resume, flows touched per turn, plan boards. Where this report says "Axle lacks X" it is judged from those surfaces, not a full code audit.

---

## A. Harness and configuration management

### Comparison

| Tool | Instructions and scoping | Inspect / debug | Cost / effect visibility |
|---|---|---|---|
| **Claude Code** | CLAUDE.md (managed/user/project/local, nested, `@imports`), `.claude/rules/*.md` with `paths:` globs, skills, subagents, hooks, MCP, plugins; settings merge managed > local > project > user | `/context`, `/memory`, `/skills`, `/hooks` (read-only), `/mcp`, `/permissions`, `/doctor` (+ `prompt-audit`, v2.1.283+), `/skill-doctor`, `InstructionsLoaded` hook, `--debug`, `--safe-mode` | `/context` by category; `/skills` sortable by tokens; `/skill-doctor` context cost + invocation counts (v2.1.252+); `/usage` attributes plan use to skills, subagents, plugins, MCP servers, with behavior flags |
| **Codex** | AGENTS.md (`~/.codex` + root-to-cwd, override file, 32 KiB cap), `config.toml` layers + profiles, hooks, `requirements.toml`, permission profiles | `/status`, `/hooks` (inspect, trust by content hash, disable), `/mcp` | `/status`: model, approvals, writable roots, tokens, context left `[S]` |
| **Cursor** | `.cursor/rules/*.mdc` (Always / Auto Attached globs / Agent Requested / Manual), AGENTS.md, Team Rules | Customize panel lists rules | None per rule documented |
| **Windsurf** | `.windsurf/rules/` (always / model-decision / glob / manual), global rules, AGENTS.md; 6k/12k char caps | Customizations panel for rules and memories | Docs explain token behavior per mode; no counter |
| **Kiro** | `.kiro/steering/` (always / fileMatch / manual / auto), `.kiro/hooks/*.json`, specs (requirements, design, tasks) | Steering panel, Agent Hooks section; hooks docs have no debug section | None |
| **Cline** | `.clinerules/`, `paths:` conditional rules, reads `.cursorrules`/AGENTS.md | Rules panel with per-rule toggles; "Conditional rules applied" notice | None |
| **Roo Code** | `.roo/rules/`, `.roo/rules-{mode}/`, custom modes, AGENTS.md | Prompts tab | None |
| **Continue** | `.continue/rules/*.md` with `globs`, `regex`, `alwaysApply` | Rules list above toolbar | None |
| **GitHub Copilot** | `copilot-instructions.md`, `.instructions.md` with `applyTo`/`excludeAgent`, AGENTS.md, CLAUDE.md, `.prompt.md`, custom agents | **References list on every response**, Customizations editor, Agent Debug Logs (loaded/skipped/rejected), Chat Debug view | Chat Debug token summary, Cache Explorer |
| **Factory** | AGENTS.md (cwd to git root, also reads CLAUDE.md), custom droids | `/droids` | Only char caps (80k/40k) |
| **Amp** | AGENTS.md with `@` glob mentions that load only after a matching file is read | `/agent-files` lists guidance in use; context % indicator | Context percentage |
| **Aider** | CONVENTIONS.md via `--read`; repo map | Chat commands | `--map-tokens` budget; read-only files prompt-cached |
| **ccusage** | reads Claude Code (and Codex) JSONL logs | CLI reports | daily/session/5-hour blocks/per-model/per-project cost; statusline |
| **Claude-Code-Usage-Monitor** | reads Claude logs | live terminal UI | 5-hour windows, burn rate, limit predictions |

Sources: [Claude memory](https://code.claude.com/docs/en/memory), [debug-your-config](https://code.claude.com/docs/en/debug-your-config), [skills](https://code.claude.com/docs/en/skills), [costs](https://code.claude.com/docs/en/costs), [hooks](https://code.claude.com/docs/en/hooks), [permissions](https://code.claude.com/docs/en/permissions) (all fetched 2026-10-17); Codex [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [hooks](https://learn.chatgpt.com/docs/hooks); [Cursor rules](https://cursor.com/docs/context/rules); [Windsurf](https://docs.devin.ai/desktop/cascade/memories); [Kiro steering](https://kiro.dev/docs/steering/) (page dated 2026-10-06), [hooks](https://kiro.dev/docs/hooks/), [specs](https://kiro.dev/docs/specs/) (2026-10-15); [Cline rules](https://docs.cline.bot/customization/cline-rules); [Roo](https://roocodeinc.github.io/Roo-Code/features/custom-instructions); [Continue](https://docs.continue.dev/customize/deep-dives/rules); Copilot [repo instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions), [VS Code chat debug](https://code.visualstudio.com/docs/copilot/chat/chat-debug-view); [Amp globs](https://ampcode.com/news/globs-in-AGENTS.md) (2025-09-23); [ccusage](https://github.com/ryoppippi/ccusage); [Usage Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor).

### Facts worth knowing

- **Claude Code already covers a lot natively**, spread over ~10 commands. `/doctor` flags unused skills/MCP/plugins vs context cost and slow hooks; `/doctor prompt-audit` (v2.1.283+) audits instructions for outdated or conflicting content (LLM-based; output format undocumented). v2.1.296 `--debug` logs each command hook's outcome and duration; v2.1.299 (2026-10-14) added warnings for always-on context and large tool results; v2.1.302 (2026-10-16) records each API request's system prompt and tools in local transcripts, which makes a "what was actually sent" view possible. ([changelog](https://code.claude.com/docs/en/changelog))
- **Permissions: "Yes, don't ask again" already saves a rule.** Axle's one-click grant is not new by itself; the value has to come from doing it from repeated-grant history, with scope choice, overlap detection and review. [V]
- **Silent failure modes exist and nobody lints them.** Bad `paths:` YAML in a Claude rule loads the rule unscoped; Cline fails open on invalid YAML; Claude `/context` does not list nested CLAUDE.md files; `InstructionsLoaded` hooks don't fire for AGENTS.md fallback. [V]
- **Copilot is the only tool where "which instructions were used for this answer" is first-class.** Amp's `/agent-files` is the CLI equivalent. [V]
- **Cursor Memories were removed from the UI in 2.1.x** per staff replies in forum threads; no official changelog confirmed. [S/U]
- Codex docs moved to learn.chatgpt.com (308 redirect). Codex hook trust is hash-based; unreviewed hooks do not run. [V]
- Usage trackers report cost only; none says which instruction file or hook caused it. Claude's own `/usage` attribution now overlaps them on subscription plans. [V]

### Gaps nobody fills
1. One map across all surfaces with one health score.
2. Per-rule / per-hook / per-permission "fired N times, last session" history.
3. Static lint of rules: globs matching zero files, overlap/contradiction, vague descriptions, duplication across CLAUDE.md / AGENTS.md / `.cursor/rules` / copilot-instructions.
4. Hook health over time (never-matching matchers, slow, broken paths).
5. Token cost per instruction file or section, always-on vs on-demand, with before/after for a trim.
6. Cross-tool drift view for repos carrying several tools' files.
7. Permission hygiene: unused, overbroad, conflicting rules across scopes.
8. Per-MCP-server token cost and usage frequency (only `/usage` percentages).
9. Effect measurement: did a new rule reduce the violation it targets?

---

## B. Multi-agent session management

### Comparison

| Tool | Isolation | Status / needs-input | Review | Notifications | Cost / usage | Notes |
|---|---|---|---|---|---|---|
| **Conductor** | git worktree per workspace; Cloud workspaces (Jun–Jul 2026) | working animation; PR-waiting icon (0.69.0, 2026-06-23); no granular needs-input seen | diff view, edit in diff (0.84.0, 2026-09-02) | not documented | not documented | Dispatcher from Linear/GitHub issues; iOS app 0.90.0 (2026-10-02); Mac; latest 0.91.0 (2026-10-15); license/pricing `[U]` |
| **Crystal → Nimbalyst** | worktree per session | kanban; mobile working/waiting | visual diff | iOS push when agent needs you | not documented | Crystal deprecated Feb 2026; Nimbalyst MIT, Mac/Win/Linux |
| **Claude Squad** | worktree + tmux | TUI list | diff tab, commit/push keys | none documented | none | AGPL-3.0; Windows broken (issues Apr–May 2026) |
| **Vibe Kanban** | worktree per workspace | kanban cards | inline diff comments sent to agent | n/a | n/a | **Sunset**: Bloop shut down 2026-04-10; community-maintained |
| **Sculptor (Imbue)** | worktree; experimental Docker backend | not documented | change review + commit | n/a | n/a | MIT, research preview; Mac ARM + Linux |
| **opcode** | none (reads `~/.claude`) | n/a | checkpoints + diff | n/a | **usage dashboard by model/project/time** | AGPL-3.0, Tauri, Claude only |
| **Terragon** | container per task | live task status | PRs | browser notification | n/a | **Shut down**; OSS snapshot 2026-01-16 |
| **Cursor 2.x** | worktree or remote machine per agent | agents sidebar; iOS remote control (2026-10-06) | multi-file review | not documented | not documented | up to 8 parallel agents (2.0, 2025-10-29); Projects with coordinator agent (2026-09-10) |
| **Codex app / cloud** | managed worktrees; cloud threads | approval-blocked recovery guidance (app 26.1007) | review thread, diff comments, automation review queue | not documented | USD in thread usage (CLI 0.162.0) | Command Center to pin tasks; agent message board (CLI 0.163.0, 2026-10-15) |
| **Claude Code desktop** | optional worktree per session; cloud sessions | sidebar filter by status/project; prompts in session | diff viewer with line comments | OS notification on finish; phone push for Dispatch | usage ring: context + plan | Redesign 2026-04-14; Claude only |
| **Copilot agent / Agent HQ** | Actions runner per session | Agents tab: running/stopped | session log, co-authored commits | not covered | tokens + duration in session log | Announced 2025-10-28; third-party agents (Claude, Codex, Jules, Devin) but no steering of them |
| **Warp** | tab per agent, no worktrees | tab icons working/blocked/done/error; **Complete / Request / Error** types; mailbox with All/Unread/Errors | not covered | toasts + desktop alerts | not covered | Claude Code via plugin, Codex via config; closest to Axle's dock |
| **Zed** | optional worktree per thread (detached HEAD) | sidebar status; unread dot `[U]` | no built-in review per docs | `[U]` | not covered | Zed 1.0 2026-04-29; ACP external agents |
| **JetBrains Air / Junie** | temporary worktrees or Docker | `[U]` | pick result to merge | `[U]` | `[U]` | EAP with 2026.3 (Oct 2026); Windows/Linux "coming soon" |
| **Superset** | worktree per workspace | working indicators | diff + comment-to-agent | chimes, dock badges | token views requested in issues | ELv2; Mac, no Windows |
| **Emdash** | worktree per task | hooks give status/resume | diff, PR, CI checks, merge | via hooks | not documented | Apache-2.0, 20+ CLIs, Win/Mac/Linux |

Sources: [Conductor changelog](https://www.conductor.build/changelog.md), [Nimbalyst](https://github.com/Nimbalyst/nimbalyst), [Crystal](https://github.com/stravu/crystal), [Claude Squad](https://github.com/smtg-ai/claude-squad) + [issues](https://github.com/smtg-ai/claude-squad/issues), [Vibe Kanban shutdown](https://vibekanban.com/blog/shutdown), [Sculptor](https://github.com/imbue-ai/sculptor), [opcode](https://github.com/winfunc/opcode), [Terragon OSS](https://github.com/terragon-labs/terragon-oss), [Cursor 2.0](https://cursor.com/changelog/2-0) + [changelog](https://cursor.com/changelog), [Codex changelog](https://learn.chatgpt.com/docs/changelog), [Claude desktop docs](https://code.claude.com/docs/en/desktop) + [redesign](https://claude.com/resources/articles/claude-code-desktop-redesign), [Agent HQ](https://github.blog/news-insights/company-news/welcome-home-agents/) + [track sessions](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/track-copilot-sessions), [Warp notifications](https://docs.warp.dev/agents/capabilities/agent-notifications.md), [Zed parallel agents](https://zed.dev/docs/ai/parallel-agents), [JetBrains Air](https://blog.jetbrains.com/de/ai/2026/10/ein-neues-agentisches-erlebnis-jetbrains-air-in-ides-eap-jetzt-offen/), [Superset](https://github.com/superset-sh/superset), [Emdash](https://github.com/generalaction/emdash). Silence in a cell means the page did not say, not that the feature is absent.

### Patterns that converge
- **One git worktree per agent** is the default isolation (Conductor, Cursor, Codex, Nimbalyst, Superset, Emdash, Zed, Air, Claude desktop). Only Warp and opcode skip it.
- **Sidebar of sessions with status filter**, grouped by project; PR/CI state in the row (Claude desktop, Conductor, Emdash).
- **Hooks as the status source for third-party CLIs** (Emdash, Warp, Superset), the same approach Axle uses.
- **Diff review with line comments routed back to the agent** (Claude desktop, Superset, Vibe Kanban, Codex).
- **Phone as "needs you" channel** (Cursor 2026-10-06, Conductor 2026-10-02, Claude Dispatch, Nimbalyst).
- **Coordinator agents** are appearing (Cursor Projects, Codex message board, Warp Factories).
- **Sustainability warning:** Vibe Kanban, Terragon and Crystal all ended within about a year; free bring-your-own-subscription tools have no revenue.

### Gaps nobody fills
- Granular, ranked "needs you" queue (approval vs question vs error vs done). Warp has types and a mailbox; none documents auto-sorting.
- Code-level view of a turn (which flows/symbols it touched). Everyone shows files and diff stats. **This is Axle's differentiator.**
- Per-session cost across agents in one list (only opcode, Claude-only).
- Cross-session conflict warning (two agents on the same file or symbol).
- Observe-only attach to sessions started in a plain terminal; most tools launch the agent themselves.
- Windows parity (Superset, Conductor, Sculptor lack it; Claude Squad broken).
- Review-queue throughput. The user pain from issues is review and merge load more than spawning.
- No first-hand HN/Reddit complaint threads were read; complaints above are GitHub issues only.

---

## C. Memory bank

### Systems

| System | Storage | Who writes | Loading | Token cost | Known issues |
|---|---|---|---|---|---|
| **Cline Memory Bank** `[V]` ([docs](https://docs.cline.bot/prompting/cline-memory-bank)) | 6 md files (projectbrief, productContext, activeContext, systemPatterns, techContext, progress) in `memory-bank/`; instructions in `.clinerules/` | Agent on "update memory bank"; user can edit | Rule makes the agent read all core files each session | Docs silent; fixed cost per session plus full review on update | Update is manual and skippable; no staleness check; docs now also point to `/newtask`, `/smol` and [auto compact](https://docs.cline.bot/features/auto-compact); no official deprecation found `[U]` |
| **Roo "memory bank"** `[S]` | Community port (`.clinerules-*`, `.roomodes`, `llmdocs/`) | Agent per mode | Per-mode rules | Same as Cline | No official Roo feature found; modes are the real scoping tool |
| **Cursor Memories** `[S/U]` | Cursor-internal; export to `.mdc` | Auto | When "relevant" | Unknown | UI removed in 2.1.x; staff replies conflict whether it still runs; users report undeletable memories ([forum](https://forum.cursor.com/t/are-my-memories-gone/144057)) |
| **Windsurf Memories** `[S]` | Local, workspace-scoped (`~/.codeium/windsurf/memories/` per third parties) | Cascade auto | "Relevant" retrieval | Unknown | Not in git; docs steer durable knowledge to Rules/AGENTS.md |
| **Claude Code auto memory** `[V]` ([docs](https://code.claude.com/docs/en/memory)) | `~/.claude/projects/<project>/memory/`: `MEMORY.md` index + topic files with `type` (user/feedback/project/reference) | Claude | First 200 lines / 25 KB of index; topics on demand; "Saved/Recalled N memories" | Capped | Machine-local; skips anything derivable from code/git; `/memory` lists, toggles, opens folder |
| **Claude "auto dream"** `[U]` | same dir | Background sub-agent | n/a | extra tokens | Third-party sources only; not in the official page |
| **Claude API memory tool** `[V]` ([docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)) | Client-side `/memories` | Claude via view/create/str_replace/… | Just-in-time | Per call | Developer owns size caps, expiry, traversal safety, sensitive-data stripping |
| **Copilot Memory** `[V]` ([docs](https://docs.github.com/en/copilot/concepts/agents/copilot-memory), preview 2026-01-15, default-on for Pro 2026-03-04) | GitHub-hosted facts with **code citations** | Copilot from activity | **Citations validated against the current branch before use** | Unknown | Auto-expire after 28 days unused; repo owners can review/delete |
| **Kiro steering/specs** `[S]` | `.kiro/steering/`, per-feature specs | Human + agent | always / fileMatch / manual / auto | Only "always" is fixed | CLI loads all; fileMatch bug for global files ([issue 9176](https://github.com/kirodotdev/Kiro/issues/9176), status unknown) |
| **Codex memories** `[U]` | `~/.codex/memories/` summaries | Background summarization | Later sessions | Unknown | Third-party sources only, experimental flag default off |
| **MCP `memory` (official)** `[V]` ([repo](https://github.com/modelcontextprotocol/servers/tree/main/src/memory)) | `memory.jsonl` knowledge graph | Agent | `search_nodes` (substring), `read_graph` dumps all | Whole graph on dump | No timestamps, provenance, TTL or code links; duplicate names silently ignored |
| **Serena** `[V partial]` | Markdown memories per project | Agent | `list_memories` then `read_memory` | Small, on demand | No staleness model |
| **claude-mem, basic-memory, Mem0, Graphiti/Zep** `[S]` | DB+vectors / markdown / graph | Auto or agent | Semantic or graph query | Per query | Roundup sources only; Zep's temporal validity windows are the relevant idea |

### What the evidence says
- **Context files are not a free win.** Gloaguen et al., "Evaluating AGENTS.md" ([arXiv 2602.11988](https://arxiv.org/abs/2602.11988), v3 revised 2026-09-29): across 138 AGENTBENCH tasks plus SWE-bench, context files did not generally raise success and added over 20% inference cost; agents obey them and explore more; repository overviews were not helpful; useful for non-standard practices. Secondary coverage says LLM-generated files do worse; the size of the negative effect is `[U]` until the PDF is read.
- **Staleness, drift and contradiction are well motivated but not quantified.** No controlled study found. Evidence is design-level: Copilot's 28-day expiry and citation validation, Claude's "skip what code already says", Cursor's undeletable-memory complaints.
- **Memory is an injection vector.** MINJA, AgentPoison and OWASP's 2026 agentic list cover it `[S]`; nothing found specific to coding-agent project memory. Inference: anything the agent writes from web pages, issue text or tool output persists, and committed memory extends that to anyone who can push.
- Memory is advisory context, not enforcement (Claude docs); rules that must hold belong in hooks and permissions.

### What works / what fails

| Works | Fails |
|---|---|
| Small, human-reviewed, non-derivable facts: odd build commands, conventions, decisions and why, external pointers | Generated repo overviews and architecture summaries |
| Short index + on-demand topic files (Claude, Serena) | Always-read six-file bank with a manual update ritual (cost every session, drifts when update is skipped) |
| Plain files the user can open, diff and delete | Hidden or undeletable stores (Cursor) |
| Path/mode scoping and conditional loading | `read_graph`-style dumps as retrieval |
| Validate-before-use plus expiry (Copilot) | Writes with no provenance (user said vs agent inferred vs tool output) |
| Progress log marked done only after verification ([Anthropic harness post](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)) | Machine-local memory teams can't review |

### Verdict on a Cline-style memory bank for Axle
Don't ship the six-file bank. Its derivable files (projectbrief, techContext, systemPatterns) are what the AGENTS.md study found unhelpful, and Axle's polyglot index already answers them from code. If Axle does memory, ship a **code-anchored notebook** (below), not a document set. Keep Cline's `activeContext`/`progress` idea only as a short-lived session note with a short expiry.

### Keeping memory honest: design sketch
1. **Entry**: one md file with frontmatter `id`, `type` (rule/decision/gotcha/pointer), `claim`, `why`, `anchors` (path + symbol + body hash + commit, resolved through the poly index), `provenance` (user/agent/tool-result/imported, session, quote), `last_verified`, `last_used`, TTL.
2. **Verify before use**: re-resolve anchors on load. Symbol gone, moved or changed body hash → entry marked stale, not injected, shown with the diff since its commit. Hash the AST, not text, to avoid false staleness from formatting. (Copilot's model.)
3. **Tiny capped index always on** (Claude's 200 lines / 25 KB is the precedent); bodies load by anchor match with files in context, or by an explicit `recall`.
4. **Expiry**: default TTL reset on validated use (Copilot: 28 days); unanchored entries expire sooner.
5. **Writes are proposals**: the agent calls `propose_memory`; the editor shows a diff with provenance and anchor preview; accept/edit/reject. Reject proposals that are derivable or duplicate a rule.
6. **Conflicts**: detect entries sharing anchors or text, require supersede/merge/discard, keep `supersedes` links.
7. **Anti-poisoning**: `source: tool-result` entries are quarantined until a human promotes them; memory can never change permissions or hooks.
8. **Visible**: harness-map view of what loaded this session and why, stale list, token cost per entry, always a delete.
9. **Measure**: log injected entries per session against user corrections; prune never-used entries.
10. **Interop**: read AGENTS.md/CLAUDE.md; export entries to a rule rather than fork a second instruction system.

---

## What Axle should take or avoid

### Harness map (flow-harness)

| Idea | Evidence | Size |
|---|---|---|
| **Rule/skill/hook lint that runs without an LLM**: dead `paths:` globs, bad frontmatter (Claude silently loads unscoped; Cline fails open), overlap and duplication across CLAUDE.md / AGENTS.md / rules / `.cursor/rules` / copilot-instructions | Gap 3 and 6; only `/doctor prompt-audit` (LLM, one-shot, undocumented output) comes close | M |
| **"Fired / loaded" history per rule, hook and permission**, linked to the session; flag never-fired items | Gap 2; Claude only has `/skill-doctor` counts for skills; Copilot shows per-response references only. The `InstructionsLoaded` hook is the raw signal | M |
| **Per-file token cost with always-on vs on-demand split**, and total next to health score | Gap 5; Claude `/context` and `/skills` give categories, nobody per file/section. ETH study: always-loaded context costs +20% | S (Axle already has Show Context Budget; make it per-file and persistent) |
| **Permission hygiene**: unused, overbroad, conflicting rules across scopes, from repeated-grant history | Gap 7; "don't ask again" already exists natively, so pitch review and cleanup, not just creation | S–M |
| **Hook health over time**: never-matching matchers, slow, broken paths, trust state (Codex hash trust) | Gap 4; Kiro/Codex have no debug docs; Claude `--debug` is per-run. Axle's Run Hook with Sample Input is a start | S |
| **Cross-tool view**: one map for Claude, Codex, Cursor, Copilot, Cline files with drift and duplication | Gap 6; tools only import once | M |
| **Code-anchored memory notebook** as designed in section C, with propose-then-review writes | Copilot Memory (citations + 28-day expiry) is the one validated precedent; ETH study says unverified context hurts | L, do after lint and cost |
| **Effect measurement**: before/after violation counts when a rule is added | Gap 9; nobody does it | L, speculative |
| **Show "what was sent"** from v2.1.302 transcript records | New raw material; Copilot Chat Debug is the UX reference | M |

Avoid:
- A six-file memory bank or any always-read document set.
- Auto-writing memory without review, hidden stores, or storing anything the index or git can answer.
- A health score that is not explainable per finding. Every point lost should name a file and a fix.
- Rebuilding commands Claude already has (`/context`, `/permissions`). Wrap and aggregate them; add the history and cross-tool angle.

### Agents dock (flow-agent)

| Idea | Evidence | Size |
|---|---|---|
| **Keep flows-per-turn as the headline**; nobody else shows code-level impact | Gap B2; Conductor, Superset, Claude desktop show files and diff stats | have it; polish |
| **Ranked "needs you" queue** with types (approval, question, error, done) and sound/OS notification | Warp's Complete/Request/Error plus mailbox is the closest; no one documents ranking. Axle has rise-to-top; add the taxonomy and an unread mailbox | S–M |
| **Per-session and cross-agent cost** in the row (tokens and USD where the log allows) | opcode (Claude only), Codex CLI 0.162.0 USD per thread, Superset issue requests, Claude desktop usage ring (plan-level only) | M |
| **Worktree per session as an option** | Near-universal; Zed creates on first message and archives; Claude desktop removes on archive. Axle has none, which is the clearest gap | M–L |
| **Conflict warning across sessions** (same file or symbol touched by two agents) | Gap B4; Axle's index lets it work at symbol level, nobody else can | M |
| **Diff review with line comments sent back to the agent** | Claude desktop, Superset, Codex, Vibe Kanban | M |
| **Row shows PR/CI state** | Conductor 0.69.0, Claude desktop, Emdash | S |
| **Attach to a plain-terminal `claude`** observe-only | Gap B5; Axle's observe-only hooks fit; most rivals own the process | S–M |
| **Phone/remote "needs you"** | Cursor, Conductor, Nimbalyst, Claude Dispatch all shipped one in Oct 2026 | L, defer |

Avoid:
- Kanban/issue-intake as a core feature (Vibe Kanban sunset; Conductor Dispatcher and Emdash occupy it).
- A coordinator-agent layer now; it is still forming (Cursor Projects, Codex message board) and the user pain is review load, not spawning.
- Business-model-free positioning claims; three peers shut down.

### Where Axle is behind (honest)
- **No worktree isolation** while almost every peer has it. Two agents on one checkout is the larger risk the dock does not warn about.
- **No review loop in the dock**: Axle opens diffs and canvas flows, but no line comments back to the agent as Claude desktop, Superset and Codex have.
- **No cost view per session**; Claude Code's own `/usage` attribution and ccusage fill that today.
- **Claude Code ships native diagnostics fast** (`/doctor`, `/skill-doctor`, `/usage` attribution, hook debug logs, all within the last ~3 weeks of releases). Axle's harness map must lead on aggregation, history, lint and cross-tool, not duplicate single commands.
- **Notifications and mobile**: no OS-level or phone push documented in Axle.
- Axle's status relies on observe-only hooks; Codex needs `/hooks` trust and an older Codex gets no status, a setup cost peers like Warp share but should be measured.

### Suggested order
1. Harness: per-file token cost + lint + fired history (all static or log-derived, no new risk).
2. Dock: needs-you taxonomy, notifications, per-session cost, PR/CI in row.
3. Dock: worktree-per-session and cross-session conflict warning (uses the index).
4. Memory notebook, only after 1 proves the cost/staleness plumbing.

## Unverified, check before citing externally
Conductor license/pricing/platforms; Cursor, Zed, Junie/Air notification and status UIs; Copilot notifications; Codex `/status` contents, `/skills`, `/memories`; Amp manual pages (sign-in walled); Continue Hub (404); Aider `/tokens`; ccusage and Usage Monitor versions and dates; Cursor Memories official status; Windsurf delete UI; Claude "auto dream"; Kiro inclusion-mode count; ETH paper exact effect sizes; Chroma context-rot numbers; claude-mem/basic-memory/Graphiti specifics.
