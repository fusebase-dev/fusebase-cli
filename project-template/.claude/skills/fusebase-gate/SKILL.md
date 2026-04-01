---
name: fusebase-gate
description: "How to use MCP and SDK for Fusebase Gate and the broader Fusebase platform. Use when: 1. Working with Gate MCP tools (tokens, org user listing, health, generated prompts), 2. Org-scoped flows: organizations, membership, user lists, portal invitations, 3. Gate authorization scopes and JWT tokens, 4. Platform-level capabilities exposed via Gate: email campaigns, automation flows, integrations, 5. Runtime code uses @fusebase/fusebase-gate-sdk (Gate SDK patterns and --sync-gate-permissions workflow)."
metadata:
  source: entrypoint
---


# Fusebase Gate MCP Skill

This document describes how to use **MCP (Model Context Protocol)** with **Fusebase Gate** during LLM development. Fusebase Gate is a service consumer built on top of the shared Fusebase platform runtime.

For rules and checklists, see `AGENTS.md`.

---

## References

Each reference is in a separate file under `references/`. Load the file when you need that topic.

**meta**

- [Authorization and Scopes](references/authz.md)
- [Bootstrap](references/bootstrap.md)
- [Fusebase Gate SDK](references/sdk.md)
- [Tooling](references/tooling.md)

**specialized**

- [Fusebase Gate Membership And Portal Flows](references/membership.md)
- [Fusebase Gate Users Operations](references/users.md)

---


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

When runtime code uses `@fusebase/fusebase-gate-sdk`, `fusebase feature update --sync-gate-permissions` relies on static analysis of SDK method calls. Prefer these patterns so operations are detected reliably:

1. Keep direct method calls on API instances:
   - `const api = createWorkspacesApi(token)`
   - `await api.listWorkspaces(...)`
2. Prefer strongly typed API factories (`WorkspacesApi`, `NotesApi`, etc.), avoid `any` return types for Gate API objects.
3. Avoid dynamic call patterns for Gate operations:
   - avoid destructuring methods (`const { listWorkspaces } = api`)
   - avoid computed operation names (`api[opName](...)`) unless the key is a string literal
4. Keep a pre-publish check in your workflow:
   - `fusebase analyze gate --operations --json --feature <featureId>`
   - if runtime imports Gate SDK and `usedOps` is empty, treat it as a blocker and fix before publish.


## Security rule: no implicit service-token fallback

For user-facing Gate flows (membership status, current user/org access, workspace visibility), do not silently switch from feature-token auth to service-token auth when Gate returns auth errors.

- Required behavior: fail closed (`401/403`) and surface a clear runtime error.
- Forbidden behavior: "best-effort" fallback that returns data from owner/service context.
- If a feature truly needs service-token operations, keep them in explicit system/admin-only endpoints with audit logging and clear auth-source labeling.
