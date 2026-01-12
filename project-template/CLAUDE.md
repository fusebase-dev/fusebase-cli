# Always-on rules (read before @AGENTS.md)

**Dashboard SDK data (runtime code):** Before writing or reviewing code that calls dashboard data SDK methods (`getDashboardViewData`, `batchPutDashboardData`, and similar), you **must** (1) read `.claude/skills/fusebase-dashboards/references/data-patterns.md` for the actual response/request shapes, and (2) use `sdk_describe` on that method (e.g. `schemaMode: "output"`) before writing parsing logic. **Do not** guess shapes (for example assuming `response.data.rows` when the API returns a flat `data` array plus `meta`).

@AGENTS.md
