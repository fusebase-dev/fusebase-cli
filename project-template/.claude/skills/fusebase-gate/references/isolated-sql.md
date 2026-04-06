---
version: "1.8.3"
mcp_prompt: isolatedSql
last_synced: "2026-04-06"
title: "Fusebase Gate Isolated SQL Stores"
category: specialized
---
# Fusebase Gate Isolated SQL Stores

> **MARKER**: `mcp-isolated-sql-loaded` — When this marker is present in context, MCP prompts for this topic may skip conceptual sections and use API reference only.

> **VERSION CHECK**: If operations fail unexpectedly, load MCP prompt `isolatedSql` for latest content.

---
## Fusebase Gate — Isolated SQL (`sql` / `postgres`)

### Canonical docs

Repo **`docs/isolated-sql-stores.md`** is the **production runbook** (playbooks, permissions, status/apply semantics, MCP vs SDK). Use it for step-by-step operations.

### Before migration work

Load MCP prompt **`isolatedSqlMigrationDiscipline`** (`prompts_search`, groups `isolatedSql` / `isolated`, or by name). It defines bundle ↔ **`fusebase_schema_migrations`** invariants and drift recovery.

### Standard sequence (schema + store)

1. **`listIsolatedStores`** → **`createIsolatedStore`** (`engine` `postgres`, `storeType` `sql`, `source` `{ sourceType: app, sourceId: … }`, `alias`).
2. **`initIsolatedStoreStage`** for `dev` / `prod` (omit `bindingConfig` when Gate auto-provisions).
3. **`getIsolatedStoreSqlMigrationStatus`** with the **exact bundle** you will apply: read **`canApply`**, **`isDrifted`**, **`pendingCount`**, **`structuredIssues`**. Optionally pass **`expectedLastAppliedVersion`** / **`expectedLastAppliedChecksum`** from a prior status → **409** if the journal tail changed.
4. Optional: **`applyIsolatedStoreSqlMigrations`** with **`dryRun: true`** — same checks, **no** SQL / journal writes.
5. **`applyIsolatedStoreSqlMigrations`** — pending tail only when prefix matches. **409** + **`data.errorCode`** / **`data.issues`** on drift or head mismatch. Prod: automatic checkpoint may run before pending migrations.
6. Verify: **`listIsolatedStoreSqlTables`**, **`getIsolatedStoreSqlStats`**, or **`queryIsolatedStoreSql`** (read-only, **one** statement per call).

`dev` and `prod` are **different databases** — repeat the sequence per stage with the **same logical version line**.

### Data path (no DDL)

Prefer structured APIs: **`getIsolatedStoreSqlStats`**, **`countIsolatedStoreSqlRows`**, **`selectIsolatedStoreSqlRows`**, **`insertIsolatedStoreSqlRow`**, **`batchInsertIsolatedStoreSqlRows`**, **`importIsolatedStoreSqlRows`**, **`updateIsolatedStoreSqlRows`**, **`deleteIsolatedStoreSqlRows`**. Raw: **`queryIsolatedStoreSql`** (read); **`executeIsolatedStoreSql`** — DML only, **no DDL**; schema only via **`applyIsolatedStoreSqlMigrations`**.

### Structured SQL limits

- `select` default `limit=100`, max `500`. Max **20** filters, **5** sort fields.
- **`batchInsertIsolatedStoreSqlRows`**: at most **`floor(65535 / columnCount)`** rows per call (Postgres bind limit); e.g. **~2621** rows at **25** columns.
- **`update`** / **`delete`** need filters unless **`allowAll=true`**.
- Large **data** seeds: **`importIsolatedStoreSqlRows`** (`csv`/`tsv`, **`COPY FROM STDIN`**); default payload cap **64MiB** UTF-8 per call (`ISOLATED_SQL_IMPORT_MAX_PAYLOAD_BYTES`, hard cap **256MiB**); split larger files.

### MCP bundle size

Apply sends **full SQL text** for every migration; JSON grows quickly. Many IDE MCP stacks cap a single **`tool_call`** around **~3,000** characters — parse errors or truncation. **Practical split:** small / single-file migration via MCP for smoke; **real apps → `IsolatedStoresApi` in CI or scripts** reading SQL from disk (see production guide).

### Tokens

Runtime app tokens: usually **`isolated_store.data.write`**, not **`isolated_store.schema.write`** or **`isolated_store.execute`**.

### After a failed apply

Transaction **ROLLBACK** — no journal rows from that attempt. Fix SQL/checksums, retry. A **prod checkpoint** may still exist if created before the failure; it does not prove migrations applied.

### Managed PostgreSQL (Azure, etc.)

**`applyIsolatedStoreSqlMigrations` often fails on the first migration** if SQL contains **`CREATE EXTENSION pgcrypto`** — many hosts do not allow-list it. **Remove it**; use **`DEFAULT gen_random_uuid()`** on PostgreSQL **13+** when **`gen_random_uuid()`** exists without **`pgcrypto`**; else allow-listed **`uuid-ossp`** or app-generated UUIDs.

### `executeIsolatedStoreSql` pitfalls

- **One** statement per call; never `;`-join multiple statements.
- If splitting merged SQL on `;`, **`--` line comments** can swallow the next statement after newlines collapse — strip comments or split carefully.

### Version 1 discipline

Do not **`apply`** throwaway SQL as **v1** on a store that must later use a real **v1** — the journal slot is consumed. Use a disposable store/stage or start with the real first migration.

### Discovery

- **`tools_search`**: parameter **`queries`** (string array, typically 1–10), not a single `query` field.
- Use **`tools_describe`** on **`initIsolatedStoreStage`**, **`getIsolatedStoreSqlMigrationStatus`**, **`applyIsolatedStoreSqlMigrations`** when schemas are unclear.
- Session: **`whoami`** / **`bootstrap`**; context prompts: groups **`authz`**, **`isolated`**, **`isolatedSql`**, **`sdk`** when mirroring in code.

### Manifest / checksums

For **local** storage in a repo, keep migration SQL in a **dedicated folder**; **prefer naming it `migrations`** (e.g. `postgres/migrations/`, `db/migrations/`). Do not mix with application code — easier ordering, review, and CI checksum checks.

Per migration: **`version`**, **`name`**, **`checksum`** — use **SHA-256** / **`sha256`** of the **exact** UTF-8 **`sql`** bytes Gate sends. Optional **`bundleVersion`** on the bundle. Operators often record **`orgId`** / **`storeId`** in repo manifest for CI — not required inside the bundle body.
---

## Version

- **Version**: 1.8.3
- **Category**: specialized
- **Last synced**: 2026-04-06
- **Priority rule**: If the MCP prompt has a higher version, follow the prompt's API Reference as source of truth.
