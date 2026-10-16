---
name: update-golden
description: Regenerate flow-view's golden (snapshot) test output after an intended change to the index or the type boards, then explain every changed snapshot so the user can accept or reject it. Use when `npm test` in flow-view fails on a snapshot mismatch or a missing snapshot.
disable-model-invocation: true
argument-hint: "[poly|types|all]"
---

Golden files are the accepted output of the indexer: `editor/extensions/flow-view/test/expected/*.txt` (flows per fixture, written by `test/poly.test.mjs`) and `test/types-expected/*` (type boards, written by `test/types-boards.test.mjs`). They are never edited by hand; regenerating them is safe only when every change in them is explained by a source change.

1. Make sure the snapshot folders have no uncommitted changes first: `git status --porcelain -- editor/extensions/flow-view/test/expected editor/extensions/flow-view/test/types-expected`. If they do, stop and ask: regenerating would mix those edits into the new diff.
2. Run from `editor/extensions/flow-view`, depending on `$ARGUMENTS` (default `all`):
   - `poly`: `node esbuild.mjs`, then `UPDATE=1 node --test test/poly.test.mjs`
   - `types`: `node esbuild.mjs`, then `UPDATE=1 node --test test/types-boards.test.mjs`
   - `all`: `UPDATE=1 npm test`
3. Run `npm test` again without `UPDATE` and confirm it passes.
4. Read `git diff --stat` and `git diff` of the two folders, plus any new untracked snapshot files. Compare them with the source change that caused them (`git diff -- src`).
5. Report per changed snapshot file: what changed (flows, edges, routes, tables, types added or removed) and whether the source change explains it. Mark anything unexplained as **suspicious**: a flow or table that disappeared, routes renamed with no route code changed, a fixture the change should not reach.
6. If anything is suspicious, suggest running the `golden-diff-reviewer` agent and stop. Never commit, and never revert the snapshots yourself: the user decides.
