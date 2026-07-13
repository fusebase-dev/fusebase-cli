---
name: fusebase-gate
description: "How to use MCP for Fusebase Gate. Use when: working with gate contracts, tokens, org user listing, health, or generated MCP tools and prompts."
metadata:
  source: entrypoint
---


# Fusebase Gate MCP Skill

This document describes how to use **MCP (Model Context Protocol)** with **Fusebase Gate** during LLM development. Fusebase Gate is a service consumer built on top of the shared Fusebase platform runtime.

For rules and checklists, see `AGENTS.md`.

For **FuseBase PostgreSQL Database** (`sql` / `postgres` via the Gate `isolated-stores` contract), use **`references/isolated-sql.md`** for the MCP-oriented sequence and **`references/isolated-sql-migration-discipline.md`** whenever you edit or apply migration bundles (anti-drift). For runtime errors and support handoff, use **`references/isolated-sql-integrator-troubleshooting.md`**. Do **not** load operator runbooks (`isolated-sql-stores`, `isolated-sql-rls-plan`) — they are platform-internal. See TOC below.

**Critical isolated-store runtime rule:** a Gate isolated store is a platform-bound resource, not app environment configuration. Do not ask users to create app secrets or env vars for `storeId`, database IDs, physical database names, or provider connection details. Runtime code must resolve the store through Gate using the app token/source scope and stable alias (or use the store already bound by the platform). `storeId` may appear in MCP/operator handoff logs or CLI migration commands, but it must not be persisted as an app secret or hardcoded runtime config.

---

## References

Each reference is in a separate file under `references/`. Load the file when you need that topic.


**meta**

- [Authorization and Scopes](references/authz.md)
- [Bootstrap](references/bootstrap.md)
- [Fusebase Gate SDK](references/sdk.md)
- [Tooling](references/tooling.md)

**specialized**

- [Fusebase Auth For AI Apps](references/fusebase-auth.md)
- [Fusebase Gate — Isolated SQL migration discipline](references/isolated-sql-migration-discipline.md)
- [Fusebase Gate App Magic Link Operations](references/app-magic-links.md)
- [Fusebase Gate Billing And Stripe Flows](references/billing.md)
- [Fusebase Gate Email Operations](references/emails.md)
- [Fusebase Gate Files Flows](references/files.md)
- [Fusebase Gate Membership And Portal Flows](references/membership.md)
- [Fusebase Gate Notes Operations](references/notes.md)
- [Fusebase Gate Org Group Operations](references/org-groups.md)
- [Fusebase Gate Organization URLs](references/orgs.md)
- [Fusebase Gate Stripe App And Agent Integration](references/stripe-apps.md)
- [Fusebase Gate Users Operations](references/users.md)
- [FuseBase PostgreSQL Database](references/isolated.md)
- [FuseBase PostgreSQL Database](references/isolated-sql.md)
- [FuseBase PostgreSQL Database — integrator troubleshooting](references/isolated-sql-integrator-troubleshooting.md)
- [Isolated stores hierarchy: Gate vs Neon](references/isolated-store-hierarchy.md)
- [Isolated stores release checklist](references/isolated-stores-release-checklist.md)
- [Portal iframe embed context (Gate SQL RLS)](references/portal-embed-context.md)
- [Stripe for apps and agents (Gate)](references/stripe-for-apps-and-agents.md)

---


## When NOT To Use This Skill

- Do not use this skill for dashboard schema, rows, or `files` cell payload guidance. Load `fusebase-dashboards` for dashboard writes.
- Do not use this skill as the canonical low-level upload lifecycle reference. Load `file-upload/references/upload-lifecycle.md` for `tempStoredFileName -> storedFileUUID -> readUrl / relative url -> file descriptor`.
- Do not copy shared upload endpoint or payload blocks into Gate references. Gate guidance only owns Gate operations, auth, and scope.


## Anti-Overlap Checklist

- [ ] Unique scope: Gate operations and their auth/scope behavior.
- [ ] Neighbor links: use `file-upload` for upload lifecycle; use `fusebase-dashboards` for dashboard `files` columns.
- [ ] No duplicated dashboard `batchPutDashboardData` payload details here.
- [ ] Only hand off `storedFileUUID`, `readUrl`, or file descriptor outputs to neighboring skills.


## Verify gate MCP connection

Before any work with gate MCP, verify that the **fusebase-gate** MCP server is connected.

1. Check that MCP tools from the gate server are present (e.g. `tools_list`, `tools_search`, `tool_call`, `bootstrap`, `prompts_list`, `prompts_search`).
2. If the gate server is not available, inform the user and suggest checking MCP server settings.

---


## MCP vs SDK

- **MCP tools** — for performing actions inside the LLM session: discovery, token management, org user listing, health checks.
- **SDK** — for runtime code (e.g. service/browser/worker). Use `@fusebase/fusebase-gate-sdk` from npm in application code.

---


## Bootstrap and connection context

1. Read the resource **`resource://connection/context`** (if the client supports MCP Resources).
2. Or call the **`bootstrap`** tool (no arguments) and use the response for `defaults.toolArgs`, `usage`, `capabilities`.

---


## Tooling flow

After connection is established: discover operations via `tools_list` / `tools_search`, get schemas via `tools_describe`, execute via `tool_call`. For prompts, use `prompts_search` with appropriate `groups` (e.g. authz, bootstrap, tooling).

---


## Gate SDK runtime patterns for reliable permission sync

When runtime code uses `@fusebase/fusebase-gate-sdk`, `fusebase analyze gate` and `fusebase app update --sync-gate-permissions` derive the **published Gate grant** from static analysis of SDK method calls. **Use straightforward SDK shapes in production code** — do not narrow API types for convenience.

### Required patterns (production)

1. **Factory returns a full SDK API class** — not a picked/minimal interface:
   ```typescript
   import { AccessApi, createClient } from "@fusebase/fusebase-gate-sdk";

   export function createAccessApi(appToken: string): AccessApi {
     return new AccessApi(
       createClient({
         baseUrl: GATE_BASE_URL,
         defaultHeaders: { "x-app-feature-token": appToken },
       }),
     );
   }

   // Call sites: direct method on the full Api instance
   const accessApi = createAccessApi(token);
   await accessApi.getMe();
   await accessApi.getMyOrgAccess({ path: { orgId } });
   ```
2. **One factory per SDK API surface** you use (`AccessApi`, `OrgUsersApi`, `IsolatedStoresApi`, …) — same style as `AGENTS.md` § Gate browser example (`createOrgUsersApi`, `createGateTokensApi`).
3. **Direct calls on the instance:** `await api.listWorkspaces(...)`.
4. **Pre-publish gate check (release blocker):**
   - `fusebase analyze gate --operations --json --feature <featureId>`
   - if runtime imports Gate SDK and `usedOps` is empty → **stop** and fix call patterns before publish/deploy
   - if analyze warns that sync will **remove** permissions → confirm intentionally before `--sync-gate-permissions`

### Forbidden / avoid in production (breaks or hides `usedOps`)

| Pattern | Why avoid |
|--------|-----------|
| `Pick<AccessApi, "getMe">` / `Omit<...>` / hand-rolled `{ getMe(): ... }` | Hides operations from permission sync; caused prod lockouts when grants were trimmed (see `fusebase analyze gate` docs). CLI may detect some `Pick<>` shapes now — **still do not use in app code**. |
| Destructuring methods (`const { getMe } = api`) | Analyzer may miss the op |
| `api[opName](...)` with non-literal `opName` | Dynamic op — not analyzable |
| `any` / untyped Gate client | Skips reliable detection |
| Wrapper that forwards via string op id instead of SDK method | Same |

**Rule of thumb:** if a human cannot grep `api.getMe(` or `accessApi.listOrgUsers(`, the analyzer probably cannot either.

### Identity & org resolution (pair with typing rules)

- Use **`FBS_ORG_ID`** on deploy — do not derive org from `getMe().auth.scopes` (visitor tokens may have empty scopes).
- `getMe` does **not** require `health.read` in the grant (identity op). See `app-backend` skill.
- Service/backend: `x-app-feature-token` for `FBS_FEATURE_TOKEN`; do not use `getMyOrgAccess` with service tokens (`userOnly`).

Details: `references/sdk.md` § Permission sync typing rules; `app-backend` skill § Gate 403 triage.


## Token permission mode (default soft)

Token permission validation is soft by default (`strictPermissionValidation = false`).

- If a request contains permissions the caller cannot grant, Gate degrades token permissions to the allowed subset.
- If a request contains unknown or service-disallowed permissions, Gate ignores those permissions in soft mode.
- Prefer the default soft mode for runtime integrations; enable strict mode only for explicit fail-fast requirements.


## SDK operation error handling

For runtime code with `@fusebase/fusebase-gate-sdk`, enforce explicit operation-level error handling:

- Wrap each Gate operation in `try/catch` and branch behavior by status code and operation intent.
- Treat `401/403` as expected authz outcomes (missing permission, scope mismatch, membership state) and return actionable guidance.
- Avoid implicit privileged fallback when user-context calls fail.
- For token operations, message that permission reduction can be expected in soft mode; only expect hard failure when strict mode is explicitly enabled.


## Security rule: no implicit service-token fallback

For user-facing Gate flows (membership status, current user/org access, workspace visibility), do not silently switch from feature-token auth to service-token auth when Gate returns auth errors.

- Required behavior: fail closed (`401/403`) and surface a clear runtime error.
- Forbidden behavior: "best-effort" fallback that returns data from owner/service context.
- If a feature truly needs service-token operations, keep them in explicit system/admin-only endpoints with audit logging and clear auth-source labeling.
