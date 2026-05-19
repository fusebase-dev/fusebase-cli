# Conceptual Model: Products, Apps, and Data Access

This document explains the core concepts of the Fusebase Apps system from first principles, clarifying what entities exist, where they live, and how they relate.

## Product Lifecycle: API Entity vs Local Project

### What is a "Product"?

A **Product** in Fusebase is a **server-side entity** that exists in the Fusebase API. It represents a container for apps and has:
- A unique ID (`productId`)
- A title and subdomain
- An organization owner (`orgId`)
- A collection of apps

### What is a "Local Project"?

A **local project** is a directory on your machine that contains:
- `fusebase.json` - Configuration file linking to an API-side product
- App code directories (e.g., `apps/my-app/`)
- Build artifacts
- Project template files (if used)

### Source of Truth

**API is the source of truth** for:
- Product existence and metadata
- App records (IDs, titles, paths)
- App versions and deployments

**Local files are the source of truth** for:
- App source code
- Build configuration (`fusebase.json` → `apps[].build`)
- Development configuration (`fusebase.json` → `apps[].dev`)

### Creating a Product

When you run `fusebase init`:

1. **API-side**: A product record is created (or selected) in the Fusebase API
   - This happens via `createProduct()` or selection from existing products
   - The product gets a unique `productId` and `orgId`
   - This product exists permanently in Fusebase

2. **Local-side**: A `fusebase.json` file is created
   - Contains `orgId` and `productId` that reference the API-side product
   - This file links your local project to the API-side product
   - The project directory may be empty or contain template files

**Key point**: The product exists in Fusebase regardless of whether you have a local project. The local project is just a workspace for developing apps that belong to that product.

---

## App Lifecycle: Record vs Code

### What is an "App Record"?

An **app record** is a **server-side entity** in the Fusebase API that represents:
- A deployable unit (e.g., a dashboard widget, form, or tool)
- Metadata: ID, title, path (URL segment), description
- Version history (each deployment creates a new version)
- Runtime configuration

### What is "App Code"?

**App code** is the **local source code** you write:
- Lives in `apps/{app-name}/` directory
- A React/Vite application (or other framework)
- Contains UI, business logic, API calls
- Gets built and deployed to become an app version

### The Relationship

```
┌─────────────────────────────────────────────────────────┐
│ Fusebase API (Server-side)                              │
│                                                          │
│  Product (productId: "prod_123")                                 │
│    └── App Record (id: "app_456", path: "widget") │
│         └── App Versions (v1, v2, v3...)            │
└─────────────────────────────────────────────────────────┘
                          ↕ (linked via fusebase.json)
┌─────────────────────────────────────────────────────────┐
│ Local Project (Your Machine)                            │
│                                                          │
│  fusebase.json                                               │
│    └── apps[].id: "app_456"                        │
│         └── path: "apps/widget"                      │
│                                                          │
│  apps/widget/                                        │
│    ├── src/App.tsx  (your code)                         │
│    ├── package.json                                      │
│    └── dist/  (build output → deployed)                 │
└─────────────────────────────────────────────────────────┘
```

### Creating an App

When you create an app:

1. **API-side** (via `fusebase app create` or Fusebase UI):
   - App record is created with `id`, `title`, `path` (URL segment)
   - This record exists permanently in Fusebase
   - The `path` in the API is the URL segment (e.g., `"dashboard"`)

2. **Local-side** (you write the code):
   - Create `apps/{app-name}/` directory
   - Write React/Vite application code
   - Configure in `fusebase.json`:
     - `id`: Must match the API-side app ID
     - `path`: Local directory path (e.g., `"apps/widget"`)
     - `dev.command`: How to run locally
     - `build.command`: How to build for deployment

3. **Deployment** (via `fusebase deploy`):
   - Builds your local code
   - Creates a new app version in the API
   - Uploads built files
   - App becomes accessible at: `https://{product.sub}.{domain}/{app.path}`

**Key points**:
- App record (API) and app code (local) are **separate entities**
- The `id` in `fusebase.json` must match the API-side app ID
- The `path` in `fusebase.json` is the local directory; the `path` in the API is the URL segment
- You can have an app record without code, or code without a record (but both are needed for deployment)

---

## App IDs, Paths, and Runtime URLs

### App ID
- **Format**: UUID or string identifier
- **Source**: Generated by Fusebase API when app record is created
- **Purpose**: Unique identifier for the app record
- **Where used**: `fusebase.json` → `apps[].id`, API calls

### App Path (Local)
- **Format**: Relative directory path (e.g., `"apps/my-app"`)
- **Source**: You choose when creating the app directory
- **Purpose**: Where your source code lives locally
- **Where used**: `fusebase.json` → `apps[].path`

### App Path (API / URL Segment)
- **Format**: URL-safe string (e.g., `"dashboard"`, `"settings"`)
- **Source**: Set when creating app record (via `fusebase app create` or UI)
- **Purpose**: URL segment where app is accessible
- **Where used**: Runtime URL construction

### Runtime URL Construction

When an app is deployed, it becomes accessible at:

```
https://{product.sub}.{domain}/{app.path}
```

Where:
- `{product.sub}`: Product subdomain (from API-side product)
- `{domain}`: Environment domain (`dev-thefusebase-app.com` or `thefusebase.app`)
- `{app.path}`: URL segment from API-side app record (NOT the local directory path)

**Example**:
- Product subdomain: `"my-product"`
- App path (API): `"dashboard"`
- Runtime URL: `https://my-product.thefusebase.app/dashboard`

**Important**: The local directory path (`apps/my-app`) and the URL segment (`dashboard`) are **independent**. They don't have to match, though matching them is often clearer.

---

## MCP vs SDK: Responsibility Split

### MCP (Model Context Protocol)

**Purpose**: Discovery and reasoning

**Used for**:
- Discovering available operations (`tools_list`, `tools_search`)
- Understanding what operations exist and what they do
- Getting input/output schemas
- Understanding required permissions/context (prompt groups)

**When to use MCP**:
- During development planning
- When an LLM needs to understand capabilities
- When exploring available operations
- When reasoning about what operations to use

**What MCP does NOT do**:
- Execute operations in production code
- Provide runtime APIs for app code
- Handle authentication in app code

### SDK (Software Development Kit)

**Purpose**: Execution in app code

**Used for**:
- Actual API calls from app code
- Runtime data operations (read, write, upload)
- Production execution of operations

**When to use SDK**:
- In app source code (React components, utilities)
- For runtime data access
- When building apps that users interact with

**Relationship to MCP**:
- SDK methods mirror MCP tools 1:1 by operation ID
- Same input/output schemas as MCP tools
- Same HTTP endpoints and methods
- SDK is the "execution surface" for operations discovered via MCP

### The Flow

```
┌─────────────────────────────────────────────────────────┐
│ Discovery Phase (MCP)                                    │
│                                                          │
│  LLM/Developer:                                          │
│    1. Query MCP: tools_list()                           │
│    2. Understand available operations                   │
│    3. Choose which operations to use                    │
│    4. Understand input/output schemas                   │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Implementation Phase (SDK)                              │
│                                                          │
│  App Code:                                           │
│    1. Import SDK method (mirrors MCP tool)              │
│    2. Call SDK method with parameters                   │
│    3. Handle response                                   │
│                                                          │
│  Example:                                                │
│    import { readDashboardData } from '@fusebase/sdk'    │
│    const data = await readDashboardData({ ... })        │
└─────────────────────────────────────────────────────────┘
```

**Key principle**: Discover via MCP, execute via SDK.

---

## How Capability Discovery Works

### For Humans

1. **MCP Server Connection**:
   - MCP server URL and token are configured in `.env` (via `fusebase init`)
   - IDE configs (`.cursor/mcp.json`, `.vscode/mcp.json`) point to MCP server

2. **Query Available Tools**:
   - Use MCP client to call `tools_list` or `tools_search`
   - Review tool descriptions and schemas
   - Understand required parameters and permissions

3. **Find SDK Method**:
   - SDK methods have the same operation IDs as MCP tools
   - Import SDK method matching the MCP tool you want to use
   - Use same parameter schema as MCP tool

4. **Implement**:
   - Write app code using SDK methods
   - Handle responses according to schemas from MCP

### For LLMs

1. **Bootstrap Context**:
   - LLM receives prompt explaining MCP vs SDK distinction
   - Understands that MCP is for discovery, SDK is for execution

2. **Discovery Phase**:
   - LLM queries MCP: `tools_list()` or `tools_search("read data")`
   - Reviews tool schemas and descriptions
   - Understands available operations and their requirements

3. **Planning Phase**:
   - LLM reasons about which operations to use
   - Understands input/output formats
   - Plans implementation approach

4. **Implementation Phase**:
   - LLM writes code using SDK methods (not MCP tools)
   - Uses operation IDs to find corresponding SDK methods
   - Implements app logic with SDK calls

### What NOT to Do

**❌ Do NOT guess endpoints**:
- Don't construct HTTP URLs manually
- Don't assume endpoint patterns
- Use MCP discovery to find correct operations

**❌ Do NOT use MCP tools in app code**:
- MCP tools are for discovery/reasoning, not execution
- App code should use SDK methods
- MCP tools are called by the LLM/IDE, not by your app

**❌ Do NOT hardcode IDs**:
- Database IDs, dashboard IDs, view IDs should be discovered
- Use MCP discovery or existing project documentation to find IDs
- Document discovered IDs in app code as constants

---

## Conceptual Data Access Flow

### Overview

Data in Fusebase is organized hierarchically:

```
Organization
  └── Database
       └── Dashboard (table)
            └── View (filtered/sorted table)
                 └── Rows (data records)
                      └── Columns (fields)
```

### Reading Data

**Conceptual flow**:
1. **Discover structure**: Use MCP discovery to find:
   - Database IDs
   - Dashboard IDs (tables)
   - View IDs (filtered views)
   - Column keys (field identifiers)

2. **Understand schema**: Review column types, relationships, constraints

3. **Implement read**: Use SDK method (mirrors MCP tool) to read data:
   - Pass dashboard ID, view ID
   - Handle pagination if needed
   - Extract values using helper functions (some fields are nested)

4. **Process data**: Transform API response to app's data model

**Required IDs**:
- `dashboardId`: UUID of the table
- `viewId`: UUID of the view (filtered/sorted version of table)
- Column keys: String identifiers for each field (e.g., `"HEKvLWs3"`)

**How to discover IDs**:
- Use MCP `tools_search("database")` / `tools_search("dashboard")` to find discovery tools
- Use MCP describe/list calls to inspect databases, dashboards, views, and schema
- Prefer the workflow documented in the project skills over ad hoc scripts

### Writing Data

**Conceptual flow**:
1. **Discover structure**: Same as reading (find dashboard, view, column keys)

2. **Understand data format**: Review column types to understand:
   - Text: plain string
   - Select/Status: array of nanoid values
   - Date: ISO date string
   - Number: numeric value
   - File: complex object with URL, metadata

3. **Implement write**:
   - **Step 1**: Create row (generate UUID, call create row API)
   - **Step 2**: Populate columns (one API call per column)
   - Use SDK methods matching MCP tools for these operations

4. **Handle relations**: If linking rows, use relation API after both rows exist

**Key points**:
- Writing is a two-step process (create row, then populate columns)
- Each column requires a separate API call
- Column values must match the column type format

### File Upload

**Conceptual flow**:
1. **Upload file**: Create temporary file via upload API
   - Files < 50MB: single request
   - Files ≥ 50MB: multi-part upload (chunked)

2. **Store file**: Convert temp file to stored file
   - Get stored file UUID

3. **Reference in data**: Use stored file UUID in file column
   - Format: `/FILE_UUID/filename.ext` (relative path)
   - Include in file column data structure

**Required information**:
- File object (from user input or generated)
- Folder: Always `"apps"` for app uploads
- MIME type and size

---

## Summary: Key Concepts

1. **Products are API entities**; local projects are workspaces that link to products via `fusebase.json`

2. **Apps have two parts**: API-side record (metadata) and local code (implementation)

3. **MCP is for discovery**; SDK is for execution in app code

4. **IDs must be discovered**; don't guess or hardcode database/dashboard/view IDs

5. **Data access is hierarchical**: Organization → Database → Dashboard → View → Rows → Columns

6. **Use MCP + SDK** for all development: MCP for discovery, SDK for execution in app code
