# Managed app: aliases and resolveAliases

**This section applies when this project is a managed app** (initialized with `fusebase init --managed`). The database is copied per user/org; real IDs differ per environment.

## Do not hardcode real IDs

- **Never hardcode** database, dashboard, or view IDs from the dashboards-service in code.
- Real `global_id` values (database, dashboard, view) are **per-org/per-user** because the database is copied for each consumer of the managed app. Hardcoded IDs will break in other environments.

## Use aliases for entities

- When **creating** or **referencing** databases, dashboards, and views, use **aliases** (human-readable identifiers), not UUIDs.
- Aliases are stable across accounts; IDs are not.
- Set and use `alias` for database, dashboard, and view entities so the same code works in every environment.

## Resolve aliases to real IDs at runtime

- To obtain **real IDs** for use in API calls (e.g. `getDashboardView`, `batchPutDashboardData`), use the **resolveAliases** operation.
- **MCP (development):** `tool_call({ opId: "resolveAliases", args: { scope, items } })` — see skill **fusebase-dashboards**, references: [Domain Overview (resolveAliases)](.claude/skills/fusebase-dashboards/references/core-concepts.md), [Meetings (managed database)](.claude/skills/fusebase-dashboards/references/meetings.md).
- **SDK (runtime):** Use the corresponding SDK method for **resolveAliases** (discover via `sdk_search` / `sdk_describe`). Call it at runtime with aliases and scope to get `global_id` values, then use those IDs for subsequent dashboard/data calls.
- **Request shape:** `scope`: `{ scope_type: "org", scope_id: "<org scope uuid>" }`; `items`: array of `{ entity_type: "database" | "dashboard" | "view", alias?: string, id?: string }`; for dashboard include parent `database_id` or `database_alias`; for view include parent database and `dashboard_id` or `dashboard_alias`.
- **Response:** `data.results[]` with `id` (resolved global_id), `alias`, `resolved` (boolean). Use resolved IDs only after `resolved === true`.

## Summary

1. Use **aliases** for all database/dashboard/view identifiers in app logic and when creating entities.
2. Resolve aliases to IDs at runtime via **resolveAliases** (MCP during development, SDK in feature code).
3. Never hardcode database, dashboard, or view UUIDs from the dashboards-service.
