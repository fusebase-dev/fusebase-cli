---
version: "1.0.0"
mcp_prompt: domain.meetings
last_synced: "2026-03-06"
title: "Meetings (managed database)"
category: specialized
---
# Meetings (managed database)

> **MARKER**: `dashboards-meetings-managed-db-loaded` — When this marker is present in context, MCP prompts for this topic may skip conceptual sections and use API reference only.

> **VERSION CHECK**: If operations fail unexpectedly, load MCP prompt `domain.meetings` for latest content.

---
## Context: Managed Meetings Database

The **Meetings database** is a **managed database**:
- **Copyable** — Created per org via **getOrCreateDatabase** from a system template (query: `alias=meetings`, scope_type, scope_id). Users get a copy of the template; do not assume the database exists.
- **Built by admins** — Structure (dashboards, schema, relations) is defined by the service; end users use the default template and may add **custom columns** or **new tables** as needed.
- **External automation** — An external system runs **trackers** on newly received meetings (transcript upload triggers active trackers). Meetings rows are also created from outside (integrations, bots).
- **Child tables** — The database contains **nested tables** attached via **child-table-link** columns (e.g. Tracker Results per tracker row).

**Identifiers:** Use **aliases**, not org-specific IDs. Aliases are stable across accounts. Database alias: `meetings`. Dashboard aliases: `meetings` (Meetings table), `trackers` (Trackers table). Discover via MCP (getAllDatabases with alias filter, getDashboards by database_id), then use returned global_ids for tool_call.

---

## Structure (two main dashboards)

1. **Meetings** (alias: `meetings`) — One row per meeting: name, description, date/time, participants, link, video file (single), **transcript** (system; triggers trackers), status, type, account manager, organizer. Has relation/lookup columns: **Trackers** (many_to_many), **Client name** (relation to org clients). Has a **Tracker** child-table-link column linking to tracker results.
2. **Trackers** (alias: `trackers`) — One row per tracker definition: name, description, **Tracker Prompt** (what to look for), **Is Active** (toggle), **Activations** (readonly count), Tracker Type (System/Custom), Industry, and a **child-table-link** column to **Tracker Results** (one child table per tracker row, created from template).

**Tracker Results** (child tables): Each tracker row has a child table created from a template. Rows = activations (Match, Evidence, Summary/Insight, link to Meeting). Column **keys differ per child instance** — always resolve keys from the child's own schema (e.g. by name), never reuse template keys.

---

## Key columns (resolve by name, not key)

**Meetings:** Meeting Name (required), Meeting Description, Account Manager, Participants, Link to Meeting, Date and Time, Meeting File (files, max 1), **Meeting Transcript** (alias: `transcript` — system; when set, active trackers run), Meeting Status (Upcoming/Completed/Canceled/No Show), Meeting Type (Internal/External), Organizer, Tracker (child-table-link to trackers), Client name (Relation).

**Trackers:** Tracker name (child table) — child-table-link to Tracker Results; Tracker Description; **Tracker Prompt** (alias: `tracker_prompt`); **Insights Prompt** (alias: `insights_prompt`); **Is Active** (alias: `tracker_status`); **Activations** (alias: `tracker_activations`, readonly); Tracker Type; Tracker Industry.

**Tracker Results (child):** Resolve keys from child schema: Match (result_match), Evidence (evidence), Summary/Insight (summary_insight), Meeting Name (meeting_name lookup), Activations.

---

## Relations

- **Trackers → Meetings** (many_to_many): Tracker names appear on meeting rows; meeting rows can link to multiple trackers.
- **Meetings → Tracker Results** (many_to_many): Each result row links to the meeting it came from (Meeting Name lookup in child).
- **Clients → Meetings** (many_to_many): Client name on meeting rows.

Use **findRelationsByDashboardIds** (target_dashboard_id, optional source_dashboard_id, inversive_search) to discover relations. Use relation_id from response for addRelationRows / updateRelationRows when linking rows.

---

## MCP discovery pattern

1. **Database:** `tool_call({ opId: "getOrCreateDatabase", args: { query: { alias: "meetings", scope_type: "org", scope_id: "<from context>" }, body: { template_alias: "meetings", ... } } })` or list with `getAllDatabases({ alias: "meetings", scope_type, scope_id })` — use returned database `global_id`.
2. **Dashboards:** `getDashboards({ database_id: "<db global_id>" })` — find dashboards by alias `meetings` and `trackers`; note their `global_id` and default view `global_id`.
3. **Schema:** `getDashboardView({ dashboardId, viewId, fetch_filters: true })` — get schema; resolve column keys by name: `schema.items.find(i => i.name === "Meeting Name")?.key`.
4. **Data:** `getDashboardViewData({ dashboardId, viewId, ... })` — rows keyed by column keys; use `root_index_value` for row identity in relations.
5. **Child table:** For a tracker row, read child-table-link cell (title, childTableId, childTableViewId). If childTableId present, use it with childTableViewId for getDashboardViewData; else use **getChildTableLinkDashboard** (dashboard_id, item_key of child-table-link column, root_index_value, scope) to get or create the child dashboard.
6. **Relations:** `findRelationsByDashboardIds({ target_dashboard_id, include_rows: true/false })` to list relations and optionally relation_rows.

---

## Rules

- **Never hardcode** database, dashboard, or view UUIDs — they differ per org. Always discover by alias (meetings, trackers) and scope.
- **Column keys** are opaque and may differ per environment; resolve by **name** (or alias when documented) from the view schema.
- **Child table column keys** are **unique per child instance**; always take keys from the child dashboard's schema, not from the template.
- For **creating/updating** meetings or trackers use the same tool_call patterns as for any dashboard (batchPutDashboardData with create_new_row: true, addRelationRows, etc.); use generate_id for UUIDs when creating rows.

---

## Version

- **Version**: 1.0.0
- **Category**: specialized
- **Last synced**: 2026-03-06
- **Priority rule**: If the MCP prompt has a higher version, follow the prompt's API Reference as source of truth.
