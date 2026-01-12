---
version: "1.1.0"
mcp_prompt: domain.templates
last_synced: "2026-02-13"
title: "Templates"
category: specialized
---
# Templates

> **MARKER**: `dashboards-templates-concepts-loaded` — When this marker is present in context, MCP prompts for this topic may skip conceptual sections and use API reference only.

> **VERSION CHECK**: If operations fail unexpectedly, load MCP prompt `domain.templates` for latest content.

---
## Templates Concept

### What are Templates?
- Templates are **global** dashboards and databases stored in a special template org scope (TEMPLATE_ORG_SCOPE_ID).
- Templates are **NOT** in your token's org scope - they are system-wide resources available to all users.
- Templates serve as starting points for creating new dashboards and databases in your organization.

### Template Types

#### Template Dashboards
- Standalone dashboards that can be copied to your org.
- May be associated with a template database (database_id) or standalone (database_id = null).
- When copied, the dashboard and its views, schema, and optionally data are created in your org scope.

#### Template Databases
- Complete databases with dashboards, views, and relations.
- When copied, the entire database structure is replicated to your org scope.
- You can choose what to copy: tables, views, data, relations, and default rows.

### Searching Templates

Use these operations to discover available templates:
- `getTemplates`: Get a list of dashboard templates with optional filtering
  - **Useful for finding templates for system standalone dashboards** with `rootEntity = form`, `client`, `portal`, `workspace`
  - Filter by `root_entity`, `name`, `page`, `limit`
  - Returns templates that can be used to create standalone dashboards
- `searchTemplateDashboards`: Search for template dashboards
  - Filter by dashboard_id, database_id, database_alias, or alias
  - If database_id/database_alias not provided, returns only standalone dashboards (database_id = null)
- `searchTemplateDatabases`: Search for template databases
  - Filter by database_id or alias

### Creating from Templates

#### Creating Dashboard from Template
**Not in MCP**: `createDashboardFromTemplate` and `createDashboardFromForm` are not exposed as MCP tools. Use **createDashboardIntent** to create a dashboard from scratch, or **copyDashboardFromDatabase** / **copyDashboardFromDashboard** to copy from an existing dashboard. For template- or form-based creation use the REST API or SDK.

You can still **search** templates in MCP:
- `searchTemplateDashboards`, `searchTemplateDatabases`, `getTemplates` — use these to discover templates; creation from template must be done via REST/SDK.

#### Creating Database from Template
1. **Search for templates**: Use `searchTemplateDatabases` to find available template databases.
2. **Select a template**: Choose a template database by its database_id.
3. **Copy to your org**: Use `copyDatabaseFromDatabase` operation:
   - Provide the template `source_database_id` (or equivalent) and **scopes** array for target org, e.g. `scopes: [{ scope_type: 'org', scope_id: '<your-org-id>' }]`. There is no separate `org_scope_id` field.
   - Configure what to copy: `copy_tables`, `copy_views`, `copy_data`, `copy_relations`, `create_default_rows` (see tools_describe).

### Important Notes

- **Templates are global**: They exist outside your org scope but can be copied into it.
- **Copy operations require write permissions**: You need `dashboard.write` or `database.write` permissions.
- **Org scope**: When copying, specify your organization via the **scopes** array in the request body, e.g. `scopes: [{ scope_type: 'org', scope_id: '<your-org-id>' }]`.
- **Template org scope is read-only**: You cannot modify templates directly - only copy them to your org.
- **Standalone vs Database-linked**: Template dashboards can be standalone (no database) or linked to a template database.

### Workflow Example (database copy — in MCP)

```
1. Search for template databases: searchTemplateDatabases({})
2. Copy to your org: copyDatabaseFromDatabase({ body: { source_database_id: '<uuid>', scopes: [{ scope_type: 'org', scope_id: '<your-org-id>' }], ... } })
```

### Related Operations (MCP)

- `searchTemplateDashboards`, `searchTemplateDatabases`, `getTemplates`: Discover templates
- `copyDatabaseFromDatabase`: Copy a database (including from template) to your org
- `copyDashboardFromDashboard`: Copy an existing dashboard to another scope
- Dashboard from template / form: not in MCP — use REST or SDK

---

## Version

- **Version**: 1.1.0
- **Category**: specialized
- **Last synced**: 2026-02-13
- **Priority rule**: If the MCP prompt has a higher version, follow the prompt's API Reference as source of truth.
