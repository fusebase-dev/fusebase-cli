# Always-on rules (read before @AGENTS.md)

**Dashboard SDK data (runtime code):** Before writing or reviewing code that calls dashboard data SDK methods (`getDashboardViewData`, `batchPutDashboardData`, and similar), you **must** (1) read `.claude/skills/fusebase-dashboards/references/data-patterns.md` for the actual response/request shapes, and (2) use `sdk_describe` on that method (e.g. `schemaMode: "output"`) before writing parsing logic. **Do not** guess shapes (for example assuming `response.data.rows` when the API returns a flat `data` array plus `meta`).

**Dashboard data SDK request args:** Methods such as `getDashboardViewData` and `batchPutDashboardData` take **route parameters under `path`**, e.g. `{ path: { dashboardId, viewId }, ... }` (plus `body` / query per `sdk_describe`). **Do not** pass `{ dashboardId, viewId }` at the top level — that matches MCP `tool_call` **args**, not the TypeScript SDK. Apply the **same** SDK shape in **SPA and feature `backend/`** code.

<% if (it.flags?.includes("app-business-docs")) { %>
**Business logic docs (flag: `app-business-docs`):** Load `.claude/skills/app-business-docs/SKILL.md` when business rules or user flows change, then update `docs/en/business-logic.md`.
<% } %>
<% if (it.flags?.includes("isolated-stores")) { %>
**Isolated SQL schema discipline (flag: `isolated-stores`):** For any isolated SQL schema change, enforce this order with no exceptions: update/create migration files in `postgres/migrations/` -> compute checksum from file bytes -> run status -> then apply. Inline SQL in MCP is allowed only for one-off smoke/dev tests and must be marked temporary. Do not finish schema tasks without new/updated migration files + manifest.
<% } %>

@AGENTS.md (section **Dashboard data SDK: path parameters (SPA and backend)**).
