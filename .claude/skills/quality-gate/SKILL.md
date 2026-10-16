---
name: quality-gate
description: Run Axle's local quality gate (architecture rules, Semgrep, the extension and canvas tests, optionally SonarQube) and summarize what fails. Use before committing or opening a pull request, or when asked to "check everything".
disable-model-invocation: true
argument-hint: "[--sonar]"
---

Run these from the repo root, in order, and keep going after a failure so the summary is complete:

1. `npm run arch` — dependency rules and architecture tests.
2. `npm run semgrep:test` then `npm run semgrep` — Axle's rules against their fixtures, then the full scan.
3. `cd editor/extensions/flow-view && npm test`, `cd editor/extensions/flow-agent && npm test`.
4. `cd ui && npm run typecheck`.
5. Only when `$ARGUMENTS` contains `--sonar`: `npm run sonar:up` then `npm run sonar`. If it stops for a missing token, relay the setup line it prints; never create the token or log in yourself.

Then report one line per step (pass / fail and the count), followed by each failure with `file:line` and the message.
Do not fix anything unless asked. Never run `npm run setup` (it takes 10-20 minutes) unless asked; if a type check needs it, say so.
