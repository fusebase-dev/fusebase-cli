---
version: "1.1.3"
mcp_prompt: isolatedSqlMigrationDiscipline
last_synced: "2026-04-06"
title: "Fusebase Gate — Isolated SQL migration discipline"
category: specialized
---
# Fusebase Gate — Isolated SQL migration discipline

> **MARKER**: `mcp-isolated-sql-migration-discipline-loaded` — When this marker is present in context, MCP prompts for this topic may skip conceptual sections and use API reference only.

> **VERSION CHECK**: If operations fail unexpectedly, load MCP prompt `isolatedSqlMigrationDiscipline` for latest content.

---
## Isolated SQL — migration discipline (anti-drift)

Use **before** building, editing, or sending a bundle to **`getIsolatedStoreSqlMigrationStatus`** / **`applyIsolatedStoreSqlMigrations`**. For full playbooks see repo **`docs/isolated-sql-stores.md`**.

## What drift is

**Drift** = the ordered **applied prefix** of your bundle (versions already in **`fusebase_schema_migrations`**) does not match the journal: same order and, for each applied row, same **`version`**, **`name`**, **`checksum`**, and **`sql`** bytes as Gate expects from the bundle.

On apply: **HTTP 409**, **`data.errorCode`** **`isolated_sql_migration_drift`**, **`data.issues[]`** (journal vs bundle fields; checksum rows may include **`bundleSqlContentSha256`** — not raw SQL). On status: **`isDrifted`**, **`structuredIssues`**, **`canApply`** false.

## Invariants

1. **Repo + manifest** own canonical SQL; store migration **`.sql`** files under **`postgres/migrations/`**, not alongside random app code, so history stays clear. The journal records what ran — **never hand-edit** journal rows to force a match.
2. **Immutable applied prefix** — do not change **`name` / `checksum` / `sql`** for versions already applied to a stage you keep.
3. **Fixes = new tail versions** only (K+1, K+2, …), never rewrite applied files.
4. **Prefix alignment** — first **N** bundle entries must match journal **1..N**; **pending** = tail after **N**.
5. **dev / prod** — same logical version line and SQL per version; **separate** DBs and journals. Prod may lag dev.
6. **MUST flow order** — for any schema change: create/update files in **`postgres/migrations/`** first, compute checksum from file bytes, then run status, then apply.
7. **Inline SQL restriction** — inline SQL in MCP `tool_call` is allowed only for one-off smoke/dev tests and must be explicitly marked temporary.
8. **Final gate** — do not mark work done when schema changed but no new/updated migration file or manifest entry exists under **`postgres/migrations/`**.

## Required artifact after schema ops

Always leave these fields in the handoff/log: migration file path, **`version`**, **`name`**, **`checksum`**, **`storeId`**, **`stage`**.

## Fixing drift (allowed)

- **Journal is truth** — restore bundle prefix from last good commit / backup to match journal, then append new versions.
- **Disposable dev** — recreate stage or empty DB, re-apply from v1. **Not** for prod without operator decision.
- **Forbidden** — mutating or deleting rows in **`fusebase_schema_migrations`**, or DDL via **`executeIsolatedStoreSql`** to paper over mismatch.

## Checklist (every status / apply)

- [ ] Versions strictly increasing; one entry per version.
- [ ] **`checksum`** = SHA-256 of exact UTF-8 **`sql`** you send.
- [ ] No silent edits to already-applied files.
- [ ] **Prod:** **`getIsolatedStoreSqlMigrationStatus`** with the **same** bundle → then **`applyIsolatedStoreSqlMigrations`**; confirm **`canApply`** / **`pendingCount`**.
- [ ] Optional **`dryRun: true`** on apply, or **`expectedLastAppliedVersion` / `expectedLastAppliedChecksum`** on status or apply (409 if journal head moved).
- [ ] On errors, read **`structuredIssues`** or **`data.issues`** before guessing.

## What prompts do not replace

**CI** (checksum verify script), **code review**, and **live status** — not chat memory. Require checksum verification to pass before done/deploy.

## Managed hosts (UUID / extensions)

Avoid **`CREATE EXTENSION pgcrypto`** on locked-down hosts; prefer **`gen_random_uuid()`** defaults on PG **13+** when available (see **`isolatedSql`** prompt).

## With `isolatedSql`

**`isolatedSql`** = CRUD, limits, snapshots, MCP vs SDK. **This prompt** = journal discipline only. Load **both** for schema work.
---

## Version

- **Version**: 1.1.3
- **Category**: specialized
- **Last synced**: 2026-04-06
- **Priority rule**: If the MCP prompt has a higher version, follow the prompt's API Reference as source of truth.
