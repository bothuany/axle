---
name: migration-review
description: Review a database migration against the entity it changes. Use when a migration file or an @Entity or SQLAlchemy model is edited.
---

# Migration review

- The migration and the entity must change in the same commit.
- A dropped column needs a note on which code still reads it: ask the `insilode` MCP for `impact` with the table name.
- New columns are nullable or have a default. A backfill is its own migration.
