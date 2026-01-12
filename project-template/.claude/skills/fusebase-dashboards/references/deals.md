---
version: "1.1.0"
mcp_prompt: domain.deals
last_synced: "2026-03-19"
title: "Deals (managed database)"
category: specialized
---
# Deals (managed database)

> **MARKER**: `dashboards-deals-managed-db-loaded` — When this marker is present in context, MCP prompts for this topic may skip conceptual sections and use API reference only.

> **VERSION CHECK**: If operations fail unexpectedly, load MCP prompt `domain.deals` for latest content.

---
## Context: Deals Managed Database

The **Deals database** is a **managed database** for CRM pipeline tracking:
- **Copyable** — Created per org via **getOrCreateDatabase** from a system template (query: `alias=deals_db`, scope_type, scope_id). Users get a copy of the template; do not assume the database exists.
- **Built by admins** — Structure (dashboard, schema, views, relations) is defined by the service; end users use the default template and may add **custom columns** as needed.
- **User-created rows** — Deal rows are **created by users** through the deals dashboard UI (e.g. "Add deal" button opening a detail view).
- **CRM pipeline entity** — Tracks sales deals through stages (Lead → In Progress → Won / Lost). Each deal can be associated with clients, companies, and portals.
- **Cross-entity relations** — Links to Clients, Companies, Portals via many-to-many relations.
- **Kanban-first** — The default view is a **Kanban board** ("Pipeline"), not a table. Use view alias `pipeline` for default, `all_deals` for table view.

**Identifiers:** Use **aliases**, not org-specific IDs. Database alias: `deals_db`. Dashboard alias: `deals`. View aliases: `pipeline` (default, Kanban), `all_deals` (table). Discover via MCP (getOrCreateDatabase or getAllDatabases with alias filter, then getDashboards by database_id), then use returned global_ids for tool_call.

---

## Structure (one dashboard, two views)

1. **Deals** (alias: `deals`, rootEntity: `custom`) — One row per deal. System columns: **Deal Name** (alias: `deal_name`, required, single-line, unique on create), **Deal Stage** (single-select label: Lead / In Progress / Won / Lost), **Deal Value** (currency), **Associated Clients** (relation to Clients), **Associated Company** (relation to Companies), **Associated Portal** (relation to Portals). Custom columns allowed. No child tables.

**Views:** **Pipeline** (alias: `pipeline`, default) — Kanban grouped by Deal Stage. **All deals** (alias: `all_deals`) — table view. Both views share the same underlying rows; use the appropriate viewId for Kanban vs flat data.

---

## Key columns (resolve by name, not key)

All system columns belong to `group_ids: ["system"]`. Resolve by name: `schema.items.find(i => i.name === "Deal Name")?.key`. Deals: Deal Name (alias: `deal_name`, required, unique on create), Deal Stage (single-select label — write as array of one label nanoid), Deal Value (currency object), Associated Clients / Associated Company / Associated Portal (lookup, selectable, many_to_many). Label nanoids from schema `render.labels` — do not hardcode.

---

## Relations

Deals is the **target** dashboard. Source dashboards: Clients, Companies, Portals. Use **findRelationsByDashboardIds** (`target_dashboard_id: <deals_dashboard_id>`, `inversive_search: true`). Use `relation_id` for addRelationRows; `target_index` = deal's `root_index_value`. Do NOT write relation columns via batchPutDashboardData.

---

## MCP discovery pattern

1. **Database:** `getOrCreateDatabase` or `getAllDatabases({ alias: "deals_db", scope_type, scope_id })` — use returned database `global_id`.
2. **Dashboard:** `getDashboards({ database_id: "<db global_id>" })` — find dashboard by alias `deals`; note `global_id` and **all views** (Pipeline + All deals).
3. **Views:** Default view is Pipeline (Kanban); table view is All deals. Use `getDashboardView({ dashboardId, viewId })` for each; resolve column keys by name from schema.
4. **Data:** `getDashboardViewData({ dashboardId, viewId, ... })` — choose viewId based on Kanban vs flat data needs.
5. **Relations:** `findRelationsByDashboardIds({ target_dashboard_id: "<deals_dashboard_id>", inversive_search: true })`.
6. **Link rows:** `addRelationRows` for linking clients, companies, or portals to a deal.
7. **Create/update rows:** `batchPutDashboardData` with `create_new_row: true`. Write Deal Name, Deal Stage (label nanoid array), Deal Value (currency). Do NOT write relation columns via batchPutDashboardData.

---

## Rules

- **Never hardcode** database, dashboard, or view UUIDs — discover by alias (`deals_db`, `deals`) and scope.
- **Column keys** are opaque; resolve by **name** from the view schema.
- **Deal Name** (alias: `deal_name`) is unique on create; duplicates will fail.
- If the API returns a uniqueness/duplicate error for `deal_name` while creating/updating, do NOT blindly retry with `create_new_row`: load existing rows via the Deals view data (getDashboardViewData) and then update/link the existing row with the same `deal_name` value (LLM may not see all current values).
- **Default view is Kanban** (Pipeline), not table — features must account for this.
- **Deal Stage:** single-select — write as array containing one label nanoid; read nanoids from schema.
- **Relation direction:** Deals is target; use target_index for deal's root_index_value.
- For **creating/updating** deals use batchPutDashboardData, addRelationRows; use generate_id for UUIDs when creating rows.

---

## Version

- **Version**: 1.1.0
- **Category**: specialized
- **Last synced**: 2026-03-19
- **Priority rule**: If the MCP prompt has a higher version, follow the prompt's API Reference as source of truth.
