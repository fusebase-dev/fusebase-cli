---
version: "1.1.2"
mcp_prompt: none
source: "docs/isolated-sql-stores.md"
last_synced: "2026-04-13"
title: "Isolated SQL stores and migrations (Gate)"
category: specialized
---
# Isolated SQL stores and migrations (Gate)

> **SOURCE**: This file is copied from `docs/isolated-sql-stores.md` in the fusebase-gate repo. Edit that file, then run `npm run mcp:skills:generate`.

---
# Isolated SQL stores — production guide (Gate)

End-to-end reference for **`sql` / `postgres`** isolated stores: MCP tools, `@fusebase/fusebase-gate-sdk` (`IsolatedStoresApi`), permissions, migrations, and failure modes.  
**Contracts:** `src/api/contracts/ops/isolated-stores/isolated-stores.ts`.

Current stable baseline (2026-04-12):

- new SQL apps can be bootstrapped through Gate with ordered migration bundles and read-only or read/write runtime paths;
- Gate persists the latest applied/adopted SQL migration bundle into stage metadata;
- Studio can render migration status from Gate metadata without local app-repo access;
- remaining issues observed in dev are non-blocking UI/style issues, not isolated-store core flow regressions.

Current rollout position (2026-04-12):

- dev rollout under `isolated-stores` flag is active;
- production pilot target is our managed apps plus selected client projects, not broad public self-serve release;
- current baseline provider path for `postgres` remains Azure;
- `Neon` is under evaluation as a future provider option, not as a replacement for Gate contracts or the current `v1` rollout path.

---

## 1. Quick decisions

| Goal                      | Use                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| Create store + DB stage   | `createIsolatedStore` → `initIsolatedStoreStage`                                                   |
| Change schema (DDL)       | **Only** `getIsolatedStoreSqlMigrationStatus` + `applyIsolatedStoreSqlMigrations` (ordered bundle) |
| Insert/update/delete rows | Structured row APIs (`insertIsolatedStoreSqlRow`, …) or read-only `queryIsolatedStoreSql`          |
| Seed / backfill data      | Structured row APIs or `importIsolatedStoreSqlRows` (CSV/TSV → `COPY`)                             |
| Chat / MCP smoke test     | One small migration **or** status + dryRun; big bundles → **SDK/CI**                               |
| Understand drift / 409    | Response `structuredIssues` / error `data.issues`; MCP prompt **`isolatedSqlMigrationDiscipline`** |

---

## 1.1 Current managed-store capability summary

For `sql/postgres`, the current managed-store path already supports:

- app-bound store registration
- dedicated `dev` / `prod` stage databases
- migration status / dry-run / apply with a stage-local journal
- structured row CRUD
- batch insert and CSV/TSV import via `COPY`
- stage stats, table introspection, counts, and query/select paths
- checkpoints and full stage restore
- Studio migration/status rendering via bundle metadata persisted by Gate

What it does not yet fully productize:

- app release pipeline delivery of migration bundles
- first-class snapshot preview API
- completed SQL RLS enforcement layer
- production-grade retention / external snapshot storage policy

For the next production-pilot cut, the main remaining tasks are:

- backup / restore path that is safe enough for managed apps and selected client projects;
- migration / copy flow for managed apps;
- minimal frontend/backend execution split that does not rely only on skills;
- a stable operator-facing path into store management (Studio path is acceptable for the pilot).

Items that can wait for public-release hardening:

- full frontend/backend token split;
- public account / NX-facing store UI;
- autoscaling / multi-instance provider work;
- polished external snapshot UX.

---

## 1.2 Provider note — Neon vs current Gate path

`Neon` is worth evaluating as a PostgreSQL provider option, but it does **not** replace the need for the current Gate-owned contract.

What Neon brings officially that is relevant here:

- serverless Postgres access over `HTTP` / `WebSockets`;
- compute autoscaling;
- branching / point-in-time restore primitives;
- agent-oriented packaging;
- AWS and Azure deployment regions.

What still has to remain Gate-owned even if Neon is adopted underneath:

- app/store binding;
- token permissions and `resource_scope`;
- stage lifecycle semantics (`dev` / `prod`);
- migration discipline and stage-aware apply flow;
- frontend-safe structured operations vs backend-only privileged execution;
- store control-plane lifecycle and Studio-facing metadata.

Practical comparison:

- if the question is infra/provider ergonomics, `Neon` may be stronger than a self-managed path on:
  - cost elasticity
  - provisioning speed
  - built-in branch/restore primitives
- if the question is app/runtime contract, `Neon` does not remove the need for `Gate`;
- `HTTP` transport itself is not a blocker:
  - toolized SQL over MCP / HTTP is already a normal pattern
  - in current tests we have not seen codegen regressions caused by the Gate HTTP path
  - MCP agents here should not treat raw SQL as the primary contract anyway

Current recommendation:

- keep Azure as the near-term production-pilot baseline;
- treat Neon as a provider experiment for a later hardening step;
- do not let provider selection delay the current migration / backup / managed-app rollout tasks.

---

## 2. Permissions (typical)

| Capability              | Permission                                                                       |
| ----------------------- | -------------------------------------------------------------------------------- |
| Row CRUD, import, query | `isolated_store.read` + `isolated_store.data.write` (as designed for your token) |
| **Apply migrations**    | `isolated_store.schema.write` (operators / CI — not normal end-users)            |
| Raw DML escape hatch    | `executeIsolatedStoreSql` — **no DDL**                                           |
| List/create stores      | Control-plane permissions on isolated-store ops                                  |

Schema **never** goes through `executeIsolatedStoreSql`.
Operator migration calls do not require a session-backed user anymore: token-auth requests with the right permission can apply migrations through HTTP/SDK, and Gate records a stable token actor label in the audit fields when no concrete `userId` is present.
After a successful SQL migration apply or baseline adoption, Gate stores the latest bundle and schema name in the stage `provisioningMetadata`. Studio can use that metadata to show migration status without access to the app repo.

For the midsize-target PostgreSQL Row-Level Security path and the recommended Gate integration model, see [isolated-sql-rls-plan.md](./isolated-sql-rls-plan.md).

---

## 3. Identifiers you must preserve

Every call needs **`orgId`**, **`storeId`**, **`stage`** (`dev` | `prod`) exactly as Gate returned them.  
**`dev` and `prod` are different databases** — same logical migration _sequence_ (version numbers + SQL per version), separate journals.

---

## 3.1 Bundle assembly in the app / agent

If the app or its coding agent can read the migration `.sql` files, prefer the Gate SDK helper instead of hand-building JSON:

- `buildSqlMigrationBundle({ bundleVersion?, migrations })`
- `calculateSqlMigrationChecksum(sql)`

Typical flow:

1. Read ordered `.sql` files from the app repo.
2. Pass `version`, `name`, and exact SQL text into `buildSqlMigrationBundle(...)`.
3. Send the resulting bundle to:
   - `getIsolatedStoreSqlMigrationStatus`
   - `applyIsolatedStoreSqlMigrations`

This keeps checksum generation canonical and avoids agent drift from ad-hoc hashing logic.

---

## 4. Playbook A — New store (first time)

1. **`listIsolatedStores`** (`orgId`, optional `clientId` for app-scoped tokens). Empty list is normal before create.
2. **`createIsolatedStore`** — `storeType: "sql"`, `engine: "postgres"`, `alias`, `source: { sourceType: "app", sourceId: "<app id>" }`.
3. **`initIsolatedStoreStage`** — `stage: "dev"` (then `"prod"` when needed). Omit `bindingConfig` if Gate auto-provisions (see repo README / `ISOLATED_PG_*`).
4. **`applyIsolatedStoreSqlMigrations`** — full ordered bundle for that `storeId` + `stage` (or SDK equivalent).

**Empty `listIsolatedStores` after create:** wrong `orgId`, or `clientId` filter does not match `source.sourceId` — omit `clientId` to list all org stores.

---

## 5. Playbook B — Schema change (production-safe)

Do this **per stage** you care about (usually **dev** first, then **prod**).

1. **Load context** — MCP: `prompts_search` groups `authz`, `isolated`, `isolatedSql`, `sdk`; before touching bundles load **`isolatedSqlMigrationDiscipline`**.
2. **Build the bundle** from repo files + manifest: strict increasing **`version`**, stable **`name`**, **`checksum`** = SHA-256 of **exact UTF-8 bytes** of **`sql`** (whitespace matters).
3. **`getIsolatedStoreSqlMigrationStatus`** — same `storeId`, `stage`, **`bundle`** you will apply.
   - Check **`canApply`** / **`isDrifted`**, **`pendingCount`**, **`structuredIssues`**.
   - Optional optimistic lock: pass **`expectedLastAppliedVersion`** / **`expectedLastAppliedChecksum`** from your _previous_ status if you want Gate to **409** when someone else migrated first.
4. **Optional preflight** — **`applyIsolatedStoreSqlMigrations`** with **`dryRun: true`** (same body otherwise): validates prefix + locks, **no SQL executed**, no journal writes; response includes full **`status`**.
5. **`applyIsolatedStoreSqlMigrations`** — same bundle; prod may create an automatic **checkpoint** before pending migrations run.
6. **Verify** — `listIsolatedStoreSqlTables`, `getIsolatedStoreSqlStats`, or `queryIsolatedStoreSql` (one statement per call).

**Never** edit **`name` / `checksum` / `sql`** for versions already in **`fusebase_schema_migrations`**; ship fixes as **new higher versions**.

---

## 6. API semantics — status vs apply

### Status (200)

- **`isDrifted`**: bundle prefix does not match journal → **`canApply`** is false, **`structuredIssues`** lists per-version mismatches (journal vs bundle; checksum issues may include **`bundleSqlContentSha256`** — not raw SQL).
- Pending tail: **`pendingMigrations`** when not drifted.

### Apply

- **200** — migrations ran (or **dryRun** returned validation only).
- **409** — **`data.errorCode`**:
  - **`isolated_sql_migration_drift`** — prefix mismatch; **`data.issues`** mirrors structured drift rows.
  - **`isolated_sql_journal_head_mismatch`** — optimistic-lock fields disagree with journal tail.

### Transactions

Apply uses a **single DB transaction**; failure → **ROLLBACK** (no partial journal rows from that attempt). A **prod checkpoint** may still exist if Gate created it before a failed apply — it is not proof migrations committed.

### Gate-enforced migration contract

Gate validates what it can actually see in the incoming bundle:

- ordered versions;
- `name`, `checksum`, and exact `sql` bytes per version;
- journal drift and optimistic-lock mismatches;
- **schema-only SQL** in migration bundles.

Top-level `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `MERGE`, and `COPY` are rejected in migration bundles.  
Use structured row APIs or `importIsolatedStoreSqlRows` for demo seeds, backfills, and large data loads.

### What Gate cannot enforce from the service boundary

Gate does **not** see the app repo or browser build pipeline, so it cannot prove:

- that a committed `postgres/migrations/manifest.json` exists in the repo;
- that the bundle was assembled from repo files rather than hardcoded in app code;
- that migration SQL was kept out of the browser bundle.

Those constraints should be enforced through repo templates, skills/prompts, code review, and CI checks around the app artifact itself.

---

## 7. MCP vs SDK / CI

- **`applyIsolatedStoreSqlMigrations`** sends **cumulative** SQL (version N includes full text for 1..N in the JSON shape) → payload grows fast.
- Many MCP hosts cap **`tool_call`** JSON (~3k characters is a common order of magnitude). Symptoms: parse errors, truncated JSON.  
  **Rule:** MCP for **small** bundles / smoke; **CI or scripts** with **`IsolatedStoresApi`** reading files from disk for real apps.

---

## 8. Repository discipline (source of truth)

- Keep migration SQL **in a dedicated directory** in the repo — use **`postgres/migrations/`** so tooling and reviewers recognize it; avoid mixing with app source or ad-hoc scripts — ordering, review, and CI checksum checks stay obvious.
- One SQL file per **`version`**; manifest with **`version`**, **`name`**, **`checksum`** aligned with the bytes Gate sends.
- **CI** should verify checksums vs files — prompts are not a substitute.
- **MUST flow:** file-first for schema changes — create/update files in `postgres/migrations/`, compute checksum from file bytes, run status, then apply.
- Bundle assembly should stay in scripts / CI / backend tooling; do not make browser runtime the source of truth for migration SQL or bundle order.
- **MUST artifact after schema ops:** include migration file path, `version`, `name`, `checksum`, `storeId`, `stage`.
- **Inline SQL in MCP:** only for one-off smoke/dev tests and explicitly marked temporary; not for persistent schema changes.
- **Final gate:** do not finish if schema changed but `postgres/migrations/` has no matching new/updated migration file/manifest entry.

---

## 9. Recovering from drift

- **Journal correct, bundle wrong:** revert bundle prefix to match production journal, then append new versions only.
- **Disposable dev:** recreate stage / empty DB, re-apply from v1.
- **Forbidden:** mutating **`fusebase_schema_migrations`**, or DDL via **`executeIsolatedStoreSql`** to “match” a bad bundle.

---

## 10. Managed PostgreSQL (e.g. Azure)

- **`CREATE EXTENSION pgcrypto`** is often blocked — first **`apply`** fails if migration creates it. Remove it; prefer **`DEFAULT gen_random_uuid()`** on PostgreSQL **13+** when the server exposes **`gen_random_uuid()`** without that extension; else allow-listed **`uuid-ossp`** or app-generated UUIDs.

---

## 11. MCP mechanics (once)

- **`tools_search`** requires **`queries`**: string **array** (not a single `query` field).
- Before first use of heavy ops: **`tools_describe`** on `initIsolatedStoreStage`, `getIsolatedStoreSqlMigrationStatus`, `applyIsolatedStoreSqlMigrations`.

---

## 12. Related sources

| What                       | Where                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| MCP prompts (LLM)          | `src/mcp/prompts/isolated.ts`, `isolated-sql.ts`, `isolated-sql-migration-discipline.ts` |
| Regenerated skill copies   | `npm run mcp:skills:generate` → `generated/claude_skills/fusebase-gate/references/`      |
| Isolated SQL + NoSQL index | `docs/isolated-sql-stores.md` (this file), `AGENTS.md`                                   |

For **NoSQL** stores (`nosql` / `mongodb_atlas`), use MCP prompt **`isolatedNoSql`** — different tool set (collections/documents, `mongodump`/`mongorestore`).
---

## Version

- **Version**: 1.1.2
- **Category**: specialized
- **Last synced**: 2026-04-13
