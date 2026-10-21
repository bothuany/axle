# Skeleton-first HITL: council verdict

Run on 2026-10-20. Six agent members researched the idea on the web, each from one perspective. They then answered each other in one rebuttal round, and the chair (the session that ran them) wrote this synthesis. The idea, variant A and the earlier evidence are in [skeleton-first-landscape.md](skeleton-first-landscape.md). This document does not repeat them.

Members: an enterprise engineering manager, a senior developer and skeptic, a learning scientist, a product strategist, a UX designer and a devil's advocate. Most member sources are search snippets or secondary pages. The chair opened four that carry the verdict (marked ✔ under Sources). Treat everything else as unverified.

## Verdict

**Build a cheap experiment first. Do not build variant A as written.** Confidence 75%.

The idea is not silly. Three things about it are real:
- **The problem.** Skill loss from AI help shows up in controlled and observational studies:
  - the Anthropic RCT on learning a library;
  - Bastani et al. in maths;
  - a 2025 Lancet study where endoscopists' unassisted detection rate fell from 28.4% to 22.4% after AI exposure.
- **The gap in the market.** No tool found asks the developer to produce *code structure* and checks it against a design. Every competitor has humans edit prose plans.
- **Axle's position.** It owns the parts that would be hard to copy: a type index, boards, tours and hooks.

The **order of steps in variant A** defeats its own goal. In variant A, the agent draws the design and then the developer types it into code. That is transcription. The generation effect comes from *producing* an answer before seeing it, and copying is the control condition it is measured against. This was the one point all six members accepted by the end of the rebuttal round.

The fix is cheap: **the developer sketches first, then the agent reveals its design, and the two are compared.** This keeps most of variant A's parts (skeleton in the editor, live board, Check, handover, tour) and swaps steps 1 and 2.

All six members independently chose "cheap experiment first", with confidence between 65% and 75%. No one voted to build the full feature now, and no one voted to drop it. After rebuttals, confidences were: manager 65%, skeptic 72%, learning scientist 65%, strategist 70%, UX 70%, devil's advocate 70%.

## What the council agreed on

1. **Variant A as written is transcription.** The learning scientist, devil's advocate and skeptic raised this in round 1, and the others conceded it in round 2. A learning benefit needs a commitment *before* the reveal:
   - **Predict-first:** the developer writes or sketches the types and relations.
   - **Cheaper:** the agent's diagram with some nodes blanked, which the developer fills in (Parsons-style completion).
2. **Check is the valuable step, if it explains and does not grade.** It is the consolidation phase after an attempt (productive failure, self-explanation, Bisra 2018 g ≈ 0.55, unverified). It must let the developer win:
   - a "Mine is better" path makes the agent argue its case and updates the plan when the developer prevails;
   - otherwise the colours teach conformity ("green = agreed with the AI").
3. **It is a per-task offer, not a mode.**
   - Offer it once, at plan approval, and only when the plan adds or changes types, entities or interfaces. Never offer it for bug fixes, renames or small edits.
   - "Just do it" is as large as "Sketch".
   - Stop offering after two dismissals in a row.
   - Proactive suggestions at workflow boundaries got about 52% engagement, while mid-task prompts were dismissed about 62% of the time (15-developer field study ✔).
4. **Forcing functions work, and people dislike them.** In Buçinca et al. (N=199 ✔), the designs that most reduced overreliance on AI got the lowest ratings. So keep the step short (about 2 minutes), skippable, and with no visible timer or score.
5. **Nothing is mandated, nothing leaves the machine, and there are no per-person scores.** No regulation requires this:
   - EU AI Act Art. 14 oversight is for high-risk systems.
   - Change control under the EU's DORA (Digital Operational Resilience Act) does not care which tool made a change.
   - Amazon's AI leaderboard and DORA's guidance (the DevOps Research and Assessment programme, a different DORA) show the backlash against scoring individuals.
6. **The first step needs no deterministic matcher.** The agent can compare the developer's sketch with its own design in prose, using `draw_board` and a prompt or skill. A type-index matcher comes in phase 2, if usage earns it.
7. **Warn-only is accepted, and the signature warning is the part people would use daily.**
   - It needs to show the exact symbol and a diff, with Accept / Revert in one click.
   - It is a passive chip, not a modal, and fires once per change.
   - It turns into noise if it fires on every refactor.

## Where the council disagreed

| Question | Positions | Chair's call |
|---|---|---|
| Should the warning acknowledgement leave the editor (PR comment or commit trailer)? | **Manager:** yes, a trailer such as "AI changed N developer-owned signatures; the author acknowledged them" is the only artifact a lead or auditor can use. **UX:** only if the developer chooses it; never automatic, never per-person. | Offer an optional per-warning "Add note to PR" button, off by default. Revisit a team-policy default only after a team asks for it. |
| How much does the matcher cost? | **Devil's advocate:** L effort across 8 languages, and false "differs" teach users to ignore the colours. **Strategist and devil's advocate after rebuttal:** M if scoped to type names and relations, one language first, renames handled by an explicit "map to" action. | Phase 2 only, scoped to names and relations, one language first. Signatures come later. |
| Predict, or choose among agent designs? | **Skeptic:** seniors already pick among agent designs (Matt Pocock's "design an interface" skill) and won't write signatures. **Learning scientist:** choosing is recognition, weaker than recall, and invites justifying the choice after the fact. Commit to a one-line pick or shape first, then see the options. | Both are allowed in the experiment: the "sketch" can be one line. The developer must commit before the reveal in either case. |
| Levels off / review / sketch / build | **UX:** drop them for a single offer plus a setting "never / when the plan adds types / always". **Manager:** keep a team policy file that sets the default level. | One offer, with a setting of three values. A team file may set the setting's default, never force it on. |
| Is a prompt-only version a moat? | **Strategist:** no; rivals can add a prompt in a week. **Everyone:** the experiment tests demand, not defensibility. | The moat (a type-index diff, boards, tours) is built only after the demand signal. |
| Will seniors use it? | **Skeptic:** off by day two unless opt-in, under 2 minutes, and only for domain models, public APIs and schemas. **Learning scientist:** the expertise-reversal effect agrees: the step is pure overhead for experts on trivial plans. | Fade the offer for people who predicted well three times. The main audience is juniors, newcomers to an area, and design-heavy tasks. |

## Top risks and mitigations

| Risk | Mitigation |
|---|---|
| **No learning happens.** Developers paste the agent's draft, or the sketch is too constrained. | Predict-first ordering. Track the skip/trivial-sketch rate locally and kill the feature if it stays above 50%. |
| **Friction leads to abandonment** (Kiro and Spec Kit "overkill" complaints). | One-click offer only on type-adding plans, a 2-minute sketch, "Just do it" equally prominent, and an offer that fades. Kill if 40% or more of started sketches are abandoned. |
| **Conformity.** The AI becomes the answer key. | Use "differs", never "wrong". Explain trade-offs. Make "Mine is better" a first-class action that updates the plan. Track how often the developer wins; near 0% is a red flag. |
| **Surveillance creep**, turning it into a manager dashboard. | Local-only metrics shown only to the developer. No per-person aggregation and no automatic PR artifacts. Outward artifacts only by the developer's own click. |
| **Maintainer cost and false diffs.** | No matcher in phase 1. In phase 2, names and relations only, one language first, an explicit rename mapping, and golden tests per language as the poly index already does. |
| **Agent-neutral support** (Claude Code and Codex). | Phase 1 is a prompt or skill plus MCP tools, which works with any agent in the dock. The warning comes from Axle's own index, not from agent hooks. |
| **Unprovable benefit.** A single user or team has no statistical power. | Treat the metrics as kill criteria and personal feedback, not proof. Say so in the UI and docs. |
| **The target moves.** Models out-design juniors, so "match the AI" loses value. | Frame the skill as *judging and owning* designs ("author of record for structure"), not matching the AI's taste. |

## Recommended experiment ("Sketch first", about 4 weeks)

**Build (S–M, no new engine):**

1. **The offer.** At plan approval, in the agent dock: "Sketch your design first? [Sketch ~2 min] [Just do it]". Show it only when the plan adds or changes types (the agent states this; no detection logic yet). Stop after 2 dismissals per repository; there is a menu item to offer it again.
2. **The sketch.** The developer writes a rough skeleton in the editor, or a one-line list of types and relations in the dock. Untidy is fine.
3. **The reveal.** The agent calls `draw_board` (class or ER) with its own design. It then compares that with the developer's sketch in prose: "you and the plan differ here". Each difference comes with a reason, phrased as a trade-off. "Mine is better" makes the agent argue its case, and the plan updates if the developer prevails. This is an `axle` MCP prompt or skill plus a convention in the agent instructions, with no new MCP write tools.
4. **Handover.** The agent fills the bodies. A **signature warning** appears as a passive chip with a diff and Accept / Revert.
   - **What exists today:** `TurnImpact` (`src/mcp/turnImpact.ts`) already records which methods each agent turn's edits landed in, with name, file and line.
   - **What is new:** comparing the declaration lines of the developer's sketched types and methods before and after the turn.
   - **Phase 1 version:** a text diff of those declaration lines, with no language-aware matching. If even that turns out noisy, the warning moves to phase 2 rather than the experiment growing.
5. **Debrief.** A 3–5 stop closing tour of what the agent filled, in risk order, using the guided-tours `tour` tool once that lands. Optional explain-back: the developer explains the change in a few sentences, and the agent points out gaps.

**Out of scope:** the deterministic plan-vs-actual matcher, variant B (diagram editing and stub generation), signature locks, levels, team features, and anything that leaves the machine.

**Variant B, in one line:** editing a diagram is a valid predict-first surface only if it starts from a blank or partly blanked canvas; the skeptic expects it to be lower friction for people who think visually. B starting from the agent's diagram is transcription again. Either way it needs a board editor, so it waits for the phase-2 gate.

**Who pilots:** the maintainer plus 4–9 colleagues, on real work, for 4 weeks. Everyone uses the same build. Each person's metrics stay on their own machine; anyone who wants to can share their own numbers by hand at the end.

**Comparison condition:** on eligible plans, Axle alternates between two orders:
- **sketch-first** (the experiment);
- **variant A's original order**, where the agent draws and the developer types.

The developer can override the order with one click. "Just do it" sessions are a second, weaker comparison, since they mix in self-selection. Without this alternation, the retention metric below has nothing to compare against.

**Local-only success metrics (stored on the machine, visible only to the developer, exportable by them):**

| Metric | Signal | Kill or rework threshold |
|---|---|---|
| Offer acceptance on eligible plans | Demand | Below 15% after 4 weeks |
| Repeat use (users who use it again in a later week) | Real value, not novelty | Below 20% after 4 weeks |
| Skip or trivial-sketch rate (sketch skipped, empty, under 2 types, or edited to match the reveal before Check runs) | Learning happening at all | Above 50% |
| Abandoned sketches | Friction | Above 40% |
| Extra time from plan approval to handover | Cost | Median above 10 min on plans with 3 or fewer types |
| "Mine is better" accepted | Debate, not conformity | About 0% over 20 sessions |
| Signature warnings per handover | Agent respects the developer's design | Above 30% means the agent prompt is broken, not the idea |
| Optional delayed explain-back (a week later, explain a past design from a blanked diagram) | Retention | Sketch-first sessions under 10 points better than the alternated "agent drew, I typed" sessions after about 15 pairs per person |
| One-line usefulness rating | Satisfaction | Median below 3/5 after 20 sessions |

All thresholds are the members' own judgement, not taken from the literature.

**Gate to phase 2:** invest in the scoped type-index matcher only if all of these hold:
- at least half the pilot group (and at least 3 people) repeat the flow weekly for 4 weeks;
- at least a third of sessions end with the developer asking "which of mine differs?", which shows the deterministic check is what is missing;
- no kill threshold has tripped.

Phase 2 is variant A's live board, with one change: it is recomputed against **the developer's own pre-reveal skeleton**, not the agent's.

## What would change the verdict

**Toward building variant A now:**
- a study showing that writing signatures retains design skill better than explain-back;
- a company or team asking for it, or a regulator or auditor accepting an acknowledgement log as evidence of human oversight;
- pilot users repeatedly asking for the coloured diff.

**Toward building the matcher sooner:** the phase-2 gate above. A competitor (Kiro, Cursor, Copilot) shipping a prompt-level version would also shift the moat argument toward the type-index diff.

**Toward not building at all:**
- seniors and juniors alike disable it within a week, or the skip/trivial-sketch rate stays above 50%;
- delayed explain-back shows no difference between sketch-first and agent-drew sessions;
- Check mostly repeats what the compiler or linter already says;
- tours alone produce the same explain-back results, which would make tours the cheaper answer.

**Toward a different product:** evidence that the governance value (a signature-change log at the PR) matters more to buyers than learning. That is a smaller, separate feature that needs no sketch step.

## Sources

✔ = opened by the chair. Unmarked = seen by a member in search results or a secondary page, not verified.

**Learning and deskilling**
- ✔ Budzyń et al., *Endoscopist deskilling after exposure to AI in colonoscopy*, Lancet Gastroenterol Hepatol 2025;10(10). Unassisted adenoma detection fell from 28.4% to 22.4%, OR 0.69. [Warwick repository](https://wrap.warwick.ac.uk/id/eprint/191005)
- ✔ Shen & Tamkin, *How AI Impacts Skill Formation* (the Anthropic RCT). [arXiv 2601.20245](https://arxiv.org/abs/2601.20245) and [Anthropic post](https://www.anthropic.com/research/AI-assistance-coding-skills). The 50% vs 67% figure and the pattern split come from the post, as read in the landscape doc. The arXiv abstract page does not show them.
- Bertsch et al. 2007, generation-effect meta-analysis, d ≈ 0.40. [PubMed](https://pubmed.ncbi.nlm.nih.gov/17645161/)
- Review of generation constraints (126 articles). [Springer](https://link.springer.com/article/10.3758/s13421-021-01218-6)
- Rowland 2014, testing-effect meta-analysis. [PDF](https://courseware.epfl.ch/assets/courseware/v1/fdde2f0aa590bf3b1324077a6bf1540c/asset-v1%3AEPFL%2BDEMO%2B2020%2Btype%40asset%2Bblock/Rowland2014-meta-analysis.pdf)
- Pretesting effects and learners' beliefs about them. [PMC review](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9839203/)
- Productive failure and preparatory activities (Kapur and colleagues). [Springer](https://link.springer.com/article/10.1007/s11423-018-9579-9). Which paper this is is unverified.
- Bisra et al. 2018, self-explanation, g = 0.55. [PDF](https://www.gwern.net/doc/psychology/spaced-repetition/2018-bisra.pdf)
- Parsons-problem variants. [arXiv 2512.22407](https://arxiv.org/pdf/2512.22407)
- Scaffolded self-explanation for code comprehension. [NSF PAR](https://par.nsf.gov/biblio/10447589-improving-code-comprehension-through-scaffolded-self-explanations), [Memphis](https://digitalcommons.memphis.edu/facpubs/2347)
- Retrieval practice in 50 classroom experiments. [WGU summary](https://guidance.wgu.edu/patterns/resources/retrieval-practice-consistently-benefits-student-learning-a-systematic-review-of-50-experiments-in-schools-and-classrooms)
- Aviation automation complacency. [Flying](https://www.flyingmag.com/automation-paradigm/), [AirlineRatings](https://www.airlineratings.com/articles/cockpit-automation-leading-airline-industry-complacency)

**HCI and UX**
- ✔ Buçinca, Malaya & Gajos, *To Trust or to Think* (CSCW 2021, N=199). [arXiv 2102.09692](https://arxiv.org/abs/2102.09692)
- ✔ *Developer Interaction Patterns with Proactive AI: A Five-Day Field Study* (15 developers). [arXiv 2601.10253](https://arxiv.org/abs/2601.10253)
- Forcing functions on execution plans in writing. [arXiv 2601.18033](https://arxiv.org/abs/2601.18033)
- AnchoredAI, agency and ownership. [arXiv 2509.16128](https://arxiv.org/pdf/2509.16128)
- Horvitz, mixed-initiative principles. [erichorvitz.com](https://erichorvitz.com/uiact.htm)
- Code ownership versus AI autonomy. [Drexel](https://researchdiscovery.drexel.edu/esploro/outputs/conferenceProceeding/Whose-Code-Is-It-How-AI/991022166402204721)
- Reviewers judging AI assertions. [arXiv 2601.19287](https://arxiv.org/abs/2601.19287v1) (snippet only)

**Enterprise and compliance**
- BaFin on AI in ICT risk management. [Jones Day](https://www.jonesday.com/en/insights/2026/01/bafins-expectations-for-ict-risk-management-and-the-use-of-ai)
- DORA Art. 9 change control. [Scrums.com](https://scrums.com/blog/dora-compliance-banking-devops) (secondary)
- EU AI Act Art. 14 scope. [SSRN](https://papers.ssrn.com/abstract=5147196)
- Amazon outages and senior sign-off, March 2026. Amazon contests the account. [OECD.AI incident](https://oecd.ai/en/incidents/2026-03-10-01aa)
- Survey of 219 engineering leaders, 54% worried about shared understanding (vendor survey). [Augment](https://augmentcode.com/resources/state-of-ai-native-engineering-2026)
- Gartner *Predicts 2026*, abstract only. [Gartner](https://www.gartner.com/en/documents/7149930)
- Stack Overflow 2025 survey on trust. [ADTmag](https://adtmag.com/Blogs/WatersWorks/2026/01/Stack-Overflow-Survey.aspx)
- DORA 2025 report. [InfoQ](https://www.infoq.com/news/2025/09/dora-state-of-ai-in-dev-2025)

**Market and practice**
- Comprehension debt (Storey, Osmani). [Faros](https://www.faros.ai/blog/comprehension-debt-in-software-engineering), [Osmani](https://addyosmani.com/blog/comprehension-debt/)
- Spec Kit status. [codemyspec](https://codemyspec.com/blog/github-spec-kit-guide), [Spec Kit vs Kiro](https://codemyspec.com/blog/spec-kit-vs-kiro)
- Kiro pricing (third party; verify at kiro.dev). [morphllm](https://morphllm.com/kiro-pricing)
- Kiro coverage. [InfoQ](https://infoq.com/news/2025/08/aws-kiro-spec-driven-agent)
- Fowler on spec-driven tools. [martinfowler.com](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)
- Claude Code output styles (Learning, `TODO(human)`). [docs](https://code.claude.com/docs/en/output-styles)
- Learning mode coverage. [Engadget](https://engadget.com/ai/anthropic-brings-claudes-learning-mode-to-regular-users-and-devs-170018471.html)
- Cursor plan mode. [blog](https://cursor.com/blog/plan-mode)
- Cursor experimental "interface agent". [changelog](https://cursor.com/changelog/0-2-46-nightly)
- Type-driven prompting in practice. [understandingdata](https://understandingdata.com/posts/type-driven-development/)
- Pocock-style "design an interface" skill (mirror; original unverified). [claudeskills.info](https://claudeskills.info/skills/vinvcn/mattpocock-skills-zh-cn/design-an-interface/)
- Sourcegraph vs Swimm pricing (third party). [toolradar](https://toolradar.com/compare/sourcegraph-vs-swimm)
- Tessl pricing (third party). [aicoolies](https://aicoolies.com/pricing/tessl)

**Not found by any member:**
- a study of design-level skill retention in professional developers;
- adoption data for Claude Code's Learning style;
- any 2026 tool that checks a human-written skeleton against a design;
- current status of Copilot's plan agent and Junie's ask mode.
