# Always-on rules (read before @AGENTS.md)

**Type safety:** No `any` / `as Record<string, unknown>` / `as any` on SDK JSON; use `@fusebase/*` types, `sdk_describe`, narrowing — @AGENTS.md **Type safety invariant**.

**Dashboard SDK data (runtime code):** Before writing or reviewing code that calls dashboard data SDK methods (`getDashboardViewData`, `batchPutDashboardData`, and similar), you **must** (1) read `.claude/skills/fusebase-dashboards/references/data-patterns.md` for the actual response/request shapes, and (2) use `sdk_describe` on that method (e.g. `schemaMode: "output"`) before writing parsing logic. **Do not** guess shapes (for example assuming `response.data.rows` when the API returns a flat `data` array plus `meta`).

**Dashboard data SDK request args:** Methods such as `getDashboardViewData` and `batchPutDashboardData` take **route parameters under `path`**, e.g. `{ path: { dashboardId, viewId }, ... }` (plus `body` / query per `sdk_describe`). **Do not** pass `{ dashboardId, viewId }` at the top level — that matches MCP `tool_call` **args**, not the TypeScript SDK. Apply the **same** SDK shape in **SPA and feature `backend/`** code.

**Custom skill-doc additions (required format):** When adding project-specific notes to managed skill markdown files (`.claude/skills/**/SKILL.md` and `.claude/skills/**/references/*.md`), write them only in a tail block:
`<!-- CUSTOM:SKILL:BEGIN --> ... <!-- CUSTOM:SKILL:END -->`.
Keep this block at the end of the file and do not add custom content outside it.

<% if (it.flags?.includes("app-business-docs")) { %>
**Business logic docs (flag: `app-business-docs`):** Load `.claude/skills/app-business-docs/SKILL.md` when business rules or user flows change, then update `docs/en/business-logic.md`.
<% } %>
<% if (it.flags?.includes("isolated-stores")) { %>
**Isolated SQL schema discipline (flag: `isolated-stores`):** For any isolated SQL schema change, enforce this order with no exceptions: update/create migration files in `postgres/migrations/` -> compute checksum from file bytes -> run status -> then apply. Inline SQL in MCP is allowed only for one-off smoke/dev tests and must be marked temporary. Do not finish schema tasks without new/updated migration files + manifest.
<% } %>
<% if (it.flags?.includes("git-debug-commits")) { %>
**Git debug traceability (flag: `git-debug-commits`):** Treat commit-per-fix as mandatory. After every verified debug fix, create a dedicated commit (`fix(debug): <why>`) before moving to the next fix. Before `fusebase deploy`, run git preflight (`status`, branch, SHA) and stop on dirty tree unless the user explicitly approves. Every debug/deploy report must include commit SHA and rollback command (`git revert <sha>`).
<% } %>

@AGENTS.md (section **Dashboard data SDK: path parameters (SPA and backend)**).
