---
name: fusebase-portal-specific-features
description: How to develop features that show different information based on the portal where they are embedded. Use when a task requires showing different data depending on the parent portal
---

# Features in portals
A "portal" is a user-customized website configured in the Fusebase web UI. Portals can display different blocks, including blocks that render apps/features in an `iframe`.
In this case, information about the current portal is automatically added to the auth context, so requests from the embedded app/feature carry portal information automatically.

# Developing portal-specific features
When the user asks for a feature that should show different information based on the portal where it is embedded, use a Fusebase database table with a view filter that uses the `{{CurrentPortal}}` dynamic value. See the `filters` reference in the `fusebase-dashboards` skill for details.
Requests to this view automatically receive the current portal in context, and that value is substituted into the view filter. 
**Important!** You **should not** take a portal ID explicitly as a parameter (query, path, input, etc.); it should be resolved automatically when the view is configured correctly.

# Important considerations
- When possible, always use a relation column that links to portal dashboards instead of a plain-text column for portal IDs.
- Pay attention to set a filter to a column that has a relation to the portal dashboard (or portal id in case you implemented a column of text type for that)
- **Important!** If you are using a relation column for portals, be sure to set the correct render type for this column.
