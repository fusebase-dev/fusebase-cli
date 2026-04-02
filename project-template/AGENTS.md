# AGENTS.md - Single Source of Truth for LLMs

This file is the **definitive guide** for AI agents and LLMs working with Fusebase Apps features.

**Invariant — MCP unavailable:** If MCP is not connected (tools not visible or `tools_list()` fails), **STOP**. Do not invent workarounds, scripts, or fake calls. Inform the user and follow troubleshooting; do not continue with dashboard/backend work until MCP is available.

## Golden Rule

**During development (LLM work): use MCP ONLY.**
- ✅ read/write data
- ✅ create/update databases/dashboards/views/columns
- ✅ upload files if exposed as MCP tool
- ✅ discover schemas, IDs, permissions
- ❌ **NEVER create scripts, helper files, or workarounds to access MCP functionality**
- ❌ **NEVER write Node.js scripts, bash scripts, or any code to "bridge" or "call" MCP tools**
- ❌ **If MCP tools are not available, STOP and follow MCP troubleshooting steps - do NOT create workarounds**

**Inside the app (runtime code — UI and optional feature `backend/`): use SDK ONLY.**
- ✅ UI and feature backend read/write via SDK methods with the feature token — for `DashboardDataApi`, use **`path: { dashboardId, viewId }`** ([details](#dashboard-data-sdk-path-parameters-spa-and-backend))
- ✅ SDK initialized with feature token
- ❌ runtime code must not call MCP

## Skills Location

All skills are located in `.claude/skills/`. When this document references a skill (e.g., `fusebase-cli`), look for `SKILL.md` in that folder.

**"Skill in context"** means `SKILL.md` **and** its `references/*.md` files. Reading only `SKILL.md` is **not sufficient** — you **must** also read the relevant references. For dashboard work: `references/core-concepts.md` for the entity model; **`references/data-patterns.md` is mandatory** whenever you write runtime code that reads or writes dashboard data via the SDK — it documents the real shapes for data operations (not only `sdk_describe`). Skipping references leads to broken entities or silently empty UI (e.g. wrong `data` vs `data.rows` parsing).

**Two MCP-oriented skills (different products):**

- **`fusebase-dashboards`** (folder `.claude/skills/fusebase-dashboards/`) — dashboards, databases, views, dashboard data, and the dashboard-service SDK path during development. See [Required Skills](#required-skills).
- **`fusebase-gate`** (folder `.claude/skills/fusebase-gate/`) — **Fusebase Gate** and the wider platform surface: how to use the Gate MCP and SDK for org-scoped flows, user lists and membership, tokens and authz, health/bootstrap, and other platform capabilities (e.g. email campaigns, automation, integrations) **as exposed through Gate**. Load it **before** Gate MCP work or when integrating features with orgs, users, and platform services beyond raw dashboard data.

## Two Concepts (SDK, MCP)

| Concept | Where used | Purpose |
|--------|------------|---------|
| **SDK** | Runtime code **inside the generated app** (browser/UI and optional feature **`backend/`**) | Feature reads/writes data via SDK; LLM does **not** use SDK. |
| **MCP** | **In the LLM** during development | LLM uses MCP tools to discover, create, update backend. Configure MCP in your IDE (project-level or globally per IDE instructions in `mcp/`). |

**Summary**: SDK = runtime, in app, not in LLM. MCP = in LLM, during development. Configure MCP in the IDE; for IDEs without project-level MCP, use the setup instructions in `mcp/`.

### Public npm SDK packages (required)

Runtime code must depend on the **published** `@fusebase/` packages from the public npm registry (see root `package.json`):

- **`@fusebase/dashboard-service-sdk`** — dashboards, databases, views, dashboard data.
- **`@fusebase/fusebase-gate-sdk`** — Fusebase Gate (orgs, users, tokens, platform APIs exposed via Gate).

Install with your package manager as needed, e.g. `npm install @fusebase/dashboard-service-sdk @fusebase/fusebase-gate-sdk`.

### Dashboard data SDK: path parameters (SPA and backend)

The OpenAPI-generated **`@fusebase/dashboard-service-sdk`** wraps HTTP path segments in a **`path` object** for many operations (notably **`DashboardDataApi`**: `getDashboardViewData`, `batchPutDashboardData`, etc.).

- **Correct (SDK):** `{ path: { dashboardId, viewId }, ... }` — plus `body`, `page`, `limit`, or other fields exactly as **`sdk_describe`** shows for that method.
- **Wrong (SDK):** top-level `{ dashboardId, viewId, ... }` — that shape matches **MCP** `tool_call` **args**, not the TypeScript SDK. Copy-pasting from MCP examples into SDK calls without nesting **`path`** breaks requests (often only noticed after deploy in **`backend/`** if the SPA used hooks that already wrapped `path` correctly).

Use the **same** SDK argument shape in **React code and in `backend/`** (Hono routes, `public.ts`, shared clients). Do not assume “backend can flatten” the object.

**Canonical detail and examples:** `.claude/skills/fusebase-dashboards/references/data-patterns.md` (Common Patterns, envelopes) and **`references/sdk.md`** (initialization and `getDashboardViewData` example with `path`).

## MCP Connection Check (REQUIRED - MUST BE FIRST STEP)

**CRITICAL**: MCP connection verification is **MANDATORY** before ANY work begins. This is not optional.

**Before starting ANY task:** verify that MCP tools (e.g. `tools_list`, `tools_search`, `tools_describe`, `tool_call`) are visible in your tool list and that `tools_list()` returns a non-empty list. If MCP is unavailable: **STOP**, inform the user, and **do NOT** create scripts or workarounds.

**Where to find:** Verification steps and troubleshooting protocol: skill **fusebase-dashboards** (dashboard MCP). For **Fusebase Gate** MCP (orgs, users, platform tokens — see skill **fusebase-gate**), verify the gate server per that skill. Config: `.env` (`DASHBOARDS_MCP_TOKEN`, `DASHBOARDS_MCP_URL`); MCP config: `.cursor/mcp.json`, `.vscode/mcp.json`, `.mcp.json`, `.codex/config.toml` (Codex); run `fusebase init` to set up; other IDEs see `mcp/`.

## Fusebase hosts

Read from the project **`.env`** when you need the host for links or docs:

- **FUSEBASE_HOST**: {FUSEBASE_HOST}
- **FUSEBASE_APP_HOST**: {FUSEBASE_APP_HOST} (apps subdomain, e.g. for feature URLs)

## Token Sources

### MCP Token (Development)

MCP token comes from `.env`:
```bash
DASHBOARDS_MCP_TOKEN=...
DASHBOARDS_MCP_URL=https://dashboards-mcp.{FUSEBASE_HOST}/mcp
```

**Used by**: LLM during development work (MCP tools). Hosts (`FUSEBASE_HOST`, `FUSEBASE_APP_HOST`) are separate project-wide vars — see [Fusebase hosts](#fusebase-hosts) above.

### appId in Feature Runtime

**appId** must be passed into the feature at runtime (e.g. via dev server postMessage or deployment context).

### SDK Token (Runtime)

SDK token usage in feature runtime:

**Browser/UI runtime**:
- Uses feature token from cookie `fbsfeaturetoken`
- `.env` is NOT accessible in browser
- LLM must never assume `.env` tokens in UI code
- Direct SDK / Fusebase proxy calls pass the token via `x-app-feature-token`
- Calls to the app's own backend (`/api/*`) must assume deployed platform proxies may strip `x-app-feature-token`; backend handlers must read header or fallback to cookie `fbsfeaturetoken`
- For user-facing Gate flows, auth must stay in user context (feature token). Do not silently fall back to service-account tokens.

**Rules**:
- LLM must NOT use SDK token during development
- Browser runtime authenticates direct SDK / Fusebase proxy calls using `x-app-feature-token`
- App backend auth must be implemented as `header || cookie('fbsfeaturetoken')`
- User-facing Gate endpoints must fail closed on missing/invalid feature token (`401/403`) instead of using a service-token fallback path

## LLM Checklist

**Before starting ANY work, verify (in this exact order):**

- [ ] **MCP tools are visible in my available tools list** - **MANDATORY FIRST CHECK**
- [ ] **MCP connection verified** (`tools_list()` or equivalent returns tools) - **REQUIRED BEFORE PROCEEDING**
- [ ] **Loaded `fusebase-dashboards` skill** — read skill `fusebase-dashboards` **before any dashboard operations.** Do NOT skip; the skill contains prompts_search groups, validation rules, and intent schemas. **When this skill is in context, you do not need to call prompts_search for domain knowledge — the skill content is sufficient.**
- [ ] **Loaded `fusebase-gate` skill when relevant** — if the task involves **Fusebase Gate** (organization users, membership, platform tokens, Gate health/bootstrap, or other Gate/platform APIs), read skill `fusebase-gate` **before** discovery or `tool_call` on the gate MCP. It explains how to work with the broader Fusebase ecosystem (orgs, user lists, email and automation flows, and related platform capabilities **as exposed via Gate**).
- [ ] **MCP dashboards: describe before use** — before using an MCP tool or adding SDK code for an operation, call `tools_describe` (or `sdk_describe` for SDK) to know input/output format; do not guess schemas.
- [ ] **Dashboard SDK data code** — read `fusebase-dashboards/references/data-patterns.md` **and** call `sdk_describe` for the method (e.g. `schemaMode: "output"`) before parsing responses; do not assume nested fields like `data.rows` without checking.
- [ ] **Dashboard data SDK `path` params** — for `getDashboardViewData` / `batchPutDashboardData` / similar, use `{ path: { dashboardId, viewId } }` in **both** SPA and **`backend/`**; do not pass flat `{ dashboardId, viewId }` copied from MCP `tool_call` args ([Dashboard data SDK: path parameters](#dashboard-data-sdk-path-parameters-spa-and-backend)).
- [ ] If MCP unavailable: **STOPPED and informed user** (did NOT create scripts/workarounds); use **fusebase-dashboards** skill for troubleshooting
- [ ] `.env` has `DASHBOARDS_MCP_TOKEN` and `DASHBOARDS_MCP_URL`
- [ ] I will use MCP for ALL backend operations during development
- [ ] I will NOT create any scripts, helper files, or workarounds for MCP access
- [ ] I will insert SDK code into feature files
- [ ] Runtime code will use SDK / direct Fusebase API calls with feature token via `x-app-feature-token`
- [ ] App backend handlers will read feature token from `x-app-feature-token` or cookie `fbsfeaturetoken`
<% if (it.scaffold) { %>
- [ ] **Scaffolded feature** (if creating a new feature): Ran `fusebase scaffold --template spa` before writing feature files
<% } %>

## Mental Model: MCP + SDK Architecture

### MCP (Model Context Protocol) = Development Tool for LLMs

**Purpose**: All backend operations during development and planning.

**When to use**: During LLM development work (planning, building, testing backend structure).

**Token**: `DASHBOARDS_MCP_TOKEN` from `.env`

**What MCP provides:** tools for discovery and execution (e.g. `tools_list`, `tools_search`, `tools_describe`, `tool_call`), bootstrap/context, prompts loading, and domain operations. **MCP is used for ALL backend operations during LLM development work.** For the exact flow (bootstrap → domain knowledge → discovery → tool_call) and schemas, see the **fusebase-dashboards** skill. **When that skill is in context, prompts_search for domain knowledge is optional — the skill content is sufficient.**

### SDK = Runtime Execution (browser and optional feature backend)

**Purpose**: Actual data operations in feature runtime code (browser/UI and, when present, the feature’s **`backend/`** server).

**When to use**: In your feature implementation code (React components, hooks, and Hono/API handlers that call `@fusebase/*` with the feature token).

**Token**: Feature token from cookie `fbsfeaturetoken`; direct SDK / Fusebase API calls pass it via `x-app-feature-token`, but app backend handlers must support `header || cookie`

**SDK Structure**:
- `createClient()` - Single entrypoint
- Dashboard API classes: `DashboardsApi`, `DatabasesApi`, `DashboardDataApi`, `CustomDashboardRowsApi`, `TemplatesApi`, `TokensApi`
- Dashboard Base URL: `https://app-api.{FUSEBASE_HOST}/v4/api/proxy/dashboard-service/v1` (dev) or production URL
- Gate API classes: `HealthApi`, `TokensApi`, `SystemApi`, `OrgUsersApi`
- Gate Base URL: `https://app-api.{FUSEBASE_HOST}/v4/api/proxy/gate-service/v1` (dev) or production URL

**SDK is ONLY used in app runtime code, never during LLM development.**

### 1 MCP Tool ↔ 1 SDK Method

Every MCP tool has a corresponding SDK method:
- Same `operationId`
- Same request/response schemas
- MCP for LLM discovery/execution during development → SDK for runtime execution in feature code

**Discovery**: LLM uses MCP tools (`tools_search`, `tools_describe`) to find operations, then uses SDK discovery (`sdk_search`, `sdk_describe`) to find corresponding SDK methods for feature code. See the `fusebase-dashboards` skill for MCP flow and SDK discovery.

### Describe before use (MCP dashboards)

When working with MCP dashboards, **always** run a **describe** operation before using a tool or before adding SDK code for that operation — so you know the exact **input and output format**.

- **Before calling an MCP tool**: call **`tools_describe`** with the operation name (from `tools_list`/`tools_search`) to get `inputSchema` and, if needed, `outputSchema`. For data operations (e.g. `batchPutDashboardData`) use `schemaMode: "summary"` when appropriate. See the **fusebase-dashboards** skill (Part II — Tooling flow, operation discovery).
- **Before inserting SDK code** for a method: use **`sdk_describe`** to get the corresponding SDK method's argument and response shape; then generate feature code from that schema.
- **Before parsing SDK responses for dashboard data** (`getDashboardViewData`, `batchPutDashboardData`, etc.): read **`fusebase-dashboards/references/data-patterns.md`** — it is the canonical description of envelopes, rows, and `meta`; pair it with **`sdk_describe`** so parsing matches production behavior.

Do not guess argument or response shapes — always discover them via describe **and** the data-patterns reference for data operations. Details: skill **fusebase-dashboards** (references: `data-patterns.md`, tooling, SDK discovery).

## Canonical Workflow

### Step 0: Pre-flight Check (MANDATORY - DO NOT SKIP)

Verify MCP tools are available and `tools_list()` returns a non-empty list; confirm `.env` has `DASHBOARDS_MCP_TOKEN` and `DASHBOARDS_MCP_URL`. If MCP is unavailable: **STOP**, inform the user, do not create workarounds. See **fusebase-dashboards** skill for verification steps and troubleshooting.

### Step 0.5: Load Required Skills (MANDATORY - DO NOT SKIP)

**Load the `fusebase-dashboards` skill before any discovery or `tool_call` operations** on the **dashboard** MCP. This skill contains the exact `prompts_search` groups per task, validation rules, and intent schemas — without it you will call APIs by trial-and-error. **When this skill is in context, you do not need to call prompts_search for domain knowledge; the skill content is sufficient.**

**If the task uses Fusebase Gate** (org users, membership, Gate tokens, or other Gate/platform flows), **also load `fusebase-gate`** before gate MCP or Gate SDK work — it covers MCP vs SDK, bootstrap, authz, users operations, and how to navigate the platform ecosystem beyond dashboards.

- **How (dashboards):** Read skill `fusebase-dashboards`. For SDK method discovery when writing feature code, see `fusebase-dashboards/references/sdk.md`.
- **How (gate):** Read skill `fusebase-gate` and its `references/*.md` (e.g. `references/users.md`, `references/authz.md`, `references/sdk.md`) as needed.

### Step 1: Discovery (MCP-only)

**Important**: All domain/business operations must be executed via **`tool_call`** with `opId` and `args`. Only meta/builtin tools can be called directly.

**Workflow:** Bootstrap/connection context → have domain knowledge (if **fusebase-dashboards** skill is in context, that is sufficient; otherwise load domain prompts via `prompts_search` with a **group filter** — see that skill; never call `prompts_search({})` without groups) → discover operations via `tools_search`/`tools_list` → `tools_describe` → execute via `tool_call`.

**Critical**: Never hardcode database/dashboard/view IDs. Always discover them via MCP first. Concrete opIds and flow details are in the **fusebase-dashboards** skill.

### Step 2: Plan (MCP-only)

Before making changes, write a plan:
- Tools you will call (by name)
- Entities you will create/update
- Data shape expectations
- Rollback/mitigation notes

**Plan must avoid**: SDK usage, manual REST calls, assumptions about schema.

<% if (it.scaffold) { %>
### Step 2.5: Scaffold the Feature (if creating a new feature)

Before writing any feature files, scaffold:

1. `fusebase scaffold --template spa --dir features/<name>` (+ `--template backend` if backend needed)

Never manually create `package.json`, `vite.config.ts`, `tsconfig.json`, `postcss.config.js`, `index.html`, or `globals.css` — scaffold generates the canonical versions. Then proceed to Steps 3–4 to implement the feature. **Register and start dev after the code is written** — see Step 4.5.
<% } %>

### Step 3: Execute Changes (MCP-only)

**Creating structure** (LLM development only - NOT feature code): Use `tool_call` with the appropriate opIds to create/update dashboards, views, and schema. See **fusebase-dashboards** skill for flow and operation names. These calls do NOT go into feature code; feature code uses SDK (Step 4: Handoff to Runtime).

**Reading/writing data** (during LLM development - NOT feature code): Use `tool_call` for read/write; opIds and schema (e.g. data operations, `schemaMode`) are in the **fusebase-dashboards** skill. These calls do NOT go into feature code; feature code uses SDK (Step 4). Re-run list/describe tools to verify changes.

### Step 4: Handoff to Runtime (SDK-only)

When development is complete, provide:

**Output artifacts**:
- Discovered IDs (dashboardId/viewId/etc.)
- Column keys and types (schema snapshot)
- Mapping table: "Column Name → Column Key → Type"
- Constraints (required columns, enum/select ids)

**Runtime code** (SDK-only):

**Important**: LLM inserts SDK code into feature files but does NOT execute it. Feature code executes SDK methods at runtime.

**Discovery**: Use MCP tools to discover SDK methods (see `fusebase-dashboards` skill and its `references/sdk.md`):
1. Find MCP tool via `tools_search`/`tools_describe`
2. Find corresponding SDK method via `sdk_search`/`sdk_describe`
3. Insert SDK code into feature file using discovered schema

**Browser/UI runtime usage** (using feature token):
```typescript
import { createClient, CustomDashboardRowsApi, DatabasesApi } from "@fusebase/dashboard-service-sdk";

const BASE_URL = 'https://app-api.{FUSEBASE_HOST}/v4/api/proxy/dashboard-service/v1'

/**
 * Create SDK client with feature token for browser runtime
 */
export function createSdkClient(featureToken: string) {
  return createClient({
    baseUrl: BASE_URL,
    defaultHeaders: {
      'x-app-feature-token': featureToken,
    },
  })
}

/**
 * Create DatabasesApi instance with feature token
 */
export function createDatabasesApi(featureToken: string): DatabasesApi {
  const client = createSdkClient(featureToken)
  return new DatabasesApi(client)
}

// Usage in feature code:
// 1. Get feature token from cookie
const featureToken = getFeatureToken() // Read from 'fbsfeaturetoken' cookie

// 2. Create API instance
const databasesApi = createDatabasesApi(featureToken)

// 3. Use API
const response = await databasesApi.listDatabases({})
```

**Custom app backend usage** (`/api/*`):
```typescript
// Same-origin requests automatically include the fbsfeaturetoken cookie.
// In deployed mode, do not rely on x-app-feature-token surviving the platform proxy.
const res = await fetch('/api/items')
const data = await res.json()
```

Backend handlers must read the feature token from header first and cookie second:
```typescript
import { getCookie } from 'hono/cookie'

const featureToken =
  c.req.header('x-app-feature-token') || getCookie(c, 'fbsfeaturetoken')

if (!featureToken) {
  return c.json({ error: 'Missing feature token' }, 401)
}
```

**Browser/UI runtime usage for Fusebase Gate** (using feature token):
```typescript
import { createClient, OrgUsersApi, TokensApi } from "@fusebase/fusebase-gate-sdk";

const GATE_BASE_URL = 'https://app-api.{FUSEBASE_HOST}/v4/api/proxy/gate-service/v1'

/**
 * Create Gate SDK client with feature token for browser runtime
 */
export function createGateSdkClient(featureToken: string) {
  return createClient({
    baseUrl: GATE_BASE_URL,
    defaultHeaders: {
      'x-app-feature-token': featureToken,
    },
  })
}

/**
 * Create OrgUsersApi instance with feature token
 */
export function createOrgUsersApi(featureToken: string): OrgUsersApi {
  const client = createGateSdkClient(featureToken)
  return new OrgUsersApi(client)
}

/**
 * Create TokensApi instance with feature token
 */
export function createGateTokensApi(featureToken: string): TokensApi {
  const client = createGateSdkClient(featureToken)
  return new TokensApi(client)
}
```

<% if (it.scaffold) { %>
### Step 4.5: Register the Feature and Start Dev (for new feature after code is complete)

Once feature code is written and ready to run, **execute these automatically — do NOT list them as "next steps" for the user**:

1. **Register**: `fusebase feature create --name="<Feature Name>" --subdomain=<feature-sub> --path=features/<name> --dev-command="npm run dev" --build-command="npm run build" --output-dir=dist`
2. **Start dev**: `fusebase dev start features/<name>`

The feature must be registered before it can run. Never leave these for the user to execute manually.

**When updating an existing feature**: run `fusebase feature update <featureId>` if needed. See skill **fusebase-cli** for the full update reference.
<% } %>

## Explicitly Forbidden

### ❌ Manual HTTP Requests

**DO NOT** make manual HTTP requests to Fusebase APIs:
- Don't guess endpoints
- Don't construct URLs manually
- Use MCP tools during development, SDK methods in runtime

### ❌ Calling MCP from Runtime

**DO NOT** call MCP tools from feature runtime code:
- MCP is for LLM development only
- Use SDK methods in runtime
- MCP tools are not available in browser/runtime environment

### ❌ Creating Scripts or Workarounds for MCP Access

**ABSOLUTELY FORBIDDEN**: Creating any scripts, helper files, or workarounds to access MCP functionality.

**DO NOT**:
- Create Node.js scripts to call MCP tools
- Create bash / shell scripts to call MCP tools (including via `curl`)
- Generate `curl` commands to hit MCP HTTP endpoints directly
- Write helper functions that "wrap" MCP calls
- Create temporary files to "work around" missing MCP
- Use `scripts/mcp-stdio-bridge.cjs` directly (it's for IDE integration only)
- Attempt to manually call MCP HTTP endpoints
- Create any code that tries to "emulate" or "proxy" MCP tools

**How MCP MUST be called**:
- Only through the LLM's built‑in MCP tool mechanism (`tool_call` with `opId` + `args`)
- Never via raw HTTP, `curl`, custom shell scripts, or custom bridges

**If MCP tools are not available:**
- **STOP** and inform the user
- **DO NOT** create workarounds
- Follow the troubleshooting protocol (check config, suggest restart, verify .env)
- Wait for MCP to be properly configured before proceeding

**MCP tools must be directly available in your tool list. If they're not, the setup is incorrect - fix the setup, don't work around it.**

### ❌ Hardcoding IDs

**DO NOT** hardcode database/dashboard/view IDs:
- Always discover IDs via MCP first
- IDs may change between environments
- Use MCP discovery tools to find IDs dynamically

## Required Skills

Dashboard skills are **not optional**. You **MUST** read the skill file **before** the corresponding work. Treat "required skill" as an **action**: load it first, then proceed.

### ✅ fusebase-dashboards

**MUST be loaded** — read skill `fusebase-dashboards` **before any dashboard operations.** Do NOT skip this step; it contains the exact `prompts_search` groups for each operation type, validation rules, and intent schemas. Without it you will rely on trial-and-error and risk failed `tool_call`s. **When this skill is in context, you do not need to call prompts_search for domain knowledge — the skill content is sufficient.**

Covers:
- Mandatory check: fusebase-dashboards MCP connection (suggest user check connected servers if missing)
- Bootstrap and connection context (resource or bootstrap + whoami, defaults)
- Tooling flow: have domain knowledge (skill in context or load prompts) → tools_search/tools_list → tools_describe → tool_call
- Schemas ($ref/$defs), error handling, MCP vs SDK
- MCP is for LLM development and dashboard access; SDK only for runtime code

### ✅ fusebase-gate

**Load when working with Fusebase Gate or platform-level flows** — organizations, org user lists and membership, Gate tokens and authorization scopes, health/bootstrap, and how to use the **Gate MCP** and **Gate SDK** during development vs runtime.

The skill explains how to interact with the **broader Fusebase ecosystem** beyond dashboard data: for example org-scoped user operations, platform services, email and campaign-related flows, automation, and integrations **as exposed through Gate** (see `references/*.md` for each topic). **Verify the fusebase-gate MCP server** is available before gate `tool_call` work (see skill).

### ✅ file-upload

For file upload functionality (separate service, not part of dashboard SDK).

### ✅ handling-authentication-errors

**Required for all features**. Covers handling `AppTokenValidationError` (401) responses when the feature token expires, including the `AuthExpiredModal` component pattern.

### ✅ app-ui-design

**Load when building or refining feature UI**: pages, components, layouts, forms, theming, or accessibility. Covers visual design, UX principles, shadcn/ui patterns, layout/spacing, and avoiding generic AI aesthetics.

### ✅ feature-dev-practices

**Load when creating or working on features** — covers project structure, authentication (feature token from cookie), Vite config, dev workflow, building, registering features, cross-feature navigation, and common build issues.

### ✅ dev-debug-logs

**Load when debugging a feature started with `fusebase dev start`** — covers the local per-session logs in the selected feature directory's `logs/dev-<timestamp>/`, including `browser-logs.jsonl`, `access-logs.jsonl`, `backend-logs.jsonl`, and `frontend-dev-server-logs.jsonl`, and explains which file to inspect for browser errors, proxied API traffic, frontend dev server output, and backend output.

<% if (it.flags?.includes("git-init")) { %>
### ✅ git-workflow

**Load for everyday Git usage in generated apps** — commit hygiene, safe rollback guidance, and operation-aware commit boundaries. If `git-debug-commits` flag is enabled, this skill also applies strict debug/deploy traceability rules.
<% } %>

### ✅ feature-backend

**Load when a feature needs a backend API** (REST endpoints, WebSockets, custom logic). Covers when to add a backend, `backend/` folder structure, Hono setup, `/api` route reservation, and `fusebase.json` backend config. **The backend is optional** — only add when the feature genuinely needs backend logic beyond dashboard SDK calls. **No code is shared between SPA and backend** — each side defines its own types independently. **Backends are not shared among features** — only the feature that owns the `backend/` folder can access it.

### ✅ feature-secrets

**Load when a feature backend reads `process.env` for API keys, passwords, or other sensitive config.** Covers creating secrets via `fusebase secret create`, accessing them at runtime, local development, and the checklist for verifying all secrets are registered. **After writing backend code that uses secrets from `process.env`**, you **must** run `fusebase secret create` to register every secret key — otherwise the backend will fail at runtime.

### Dev-level skills (TypeScript & React)

**Load when writing or reviewing TypeScript/React code** — language and framework reference skills for implementation quality. Read the skill's `SKILL.md` and, when relevant, the listed references.

- **typescript-pro** — `.claude/skills/typescript-pro/SKILL.md`
  Advanced TypeScript: strict mode, generics, conditional/mapped types, type guards, utility types, tsconfig, patterns. References: `references/advanced-types.md`, `references/type-guards.md`, `references/utility-types.md`, `references/configuration.md`, `references/patterns.md`.

- **react-expert** — `.claude/skills/react-expert/SKILL.md`
  React 18+/19: components, hooks, state management, Server Components, performance, testing. References: `references/server-components.md`, `references/react-19-features.md`, `references/state-management.md`, `references/hooks-patterns.md`, `references/performance.md`, `references/testing-react.md`, `references/migration-class-to-modern.md`.

## Development Workflow

<% if (it.scaffold) { %>
### Scaffolding a New Feature

When creating a new feature, **always scaffold first** — never manually create `package.json`, `vite.config.ts`, `tsconfig.json`, `postcss.config.js`, `index.html`, or `globals.css`.

The full workflow is:

1. **Scaffold**: `fusebase scaffold --template spa --dir features/<name>` (also run with `--template backend` if a backend is needed)
2. **Implement**: write the feature code (Steps 3–4 of the Canonical Workflow)
3. **Register** *(after code is written)*: `fusebase feature create --name="<Feature Name>" --subdomain=<feature-sub> --path=features/<name> --dev-command="npm run dev" --build-command="npm run build" --output-dir=dist`
4. **Start dev** *(after registering)*: `fusebase dev start features/<name>`

**Steps 3 and 4 must be executed automatically — do NOT list them as "next steps" for the user.**
<% } %>

### Starting Development

**ALWAYS use** the Fusebase CLI:

```bash
fusebase dev start FEATURE_PATH
```

**DO NOT** use `npm run dev` (or a similar command) directly - always use `fusebase dev start` as it sets up the proper development environment with authentication and feature token injection.

When debugging local runtime issues through the CLI, load skill **dev-debug-logs** and inspect the current session folder under the selected feature directory's `logs/dev-<timestamp>/`.

## Fusebase CLI

See `fusebase-cli` skill for complete CLI documentation.

The `fusebase` CLI is installed globally. **Always run it as `fusebase <command>` — never use `npx fusebase`.**

Key commands:
- `fusebase init` - Initialize new project (`--git` offers local Git init; global flag `git-init` enables the same behavior automatically)
- `fusebase dev start` - Start development server (creates per-session debug logs in the selected feature directory under `logs/dev-<timestamp>/`, including `browser-logs.jsonl`, `access-logs.jsonl`, `backend-logs.jsonl`, and `frontend-dev-server-logs.jsonl`)
- `fusebase feature create --name=NAME --subdomain=FEATURE_SUB --path=PATH --dev-command=CMD --build-command=CMD --output-dir=DIR [--permissions="dashboardView.DASH_ID:VIEW_ID.read,write"]` - Register feature (all six core options required; served from subdomain root). **Set `--permissions` here at creation time** if the feature needs dashboard access — do not defer to a separate `feature update` step.
- `fusebase deploy` - Deploy features (runs lint then build per feature)
- `fusebase skills update` - Update AGENTS.md and skills from template
- `fusebase env create` - Create or overwrite .env with MCP token
- `fusebase secret create --feature=FEATURE_ID --secret "KEY:description"` - Create feature secrets (empty values), prints URL to set values

Lint: run `npm run lint` from project root (or from a feature directory). The project template includes ESLint (TypeScript/JavaScript plus `@eslint/json` for `*.json`). Invalid JSON — including a raw line break inside a quoted string — is reported as a parse error. Deploy runs lint automatically before build for each feature that has a `lint` script.

Typecheck: run `npm run typecheck` from project root. It runs TypeScript (`tsc`) for each feature that has a `typecheck` script, a `tsconfig.json`, or `tsconfig.app.json` — the same class of errors as `tsc` inside `fusebase deploy`’s build (e.g. `tsc -b && vite build`), without running Vite. ESLint does not replace this.

### Publish Rule: `deploy` does not publish permissions

`fusebase deploy` uploads code and creates a new feature version. It does **not** update the feature's runtime permissions.

Feature permissions are published only through feature create/update calls:

- `fusebase feature create ... --permissions="..."`
- `fusebase feature update <featureId> --permissions="..."`
- `fusebase feature update <featureId> --sync-gate-permissions`
- `fusebase feature update <featureId> --permissions="..." --sync-gate-permissions`

For features that use Dashboard SDK or Gate SDK at runtime, a successful deploy is **not enough**. Before presenting the feature as published, make sure permissions were explicitly synced.

If the feature uses Fusebase Gate SDK:

- run `fusebase feature update <featureId> --sync-gate-permissions` before or alongside publish
- do not treat `Permissions: none` as success unless the feature intentionally requires no runtime permissions
- run `fusebase analyze gate --operations --json --feature <featureId>` before publish and confirm `usedOps` is not empty when Gate SDK is used in runtime code
- if `usedOps` is empty but runtime imports `@fusebase/fusebase-gate-sdk`, treat publish as blocked and fix analysis/runtime call patterns before shipping

Recommended publish sequence:

1. update runtime permissions with `fusebase feature update`
2. if Gate SDK is used, include `--sync-gate-permissions`
3. run `fusebase deploy`

## Common Failure Modes

### MCP fails / `tools_list()` fails / MCP tools not visible

**STOP IMMEDIATELY**. **DO NOT** create scripts or workarounds. Inform the user and follow the verification/troubleshooting protocol in the **fusebase-dashboards** skill. For config (`.env`, `.cursor/mcp.json`, `fusebase init`, `mcp/`), see that skill and the [MCP Connection Check](#mcp-connection-check-required--must-be-first-step) section above.

### "I don't know which ID / column key to use"

**STOP**. Use MCP discovery:
- `getAllDatabases` → `getDashboards` → `getDashboard` / `describeDashboard` (views in response) → `getDashboardView` for a single view

### Data saves but list/UI stays empty (silent parse bug)

Often wrong assumed response shape (e.g. `response.data.rows` vs top-level `data` and `meta`). **Fix:** read **`fusebase-dashboards/references/data-patterns.md`**, call **`sdk_describe`** for the SDK method (`schemaMode: "output"`), then align parsing with both.

### Dashboard SDK requests wrong shape (flat `dashboardId` / `viewId`)

Symptoms: 4xx from dashboard-service, empty data, or divergent behavior between SPA and **`backend/`** after deploy. **Cause:** using top-level `{ dashboardId, viewId }` in SDK calls instead of **`{ path: { dashboardId, viewId }, ... }`**. MCP `tool_call` uses a flat `args` object; the TypeScript SDK does not. **Fix:** align every `DashboardDataApi` (and similar) call with **`sdk_describe`** and [Dashboard data SDK: path parameters](#dashboard-data-sdk-path-parameters-spa-and-backend).

### Schema changed unexpectedly

- Re-run `describe_*` via MCP
- Update the mapping and plan accordingly

### Permission denied

- Confirm token scope via MCP/tool error
- Use MCP token management tools if available
- Otherwise escalate/configure

### Build fails: devDependencies missing

See skill **feature-dev-practices** for the fix (`npm install --include=dev`).

### Feature works incorrectly in local dev

Load skill **dev-debug-logs** and inspect the latest session under the selected feature directory's `logs/dev-<timestamp>/`:

- `browser-logs.jsonl` for browser console errors, uncaught errors, and unhandled rejections
- `access-logs.jsonl` for proxied `/api` request/response records and proxy errors
- `frontend-dev-server-logs.jsonl` for frontend dev server output, including Vite startup errors and proxy/dev-server messages
- `backend-logs.jsonl` for backend stdout and stderr

## Final Gate (Before Saying "Done")

You can only claim completion if:

* ✅ MCP discovery shows the expected structure exists
* ✅ MCP read/write operations succeed (for dev tasks)
* ✅ You produced a clean handoff package for runtime (IDs + schema mapping)
* ✅ No SDK was used during development work
* ✅ **Secrets registered** (if backend uses `process.env`): Every `process.env.KEY` in `backend/` code has a matching `fusebase secret create --secret "KEY:description"` call. No `backend/.env` file, no `dotenv` dependency. If unsure, run the **secrets-checker** agent.
* ✅ **Lint passes**: Before you say "Done", you **must** run `npm run lint` (from project root or from the feature directory you changed). Fix any reported errors; address warnings where practical. If you leave any errors or important warnings unfixed, list them explicitly for the user. (Deploy runs lint before build—code that fails lint will fail `fusebase deploy`.)
* ✅ **Typecheck passes**: Before you say "Done", run `npm run typecheck` from project root when the app has features with TypeScript (or rely on the same check via `fusebase deploy`’s build). Deploy’s build often runs `tsc` before Vite; type errors fail there even if lint passed. **Claude Code users**: Stop hooks in `.claude/settings.json` run lint and then typecheck when you finish; if either fails, you are blocked from stopping and given the output to fix.
* ✅ **Permissions were published, not just code**: If the feature uses Dashboard SDK or Gate SDK at runtime, verify that `feature update` was run with the necessary flags before considering publish complete.
* ✅ **Gate features require `--sync-gate-permissions`**: If runtime code uses `@fusebase/fusebase-gate-sdk`, run `fusebase feature update <featureId> --sync-gate-permissions` before calling the feature published.
* ✅ **`Permissions: none` is a blocker for runtime-integrated features**: If CLI output shows `Permissions: none`, do not present the feature as fully published unless it intentionally requires no runtime permissions.
* ✅ **Gate analysis sanity check**: Run `fusebase analyze gate --operations --json --feature <featureId>` and verify `usedOps` is non-empty for Gate-integrated runtime code. Empty `usedOps` with active Gate SDK usage is a release blocker.

## Summary

1. **MCP = LLM Development**: Use MCP tools for ALL backend operations during development (discovery, read/write/create/update)
2. **SDK = Runtime Execution**: Use SDK methods ONLY in feature runtime code (UI/browser and optional **`backend/`**). Direct SDK / Fusebase proxy calls use `x-app-feature-token`; app backend handlers must read `x-app-feature-token` or cookie `fbsfeaturetoken`. Dashboard data methods use **`path: { dashboardId, viewId }`** — not a flat object copied from MCP ([Dashboard data SDK: path parameters](#dashboard-data-sdk-path-parameters-spa-and-backend))
3. **MCP Verification is MANDATORY**: Always check MCP tools are available BEFORE starting any work. If unavailable, STOP and troubleshoot - never create workarounds.
4. **Discovery Flow**: LLM uses MCP tools (`tools_search`/`tools_describe`) to discover operations, then uses SDK discovery (`sdk_search`/`sdk_describe`) to find corresponding SDK methods for feature code
5. **Describe before use (MCP dashboards)**: Before using an MCP tool or inserting SDK code for an operation, always run `tools_describe` or `sdk_describe` to know the input/output format; never guess schemas. For dashboard **data** SDK methods, also read **`fusebase-dashboards/references/data-patterns.md`** before parsing responses.
6. **Code Insertion**: LLM inserts SDK code into feature files but does NOT execute it. Feature executes SDK at runtime.
7. **Token Separation**: `DASHBOARDS_MCP_TOKEN` for MCP (development), feature token for SDK (runtime)
8. **Never hardcode IDs**: Always discover via MCP first
9. **Never execute SDK from LLM**: LLM may insert SDK code but must NOT execute it
10. **Never call MCP from runtime**: MCP is development-only, features don't know about MCP
11. **Never create scripts for MCP**: If MCP tools aren't available, fix the setup - don't work around it
12. **Always read skills**: `fusebase-dashboards` for MCP/dashboard flow and SDK discovery; `fusebase-gate` when integrating with Gate (orgs, users, platform tokens, and related ecosystem capabilities); `feature-dev-practices` for building features, `dev-debug-logs` for local `fusebase dev start` log analysis, <% if (it.flags?.includes("git-init")) { %>`git-workflow` for Git hygiene/rollback (and strict traceability when `git-debug-commits` is enabled), <% } %>`feature-backend` for adding backend APIs (REST/WebSockets), `feature-secrets` for registering backend secrets, `file-upload` for file operations. For TypeScript/React implementation quality, load **dev-level skills**: `typescript-pro`, `react-expert`. When `fusebase-dashboards` is in context, `prompts_search` for domain knowledge is optional — the skill content is sufficient

## One-line Reminder

**LLM builds and manipulates the backend via MCP (which must be verified first), discovers SDK methods via MCP, and inserts SDK code into features. Features execute SDK at runtime. No cross-over. No scripts. No workarounds.**
