---
version: "1.1.0"
mcp_prompt: domain.companies
last_synced: "2026-03-19"
title: "Companies (managed database)"
category: specialized
---
# Companies (managed database)

> **MARKER**: `dashboards-companies-managed-db-loaded` — When this marker is present in context, MCP prompts for this topic may skip conceptual sections and use API reference only.

> **VERSION CHECK**: If operations fail unexpectedly, load MCP prompt `domain.companies` for latest content.

---
## Context: Companies Managed Database

The **Companies database** is a **managed database** for B2B organizations:
- **Copyable** — Created per org via **getOrCreateDatabase** from a system template (query: `alias=companies_db`, scope_type, scope_id). Users get a copy of the template; do not assume the database exists.
- **Built by admins** — Structure (dashboard, schema, relations) is defined by the service; end users use the default template and may add **custom columns** as needed.
- **User-created rows** — Company rows are **created by users** through the dashboard UI, inline creation dialogs from other dashboards (e.g. workspace creation), or during portal creation.
- **B2B grouping entity** — Groups workspaces, portals, and clients under a single company. Designed for CRM synchronization (every CRM has a Company/Account object).
- **Cross-entity relations** — Links to three other system dashboards (Workspaces, Portals, Clients) via many-to-many relations with **auto-linking** behavior.

**Identifiers:** Use **aliases**, not org-specific IDs. Database alias: `companies_db`. Dashboard alias: `companies`. View alias: `companies` (default view). Discover via MCP (getOrCreateDatabase or getAllDatabases with alias filter, then getDashboards by database_id), then use returned global_ids for tool_call.

---

## Structure (one dashboard in a database)

1. **Companies** (alias: `companies`, rootEntity: `custom`) — One row per company. System columns: **Name** (alias: `company_name`, required, unique per org), **URL** (required, link), **Description** (long text), **Files** (files), **Categories** (multi-select label with industry options), **Employee range** (single-select label with size ranges). Has relation/lookup columns: **Workspace name** (many_to_many to Workspaces), **Portal name** (many_to_many to Portals), **Client name** (many_to_many to Clients). No child tables. Single-dashboard managed database.

---

## Key columns (resolve by name, not key)

All columns belong to `group_ids: ["system"]`. Resolve by name from the view schema: `schema.items.find(i => i.name === "Name")?.key`. Companies: Name (alias: `company_name`, required, unique per org), URL (required, link), Description (multi-line), Files (files), Workspace name / Portal name / Client name (lookup, selectable, many_to_many). Categories (multi-select label, industry options), Employee range (single-select label, size ranges). Label columns: write as array of label **nanoid** strings from schema; link columns: `{ url, text }`.

---

## Relations

Companies is always the **target** dashboard. Source dashboards: Workspaces (root_entity: workspace), Portals (root_entity: portal), Clients (root_entity: client). All relation columns are selectable. Use **findRelationsByDashboardIds** (`target_dashboard_id: <companies_dashboard_id>`, `inversive_search: true`) to discover relations. Use `relation_id` for **addRelationRows** / **updateRelationRows**. When linking: company's `root_index_value` goes in **target_index**.

**Auto-linking (system-managed):** Workspace→Company when workspace created with company selected; Portal→Company when portal created in workspace that has a company; Clients→Company when clients added to a portal linked to a company. Do NOT manually create these via addRelationRows — use addRelationRows only for **explicit manual linking**.

---

## MCP discovery pattern

1. **Database:** `getOrCreateDatabase` or `getAllDatabases({ alias: "companies_db", scope_type, scope_id })` — use returned database `global_id`.
2. **Dashboard:** `getDashboards({ database_id: "<db global_id>" })` — find dashboard by alias `companies`; note its `global_id` and default view `global_id`.
3. **Schema:** `getDashboardView({ dashboardId, viewId, fetch_filters: true })` — resolve column keys by name.
4. **Data:** `getDashboardViewData({ dashboardId, viewId, ... })` — use `root_index_value` for row identity in relations.
5. **Relations:** `findRelationsByDashboardIds({ target_dashboard_id: "<companies_dashboard_id>", inversive_search: true, include_rows: true/false })`.
6. **Link rows:** `addRelationRows({ relationId, body: { rows: [{ source_index, target_index }] } })` — target_index = company's root_index_value.
7. **Create/update rows:** `batchPutDashboardData` with `create_new_row: true`. Do NOT write relation/lookup columns via batchPutDashboardData.

---

## Rules

- **Never hardcode** database, dashboard, or view UUIDs — discover by alias (`companies_db`, `companies`) and scope.
- **Column keys** are opaque; resolve by **name** from the view schema.
- **Company Name** (alias: `company_name`) is unique per organization; duplicates will fail. **Company URL** is NOT unique.
- If the API returns a uniqueness/duplicate error for `company_name` while creating/updating, do NOT blindly retry with `create_new_row`: load existing rows via the Companies view data (getDashboardViewData) and then update/link the existing row with the same `company_name` value (LLM may not see all current values).
- **Relation direction:** Companies is always **target**; use target_index for company's root_index_value.
- **Do NOT write relation columns** via batchPutDashboardData — use addRelationRows for linking.
- **Auto-linking is system-managed** — do not duplicate auto-link relations manually.
- For **creating/updating** companies use batchPutDashboardData (create_new_row: true), addRelationRows; use generate_id for UUIDs when creating rows.

---

## Version

- **Version**: 1.1.0
- **Category**: specialized
- **Last synced**: 2026-03-19
- **Priority rule**: If the MCP prompt has a higher version, follow the prompt's API Reference as source of truth.
