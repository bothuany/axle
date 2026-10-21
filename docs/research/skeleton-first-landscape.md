# Skeleton-first HITL: landscape, evidence and a build order

Researched 2026-10-20. Web facts come from search results and the few pages fetched that day (Anthropic's study page, Fowler's SDD article, the Claude Code hooks reference). Many product facts are second-hand (vendor blogs, SEO guides); where a claim rests on one weak source or I found nothing, the text says so. Re-check anything you rely on.

## Recommendation (short)

1. **Build first (M): skeleton in code + a live "plan vs. actual" board.** The agent draws the target design with `draw_board` (class / er / sequence), the developer writes the skeleton **in their editor**, and Axle diffs the real type index against the drawn plan continuously. Nothing round-trips: the diagram is a *plan*, the code is the truth, and the board is recomputed from the index on every save, so it cannot drift.
2. **Then (M): signature lock + review.** After the skeleton is accepted, a `PreToolUse` hook on `Edit|Write` denies changes to locked signatures, with a reason the agent can act on. "The AI checks the skeleton and explains its mistakes" is an MCP tool (`check_skeleton`) that returns a structured diff; the agent turns it into explanations.
3. **Then (S–M): a closing tour** of what was filled, reusing the guided-tours player (separate PR in flight; depend on it, do not touch it).
4. **Later, only if asked: diagram-first editing with generated stubs.** Editing the diagram is the part with the worst track record (section 3) and the most new UI. Offer *generate stubs from the board* as a one-way convenience, never a sync.
5. **Levels:** `off` / `review` (today's plan approval, plus a board) / `sketch` (developer writes only types and signatures) / `build` (also writes bodies of chosen methods). Default `off`. The "fill in the blank" variant is `sketch` with `TODO(human)`-style holes and is the cheapest thing to try first.

The decisive evidence: people who kept thinking (asked conceptual questions, wrote or explained the code) kept their comprehension; people who delegated lost it (section 2). Skeleton-writing is a **generation task about the design**, which is the part developers least want to lose and the part AI is least needed for.

## 1. Landscape

"Keeps the human writing?" is the column that matters here: almost every tool lets the human *edit a plan in prose*; almost none asks them to write *code structure*.

### Plan / spec flows in agents and IDEs

| Product | What it does | HITL | Human writes? | What users say |
|---|---|---|---|---|
| GitHub Copilot Workspace | Issue → editable *spec* (current vs. proposed state bullets) → editable *plan* (files to create/modify/delete) → code. Editing any step regenerates downstream ([user manual overview](https://github.com/githubnext/copilot-workspace-user-manual/blob/main/overview.md), [coverage](https://www.coveros.com/inside-look-github-copilot-workspace/)). | Approve/edit spec and plan | Prose bullets only | GitHub Next says the technical preview ended 2025-05-30 ([project page](https://githubnext.com/projects/copilot-workspace)); I found no GitHub changelog for it and no information on what replaced it. Treat as "the idea was tried and folded into the coding agent" (unverified). |
| Cursor Plan Mode | Agent researches the repo, asks clarifying questions, writes an editable Markdown plan (file paths, code references, to-dos); build starts after approval; plan can be saved to the repo ([Cursor blog, Oct 2025](https://cursor.com/blog/plan-mode)). | Edit plan, then approve | Edits prose / to-dos | Mostly promotional coverage; I found no systematic complaints. |
| Claude Code plan mode | Read-only exploration, then `ExitPlanMode` presents the plan for approval. | Approve / reject / feedback | Prose feedback | The hooks reference ([docs](https://code.claude.com/docs/en/hooks)) shows `plan` only as a `permission_mode` value, not a hook target. Community reports say `PreToolUse` did not fire for `ExitPlanMode` on v2.1.20 and recommend a `PermissionRequest` hook matched on `ExitPlanMode`, which is how Plannotator intercepts plans ([issue 21282](https://github.com/anthropics/claude-code/issues/21282), [Plannotator docs](https://plannotator.ai/docs/guides/claude-code/)). Verify against the installed version; Axle's harness already builds hooks (`flow-harness/src/hooks.ts`). |
| Claude Code "Learning" output style | Adds "Insights" and leaves `TODO(human)` markers in code for the user to implement ([output styles docs](https://code.claude.com/docs/en/output-styles)). Shipped to all users Aug 2025 after an Education launch in Apr 2025 ([Engadget](https://engadget.com/ai/anthropic-brings-claudes-learning-mode-to-regular-users-and-devs-170018471.html)). | Agent hands a hole to the human | **Yes: a small function** | The closest existing thing to "fill in the blank". It is a *prompt*, not enforced: nothing checks the human's code or locks it. Specifics of its rules come from a leaked-prompt blog (unverified). |
| Kiro (AWS) | Requirements (EARS user stories) → design → tasks, as files under `.kiro/specs/`; requirements-first or design-first ([overview](https://www.verdent.ai/guides/agents/kiro-spec-driven-development)). | Review each phase | Prose | Fowler: a small bug became 4 user stories and 16 acceptance criteria, "like using a sledgehammer to crack a nut" ([article](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)). A dev.to deep dive calls the preview "brilliant, broken, and frustrating" ([post](https://dev.to/aws-builders/brilliant-broken-and-frustrating-my-deep-dive-into-amazons-kiro-ai-ide-the-flawed-junior-gn5)). |
| GitHub Spec Kit | `/specify` → `/plan` → `/tasks` → implement, Markdown artifacts, a branch per spec. | Review each artifact | Prose | Same Fowler piece: "I'd rather review code than all these markdown files"; skeptical of up-front spec design. Another review found a plan phase producing 2,000+ lines of Markdown and estimated plain iterative prompting ~10x faster ([codemyspec](https://codemyspec.com/blog/github-spec-kit-guide), anecdotal). |
| Tessl | Spec-as-source: specs with `targets` and `[@test]` links; generated files marked "do not edit"; Registry of "skills" ([overview](https://rywalker.com/research/tessl), [registry](https://tessl.io/registry/tessl-labs/spec-driven-development)). | Human edits the spec, not the code | Spec prose | Fowler: regenerating from the same spec gave different results; asks whether it combines MDD's inflexibility with LLM non-determinism. Framework in closed beta as of the overview (unverified for today). |
| Windsurf / Devin (Cascade) | Planning mode writes an editable local Markdown plan plus an in-chat to-do list; Devin's plan mode asks multiple-choice clarifying questions ([Windsurf docs](https://docs.windsurf.com/windsurf/cascade/planning-mode), [Devin docs](https://docs.devin.ai/desktop/cascade/cascade.md)). Docs disagree on where plans are stored. | Edit plan | Prose | Nothing found beyond docs. |
| JetBrains Junie | *Ask mode* (read-only, for planning together) vs. *Code mode* (multistep plan, executes, can roll back everything) ([docs](https://www.jetbrains.com.cn/en-us/help/junie/code-mode.html)). | Ask first, then accept/rollback | No | A JetBrains guide and the docs disagree on whether Ask mode can edit; docs are the safer reference. Nothing on AI Assistant "learning" features found. |
| Zed | Agent *profiles*: Ask is read-only (read_file, grep on; edit and terminal off); profiles choose tools, Tool Permissions decide approval ([docs](https://zed.dev/docs/ai/agent-profiles)). | Per-tool approval | No | Same shape as Junie: a read-only mode, not a design step. |
| Sourcegraph Amp | The *oracle*: read-only reasoning subagent for analysis, planning, review; the main agent decides when to call it, deliberately not forced because of cost and latency ([Amp news](https://ampcode.com/news/oracle), [docs](https://ampcode.com/docs/tools)). Thread sharing is pitched for review and teaching. | Human mostly watches | No | One Amp page contained text addressed to LLMs; ignored. |
| Augment Code | **Nothing found** in my searches (task list / planning). Not assessed. | | | |

Note the pattern: plan editing is prose, everywhere. Fowler's verdict on the family ("spec-first, not yet proven") and his preference for "small, iterative steps" argue against anything that looks like a heavy up-front ritual.

### Model-driven / UML tools

| Tool | Relevant behaviour | Lesson |
|---|---|---|
| Enterprise Architect | Reverse-engineers code into class diagrams and generates code from models; Sparx itself says keeping the two in sync is "an important aspect" ([Sparx](https://www.sparxsystems.eu/enterprise-architect/project-roles/enterprise-architect-for-developer/?L=0)). A 2000s-era blog found packages/imports handled poorly (old, may be outdated). | Sync is the product *and* the failure mode. |
| Visual Paradigm | Calls the diagram/code gap "model-code drift" that destroys documentation credibility ([guide](https://guides.visual-paradigm.com/?p=4085)). | Vendors name the problem themselves. |
| Umple | Text-first modelling with UML diagrams generated from the same source (single source of truth). I found only an abstract ([uOttawa](https://www.site.uottawa.ca/~ssome/Cours/CSI5902/DusanBrestovansky.html)) and nothing on adoption. | The design that avoids drift is "one textual source, diagram derived". |
| PlantUML / Mermaid | Diagram-as-text, mostly one-way (text to picture); code generation is community-level. Not researched in depth. | |
| Round-trip research | A 2020 benchmark compared round-trip in Papyrus, Modelio, Visual Paradigm; results not seen. A separate paper says tools only round-trip *structural* concepts such as class diagrams ([annals-csis](https://annals-csis.org/Volume_9/drp/485.html)). | Structure (classes, members, relations) is the only part that has ever round-tripped. That is exactly what a skeleton is. |
| UML in practice | Petre (ICSE 2013): of 50 professionals in 50 companies, 35 used no UML, 11 selectively, 3 relied on code generation, none wholeheartedly ([paper](https://2013.icse-conferences.org/content/uml-practice.html), [summary](https://neverworkintheory.org/2013/06/13/uml-in-practice-2.html)). Baltes & Diehl (FSE 2014, 394 practitioners): most sketches contain some UML elements, informally. | Developers draw *sketches*, not models. An informal, throwaway diagram is normal; a maintained one is rare. |

### Education and "learning while AI codes"

- **Anthropic Learning / Explanatory styles**: above. Closest prior art, unenforced.
- **ChatGPT Study Mode** (2025-07-29): Socratic prompts, "hints instead of answers", built on custom system instructions rather than a new model ([PCWorld](https://www.pcworld.com/article/2863281/chatgpt-gets-study-mode-to-guide-students-without-spoon-feeding-answers.html)). **Khanmigo**: Socratic tutor tied to Khan Academy curriculum with teacher/parent dashboards; comparison sites quote differing prices, so none cited ([comparison, low authority](https://www.iatrox.com/compare/chatgpt-study-mode-vs-khanmigo)).
- **CS50 duck / Copilot for education settings**: my searches returned nothing on either; not assessed.
- **GPT Tutor vs. GPT Base** (below) is the only controlled evidence that "tutor guardrails" change outcomes: it restored exam parity, but did not raise it.

## 2. Evidence on learning and skill atrophy

Short version: the effect is real in controlled settings, mostly short-term and small-sample, and strongest when the human *delegates the generation*. The generation effect and desirable difficulties give the mechanism; the 2025-26 studies show it in code.

| Source | What it found | Caveats |
|---|---|---|
| Anthropic, *How AI assistance impacts the formation of coding skills* (Jan 2026, [post](https://www.anthropic.com/research/AI-assistance-coding-skills), [arXiv 2601.20245](https://www.arxiv.org/pdf/2601.20245)) | RCT, 52 mostly junior engineers learning the Trio library. Quiz: AI group 50% vs. hand-coding 67% (d = 0.738, p = 0.01), biggest gap on debugging; ~2 min faster, not significant. Patterns scoring ≥65%: *conceptual inquiry*, *generation-then-comprehension*, *hybrid code-explanation*. Under 40%: *delegation*, *progressive reliance*, *iterative AI debugging*. | Small n; quiz right after the task, so long-term effect unknown; patterns are associations, not causes; vendor-run (the vendor also sells the tool). |
| Bastani et al., *Generative AI without guardrails can harm learning*, PNAS 2025 ([IDEAS](https://ideas.repec.org/a/nas/journl/v122y2025pe2422633122.html)) | ~1,000 Turkish high-school math students. Unrestricted GPT-4: practice +48%, later exam −17% vs. control. Hint-giving "GPT Tutor": practice +127%, exam ≈ control. Students overestimated how much they learned. | Maths, not code; short term. Guardrails prevented harm; they did not create gain. |
| Prather et al., *The Widening Gap*, ICER 2024 ([arXiv 2405.17739](https://arxiv.org/pdf/2405.17739)) | 21 novice programmers observed with eye tracking. Strugglers got worse at metacognition, believed they understood more than they did ("illusion of competence"); "false progression awareness". | n = 21, observational. Novices only. |
| METR, experienced OSS developers (2025, [coverage](https://the-decoder.com/ai-coding-can-make-developers-slower-even-if-they-feel-faster/)) | 16 developers, 246 tasks: AI-allowed tasks took 19% longer, while developers expected −24% and afterwards felt −20%. | Early-2025 tools; senior developers on familiar repos. Speed, not learning, but shows the perception gap. |
| Lee, Sarkar et al., *The Impact of Generative AI on Critical Thinking*, CHI 2025 ([PDF](https://advait.org/files/lee_2025_ai_critical_thinking_survey.pdf)) | Survey of 319 knowledge workers, 936 examples: more confidence in GenAI goes with less critical thinking; more self-confidence with more. Design advice: let users tune assistance to their expertise. | Self-reported effort. |
| Kosmyna et al., *Your Brain on ChatGPT* (MIT Media Lab, 2025, [arXiv 2506.08872](https://www.media.mit.edu/publications/your-brain-on-chatgpt/)) | 54 students, essay writing, EEG: weakest connectivity for the LLM group; LLM-to-brain switchers under-engaged. | Preprint, small, correlational, essays not code; media coverage overstated it. |
| Osmani, *Comprehension debt* (Mar 2026, [essay](https://addyosmani.com/blog/comprehension-debt/)) | The growing gap between code that exists and code a person understands; it "breeds false confidence" because AI output looks polished and tests are green. Distinguishes offloading (keeping architectural judgment) from surrender. | An essay, not a study. Critics say the fix is cheaper regeneration of understanding, not more discipline (summarised in [Tessl's page](https://tessl.io/patterns/changing-roles/comprehension-debt/)). |
| Generation effect: Slamecka & Graf 1978; Bertsch et al. 2007 meta-analysis (reported d ≈ 0.40 over 86 studies, via [secondary source](https://pmc.ncbi.nlm.nih.gov/articles/PMC6099118)); Bjork's *desirable difficulties* | Producing an answer yourself beats reading it, and slower initial learning can improve retention and transfer. | I did not read the originals. Effect is weaker for meaningless material and when working memory is overloaded. |

How this maps to the feature: the Anthropic patterns that preserved learning all kept the human *forming the model first* and asking for explanation after. "Developer writes the skeleton, AI reviews and explains" is that pattern made structural. Bastani's result says a nudge or prompt is not enough: the unguarded condition is what hurt, and students did not notice. That argues for an enforced step, and for showing the developer *evidence* of what they got right and wrong (the diff), because self-assessment is unreliable.

Not found: any study of *design-level* skill (as opposed to syntax or library recall) under AI, and any study of "write the signatures, AI writes the bodies". That is an open question worth treating as an experiment (section 5).

## 3. Pitfalls others hit

- **Friction and abandonment.** Spec workflows read as overkill for small work: Kiro's 4 stories / 16 criteria for a bug, Spec Kit's thousands of Markdown lines, "waterfall with extra steps" ([Fowler](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html), [codemyspec](https://codemyspec.com/blog/github-spec-kit-guide)). Implication: scale to the task, off by default, auto-suggest only for changes that add types.
- **Diagram-code drift.** The central failure of model-driven tools (section 1), and the reason 35 of 50 interviewed professionals used no UML. Tessl's "specs as source" adds non-determinism on regeneration. Implication: never maintain two editable sources. Plan is a snapshot; actual is recomputed.
- **Review fatigue and illusion of competence.** Approving a plan is cheap and feels like understanding. Bastani and Prather both show the self-assessment gap. Implication: require a *production* step (write the skeleton, answer a design question), not only a click.
- **Gamification and surveillance backlash.** Amazon's internal AI leaderboard was shut down after employees said it was easy to game and some reported cheating after a review flagged low AI use (reported via [Mediaweek](https://www.mediaweek.com.au/ai/amazon-scraps-ai-leaderboard-after-workers-caught-cheating); Amazon calls it an unapproved beta). Similar dashboards at KPMG and Disney drew "tokenmaxxing" complaints; DORA says individual scores are harmful and company aggregates meaningless ([DORA](https://dora.dev/insights/finding-balance-in-the-era-of-tokenmaxxing/)). Mostly blogs and trade press; treat details as unverified, the pattern as consistent. Implication: **no scores, streaks, leaderboards or per-developer reports** leaving the machine. Keep results local, shown only to the developer who wrote them. If a team wants a signal, offer team-level, opt-in, outcome-based ones.
- **Learning styles that nobody enabled.** Learning-mode-style products are opt-in prompts; Bastani's students used the free-form tool as a crutch. Implication: default and discoverability matter more than the feature itself, but a default-on mode collides with the friction point above. Level `review` as default-on is a candidate.

## 4. Where Axle could be uniquely good

| Asset | Use |
|---|---|
| Polyglot call-flow index (`src/poly`, tree-sitter) + type boards from a real type index | The **actual** half of plan-vs-actual: classes, members, signatures, relations read from code, for several languages, with no round-trip engine to maintain. Most UML tools had to build a parser; Axle already has one. |
| `draw_board` (flow, plan, class, er, sequence, architecture) + `update_board` | The **plan** half. Boards already carry `file` + `line` links and `status` per node (todo/doing/done/skipped/blocked), which map to "not yet written / matches / differs". |
| `axle` MCP server | New read-only tools (e.g. `check_skeleton`: plan board vs. index → missing / extra / mismatched members). Fits the rule that MCP tools write nothing and run nothing. |
| Harness hooks and permissions (`flow-harness`) | The **lock**: a `PreToolUse` hook on `Edit|Write` that denies edits touching locked signatures and returns a reason; the reference documents `permissionDecision: "deny"` with a reason shown to the agent. Axle ships a hooks studio and can test hooks (`hooks.ts`, verdict `blocked` on deny/exit 2). No other editor in section 1 has this layer. |
| Agent dock | Where the mode switch, "explain my mistakes" and the level picker live. |
| Guided tours (in flight, `docs/design/guided-tours.md`) | The closing "what was filled" tour. Its anchors (file, qualified symbol, line hint) are the same shape a lock needs. |

The combination nobody in section 1 has: a *structural* check of the developer's own code against the agent's design, plus *enforcement* of the human's signatures while the agent writes bodies, plus a tour afterwards.

### Choice: which variant first

| Variant | For | Against |
|---|---|---|
| **A. Skeleton in code, live plan-vs-actual board** | Matches how developers actually work (they sketch, then code; Petre/Baltes). No round-trip, so no drift. Uses assets that exist (index, boards, hooks). Tests the learning hypothesis directly. | Developers who think visually get no diagram editing. Needs a plan-vs-actual diff on signatures, which is new work. |
| B. Diagram-first, generated stubs | Natural for entity/ER-style thinking; lower barrier for people who dislike typing boilerplate. | Needs a board *editor* (UI, undo, validation) and stub generation per language; the first edit after generation starts drift; UML-tool history is the cautionary tale. |
| C. Both, two-way | The most "complete". | That is round-trip engineering. Highest cost and the worst track record. |

**Recommendation: A first.** The diagram is read-only on the plan side, live on the actual side. B arrives later as a one-way "generate stubs from this board" action, once A shows people want it. C only if users demand it, and then as "board edit → patch the code once, no ongoing sync".

### MVP scope (variant A, level `sketch`)

1. Command/dock toggle sets the level; stored per workspace; default `off`.
2. When the agent's plan is approved and the level is `sketch`, the agent calls `draw_board` (class or er) with a plan skeleton (types, member names and signatures, relations) and stops. Prompt text via the existing agent dock; no new protocol.
3. The developer writes types and signatures in the editor. The board recomputes from the type index on save: each node and member shows missing / matches / differs.
4. `check_skeleton` MCP tool (read-only): returns the diff as data. The agent explains each mismatch *with a reason* (a prompt convention, not code).
5. "Accept skeleton" (user click) records the signatures to lock in the workspace (e.g. under `.axle/`, written by the window, not by an MCP tool) and installs a `PreToolUse` deny hook scoped to `Edit|Write` on those files. Bodies are free to change; signatures are not.
6. The agent fills the bodies. A lock hit returns the reason and the allowed route ("ask the developer to change the signature"); the developer can unlock from the board.
7. Close with a tour of the filled bodies once guided tours land. Until then, `open_diff` per method.

Out of scope for MVP: diagram editing, stub generation, `build` level, the fill-in-the-blank quiz, team features, any score or report.

### Open questions

1. **Code, diagram or both?** Recommendation above is code-first; the user's own preference decides, and it may differ by role (backend vs. data modelling).
2. **What is locked?** Names and signatures only, or also relations (inheritance, field types, table columns)? Which changes by the agent are allowed with a stated reason?
3. **Matching rule.** How tolerant is plan-vs-actual: renames, added helper members, generics, language idioms (C# properties vs. Java getters)? Needs golden tests per language, as Axle already does for the poly index.
4. **Where does it hook in?** Claude Code's `ExitPlanMode` is the natural gate, but hooking it is version-dependent (section 1). Alternatives: a `UserPromptSubmit` hook, an MCP-driven handshake, or the dock itself owning the "plan approved" state.
5. **Agent-neutral.** Hooks exist for Claude Code; Codex runs over ACP in the dock. The lock needs an equivalent in every supported agent, or must degrade to a check after the fact.
6. **Is it measurable?** An opt-in, local-only before/after quiz ("which method calls X?") could test whether the step helps, in the spirit of the Anthropic study. Anything that leaves the machine invites the surveillance reaction in section 3.
7. **When to suggest it.** Only when the plan adds or changes types; never for bug fixes. Who decides the default level in a company: the developer, or a team setting? A team setting that forces `sketch` on people is the likely source of resentment.
8. **Does writing signatures actually preserve know-how?** The cited studies cover library learning and maths, not design skill. Treat as a hypothesis; the `review` level is the safe fallback if it does not hold.

## Sources not reachable or not found

Augment Code planning features, Zed agent plans beyond profiles, Copilot Workspace's successor, CS50 duck, Copilot for education, PlantUML/Mermaid code-generation specifics, Umple adoption evidence, Kiro official docs (one search returned unrelated results). Everything marked "unverified" above rests on one secondary source.
