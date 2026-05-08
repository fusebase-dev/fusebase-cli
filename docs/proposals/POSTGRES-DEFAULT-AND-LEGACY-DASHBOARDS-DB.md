# PostgreSQL Default Path And Legacy Dashboards DB Plan

## Context

Source task: **Изменить логику работы создания баз в CLI** (`NIM-40775`).

Target direction:

- FuseBase PostgreSQL databases (current Gate isolated postgres stores) become the default database path in CLI.
- Old dashboard-backed database creation remains available, but only behind an explicit legacy flag such as `legacy-dashboards-db`.
- Dashboard-service keeps its own permissions and MCP behavior for working with existing dashboards/databases.
- Skills and prompts copied into app projects must no longer advertise legacy dashboard-database creation by default.
- NoSQL is out of scope for this iteration and should not be exposed in default skills/guidance.

## Short verdict

This change is **not** a permissions-only change.

Two different surfaces are involved:

1. **Runtime / MCP token permissions**
   These decide whether a tool call succeeds.
2. **Prompt / skill distribution**
   These decide what the agent sees and is encouraged to do.

If we only remove permissions:

- dashboard database creation guidance will still be copied into `apps-cli` project templates;
- `prompts_list` / `prompts_search` in `dashboard-service` will still expose prompt bodies by default;
- native MCP prompt registration in `dashboard-service` will still expose those prompts by default;
- agents will still be steered toward legacy dashboard DB creation even if the eventual call fails.

So the rollout needs changes in:

- `apps-cli` flags, token policy, template gating, docs;
- `dashboard-service` prompt/skill generation and copy-to-CLI filtering;
- `dashboard-service` runtime prompt filtering by auth context;
- `fusebase-gate` skill/prompt naming and default exposure wording.

## Current state

### `apps-cli`

Current flag:

- `isolated-stores`

Current behavior behind this flag:

- extra Gate MCP permissions for `isolated_store.*`
- extra Gate references copied into project template
- extra instructions in `project-template/CLAUDE.md`
- extra instructions in `project-template/AGENTS.md`
- docs and flag text still frame it as `SQL/NoSQL`

Relevant files:

- `/Users/di/Fusebase/apps-cli/lib/config.ts`
- `/Users/di/Fusebase/apps-cli/lib/mcp-token-policy.ts`
- `/Users/di/Fusebase/apps-cli/lib/copy-template.ts`
- `/Users/di/Fusebase/apps-cli/project-template/CLAUDE.md`
- `/Users/di/Fusebase/apps-cli/project-template/AGENTS.md`
- `/Users/di/Fusebase/apps-cli/README.md`
- `/Users/di/Fusebase/apps-cli/AGENTS.md`
- `/Users/di/Fusebase/apps-cli/docs/guides/env-mcp-refresh.md`

### `dashboard-service`

Current behavior:

- generated `fusebase-dashboards` skill is copied into `apps-cli` wholesale;
- the entrypoint explicitly teaches database/dashboard creation;
- `prompts_search` exposes all prompt bodies unless the caller filters by groups;
- prompt visibility is not permission-filtered;
- native MCP prompts are also registered wholesale.

Relevant files:

- `/Users/di/Fusebase/dashboard-service/scripts/generate-mcp-skills.ts`
- `/Users/di/Fusebase/dashboard-service/scripts/copy-skills-to-apps-cli.ts`
- `/Users/di/Fusebase/dashboard-service/scripts/skills-entrypoint/fusebase-dashboards-mcp.md`
- `/Users/di/Fusebase/dashboard-service/src/api/mcp/registry/promptRegistry.ts`
- `/Users/di/Fusebase/dashboard-service/src/api/mcp/prompts/index.ts`
- `/Users/di/Fusebase/dashboard-service/src/api/mcp/prompts/types.ts`
- `/Users/di/Fusebase/dashboard-service/src/api/mcp/registration/adapters/toolPrompts.ts`
- `/Users/di/Fusebase/dashboard-service/src/api/mcp/registration/adapters/nativePrompts.ts`
- `/Users/di/Fusebase/dashboard-service/src/api/mcp/server.ts`
- `/Users/di/Fusebase/dashboard-service/src/api/contracts/modules/mcp/types.ts`

### `fusebase-gate`

Current behavior:

- Gate MCP prompts and generated references still use `Isolated Store` wording;
- generated Gate skill is copied into `apps-cli`, then filtered at file level by `isolated-stores` flag;
- isolated SQL is already the canonical schema path.

Relevant files:

- `/Users/di/Fusebase/fusebase-gate/src/mcp/prompts/isolated.ts`
- `/Users/di/Fusebase/fusebase-gate/src/mcp/prompts/isolated-sql.ts`
- `/Users/di/Fusebase/fusebase-gate/scripts/generate-mcp-skills.mts`
- `/Users/di/Fusebase/fusebase-gate/scripts/copy-skills-to-apps-cli.mts`
- `/Users/di/Fusebase/fusebase-gate/generated/claude_skills/fusebase-gate/...`

## Recommended product behavior

## New constraint from current architecture

For `dashboard-service`, these are two separate problems:

1. **Static CLI skill distribution**
   Files copied into `apps-cli` are static. Token permissions cannot hide text already copied into `SKILL.md` and `references/*.md`.
2. **Runtime MCP prompt visibility**
   Current MCP prompt registry is initialized once from `getMcpPrompts(...)` and does not receive auth context. Both:
   - `registerPromptTools(...)`
   - `registerNativePrompts(...)`
   expose the whole prompt set.

So:

- removing permissions is **not enough** to hide legacy dashboard DB guidance from CLI;
- removing permissions is **also not enough** to hide MCP prompts at runtime;
- runtime prompt hiding requires an explicit code change in `dashboard-service`.

### Default path

Default app database path in CLI:

- **FuseBase PostgreSQL Database**
- implemented via Gate isolated SQL stores
- no opt-in feature flag required

### Legacy path

Optional old path:

- **FuseBase Project Dashboards**
- specifically legacy database/dashboard creation inside `dashboard-service`
- only exposed when app/project explicitly enables a new flag such as:
  - `legacy-dashboards-db`

### Naming

#### Gate / PostgreSQL

User-facing skill/prompt title:

- **FuseBase PostgreSQL Database**

Internal continuity to preserve:

- keep code ids, API tags, SDK names, and platform internals on `isolated-store` / `isolated-stores`
- explain the mapping once in prompt text:
  - “FuseBase PostgreSQL Database is implemented on top of Gate isolated stores.”

#### Dashboards

User-facing skill/prompt title:

- **FuseBase Project Dashboards**

Short secondary term:

- `(Project Dashboards)`

Internal continuity to preserve:

- existing API names like `databases`, `dashboards`, `views` do not need immediate rename
- this should be framed as UX naming, not a protocol rename

## What must change

## 1. `apps-cli`

### 1.1 Remove `isolated-stores` as required user flag

Change:

- Gate isolated postgres permissions become part of default Gate MCP policy.

Files:

- `/Users/di/Fusebase/apps-cli/lib/config.ts`
- `/Users/di/Fusebase/apps-cli/lib/mcp-token-policy.ts`

Specific updates:

- remove `isolated-stores` from `KNOWN_FLAGS`
- remove its description from `KNOWN_FLAG_DESCRIPTIONS`
- stop branching Gate policy on `hasFlag("isolated-stores")`
- make `GATE_PERMISSIONS_ISOLATED` part of default Gate permissions
- recompute MCP policy fingerprints accordingly
- update legacy fallback fingerprint logic so old projects trigger token refresh

### 1.2 Add new legacy flag

New flag:

- `legacy-dashboards-db`

Purpose:

- controls whether old dashboard database creation guidance and related skills are copied into the app template

Files:

- `/Users/di/Fusebase/apps-cli/lib/config.ts`
- `/Users/di/Fusebase/apps-cli/README.md`
- `/Users/di/Fusebase/apps-cli/AGENTS.md`

### 1.3 Flip template gating

Today:

- Gate isolated SQL references are gated by `isolated-stores`

Target:

- Gate PostgreSQL references should be copied by default
- legacy dashboard-database creation guidance should be gated by `legacy-dashboards-db`

Files:

- `/Users/di/Fusebase/apps-cli/lib/copy-template.ts`
- `/Users/di/Fusebase/apps-cli/project-template/CLAUDE.md`
- `/Users/di/Fusebase/apps-cli/project-template/AGENTS.md`

Specific updates:

- remove flag gating from:
  - `.claude/skills/fusebase-gate/references/isolated.md`
  - `.claude/skills/fusebase-gate/references/isolated-sql.md`
  - `.claude/skills/fusebase-gate/references/isolated-sql-stores.md`
  - `.claude/skills/fusebase-gate/references/isolated-sql-migration-discipline.md`
- remove default copy of:
  - `.claude/skills/fusebase-gate/references/isolated-nosql.md`
- remove EJS `isolated-stores` conditionals around PostgreSQL migration discipline text
- add new EJS conditionals only around legacy dashboards DB creation guidance

### 1.4 Refresh CLI docs and update flow

Files:

- `/Users/di/Fusebase/apps-cli/README.md`
- `/Users/di/Fusebase/apps-cli/AGENTS.md`
- `/Users/di/Fusebase/apps-cli/docs/guides/env-mcp-refresh.md`
- `/Users/di/Fusebase/apps-cli/project-template/.claude/skills/fusebase-cli/SKILL.md`

Must document:

- PostgreSQL DB is now default
- legacy dashboards DB path requires explicit flag
- `fusebase env create` will refresh Gate MCP token permissions because policy fingerprint changes

## 2. `dashboard-service`

### 2.1 Do not copy legacy database-creation skill content to CLI by default

This is the most important non-permission change.

Current problem:

- `/Users/di/Fusebase/dashboard-service/scripts/copy-skills-to-apps-cli.ts` copies the entire generated `fusebase-dashboards` skill folder into apps-cli unconditionally

That means legacy database creation guidance reaches every new app, regardless of token permissions.

Recommended options:

#### Option A — preferred

Split the dashboard skill into:

- default skill:
  - **FuseBase Project Dashboards**
  - focused on working with existing dashboards, rows, views, schema, data
- legacy add-on references:
  - database creation / cloning / get-or-create / managed-database flows

Then copy to apps-cli:

- default skill always
- database-management references only when an explicit optional skill is requested at copy time (for example `--optionalSkills dbManagement`)

Recommended implementation detail:

- add lightweight prompt/skill metadata such as:
  - `audiences?: ("default" | "dbManagement" | "dashboardManagement")[]`
- classify `managedDatabases` prompts under `dbManagement`
- let skill generation/copy filter on that metadata instead of hardcoding filenames in multiple places

Files to change:

- `/Users/di/Fusebase/dashboard-service/scripts/generate-mcp-skills.ts`
- `/Users/di/Fusebase/dashboard-service/scripts/copy-skills-to-apps-cli.ts`
- `/Users/di/Fusebase/dashboard-service/scripts/skills-entrypoint/fusebase-dashboards-mcp.md`
- `/Users/di/Fusebase/dashboard-service/src/api/mcp/prompts/types.ts`

#### Option B — acceptable but weaker

Keep one skill folder, but strip legacy references at copy time.

This is operationally cheaper, but less clean:

- source-of-truth skill still mixes old and new behavior
- generated MCP prompts still advertise legacy DB creation

### 2.2 Reduce default prompt steering toward legacy database creation

Current problem:

- `prompts_search` returns all prompts or any group the caller asks for
- there is no permission filtering in `/Users/di/Fusebase/dashboard-service/src/api/mcp/registration/adapters/toolPrompts.ts`
- entrypoint text currently normalizes creation/update of databases/dashboards as standard dashboard work

Recommended change:

- reframe default dashboard MCP entrypoint around:
  - existing dashboards
  - project dashboards
  - schema/data work inside an existing dashboard project
- move legacy database creation flows into a dedicated prompt group or clearly marked legacy section

Files to change:

- `/Users/di/Fusebase/dashboard-service/scripts/skills-entrypoint/fusebase-dashboards-mcp.md`
- `/Users/di/Fusebase/dashboard-service/src/api/contracts/modules/mcp/types.ts`
- relevant domain prompt files under:
  - `/Users/di/Fusebase/dashboard-service/src/api/mcp/prompts/domain/`

Use:

- exclude this group from generated default apps-cli skill
- keep it available only for explicit optional skill workflows such as `dbManagement`

Important nuance:

- today the natural legacy boundary already exists as `managedDatabases`
- that group contains:
  - `domain.meetings`
  - `domain.companies`
  - `domain.deals`
- but legacy guidance also leaks through shared prompts and the entrypoint, so prompt cleanup must cover:
  - `/Users/di/Fusebase/dashboard-service/src/api/mcp/prompts/domain/overview.ts`
  - `/Users/di/Fusebase/dashboard-service/src/api/mcp/prompts/domain/dashboardSchema.ts`
  - `/Users/di/Fusebase/dashboard-service/src/api/mcp/prompts/domain/templates.ts`
  - `/Users/di/Fusebase/dashboard-service/scripts/skills-entrypoint/fusebase-dashboards-mcp.md`

### 2.3 Filter MCP prompt visibility by token

Current architecture does **not** do this automatically:

- `PromptRegistry.initialize()` loads all prompts without auth context
- `registerPromptTools(...)` exposes `registry.getAll()`
- `registerNativePrompts(...)` registers every prompt in `registry.getAll()`

So if the requirement is:

- “db-management prompts should not be visible through MCP when the token lacks the right permissions”

then `dashboard-service` must be changed to build a filtered prompt set from auth context.

Recommended design:

- extend prompt definitions with audience metadata
- pass auth context into prompt selection
- filter both:
  - `prompts_list`
  - `prompts_search`
  - native prompt registration
- only include db-management prompts if the resolved token is authorized for that path

Files to change:

- `/Users/di/Fusebase/dashboard-service/src/api/mcp/server.ts`
- `/Users/di/Fusebase/dashboard-service/src/api/mcp/registry/promptRegistry.ts`
- `/Users/di/Fusebase/dashboard-service/src/api/mcp/prompts/index.ts`
- `/Users/di/Fusebase/dashboard-service/src/api/mcp/prompts/types.ts`
- `/Users/di/Fusebase/dashboard-service/src/api/mcp/registration/adapters/toolPrompts.ts`
- `/Users/di/Fusebase/dashboard-service/src/api/mcp/registration/adapters/nativePrompts.ts`

### 2.4 Rename dashboard skill title

Target title:

- **FuseBase Project Dashboards**

Keep skill folder name stable for now if needed:

- `fusebase-dashboards`

This avoids breaking template paths immediately while changing visible wording.

Files:

- `/Users/di/Fusebase/dashboard-service/scripts/skills-entrypoint/fusebase-dashboards-mcp.md`
- generated output via `npm run mcp:skills:generate`

## 3. `fusebase-gate`

### 3.1 Rename skill/prompt wording for isolated postgres

Target wording:

- **FuseBase PostgreSQL Database**

Do not rename:

- opIds
- routes
- SDK class names
- internal `isolated-stores` domain ids

Instead:

- rename prompt titles and intro copy
- add explicit mapping note:
  - “FuseBase PostgreSQL Database uses the Gate isolated-stores contract.”

Files:

- `/Users/di/Fusebase/fusebase-gate/src/mcp/prompts/isolated.ts`
- `/Users/di/Fusebase/fusebase-gate/src/mcp/prompts/isolated-sql.ts`
- skill entrypoint / generated references from `npm run mcp:skills:generate`

### 3.2 Ensure Gate skill is copied to apps-cli by default

Current problem:

- apps-cli currently removes isolated references unless `isolated-stores` flag is enabled

After this change:

- PostgreSQL references must remain in the template by default
- NoSQL references should not remain in the default app-facing path for this iteration

Main change point is in `apps-cli`, but validate generated Gate skill structure so default copy works cleanly.

## Why permissions are not enough

Short answer:

- **No, permissions alone are not enough.**

Reasons:

1. `apps-cli` copies skill markdown into the app template before runtime.
   If the markdown is there, the agent will read it even if a later tool call is denied.
2. `dashboard-service` exposes prompt text through:
   - `prompts_list`
   - `prompts_search`
   and these prompt tools are not filtered by business permissions.
3. The dashboard skill entrypoint itself currently instructs the LLM to work with database creation flows.

So the solution must combine:

- permission changes
- skill copy filtering
- prompt text restructuring
- flag-driven template exposure

## Main pitfalls

### 1. MCP policy fingerprint churn

Making PostgreSQL default changes Gate token fingerprints for all apps.

Impact:

- `.env` policy markers become stale
- `fusebase env create` / update flow must force token refresh once

Main file:

- `/Users/di/Fusebase/apps-cli/lib/mcp-token-policy.ts`

### 2. Old apps with stale generated skills

Existing repos already initialized with old skill copies will not change automatically.

Need rollout note:

- run update flow that re-copies skills/template assets

### 3. Dashboard-service prompt leakage

Even if legacy dashboard DB creation is hidden from apps-cli, it can still leak through MCP prompts if:

- `prompts_search({})`
- `prompts_search({ groups: [...] })`
- native MCP prompt registration

still exposes legacy prompt groups by default.

This requires explicit runtime filtering in `dashboard-service`; permissions alone do not hide prompt text today.

### 4. Naming drift

If we rename only headlines but leave bodies unchanged, agents will still reason in old terms.

Need consistent wording across:

- skill titles
- prompt descriptions
- entrypoint intros
- CLI docs
- template checklist text

### 5. Shared prompts still normalize DB creation

Even after removing the obvious `managedDatabases` prompts, generic dashboard prompts still contain wording like:

- “create database first”
- “getOrCreateDatabase”
- “managed database”

So cleanup must include:

- `domain.overview`
- `domain.dashboardSchema`
- `domain.templates`
- dashboards skill entrypoint

### 6. NoSQL coupling

`isolated-stores` currently also implies SQL/NoSQL in some docs.

Decision for this iteration:

- default path = PostgreSQL only
- NoSQL is not launched here
- NoSQL guidance should be removed from default copied skills and app-facing docs
- internal endpoint/tool naming remains `isolated-stores`

## Recommended implementation order

1. `apps-cli`
   - add `legacy-dashboards-db`
   - make Gate isolated postgres permissions default
   - remove `isolated-stores` gating from PostgreSQL references
   - remove NoSQL references from default copied Gate skill files
2. `dashboard-service`
   - split or filter legacy DB creation content out of default copied skill
   - rename skill title to FuseBase Project Dashboards
   - add auth-aware filtering for MCP prompt visibility
3. `fusebase-gate`
   - rename user-facing skill/prompt wording to FuseBase PostgreSQL Database
   - stop presenting `isolated` as `SQL/NoSQL` in skill copy and docs
4. regenerate and copy skills
   - `dashboard-service`: `npm run mcp:skills:generate`
   - `dashboard-service`: `npm run mcp:skills:copy-to-apps-cli:local`
   - `fusebase-gate`: `npm run mcp:skills:generate`
   - `fusebase-gate`: `npm run mcp:skills:copy-to-apps-cli:local`
5. verify new app init output in `apps-cli`

## Acceptance checklist

- new app created from `apps-cli` sees PostgreSQL DB guidance by default
- new app does not see legacy dashboard DB creation guidance by default
- legacy dashboard DB guidance appears only with `legacy-dashboards-db`
- Gate MCP token includes isolated postgres permissions without extra flag
- dashboard-service MCP still works for existing dashboard operations
- legacy dashboard DB prompts are not visible in MCP when token is not authorized for that path
- prompt/skill titles read:
  - `FuseBase PostgreSQL Database`
  - `FuseBase Project Dashboards`
- internal API naming remains unchanged:
  - `isolated-stores`
  - `IsolatedStoresApi`
  - dashboard-service `databases` / `dashboards`

## Open questions before implementation

1. Should legacy dashboard DB creation still be visible in direct dashboard-service MCP prompt discovery, or only hidden from apps-cli-generated skills?
2. Do we want to keep the skill folder names:
   - `fusebase-gate`
   - `fusebase-dashboards`
   stable for now, and only change visible titles?
