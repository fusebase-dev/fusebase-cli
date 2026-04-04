---
name: fusebase-cli
description: "Complete guide for using the Fusebase CLI (fusebase) tool to initialize, develop, and deploy Fusebase Apps features. Use when: 1. Initializing new Fusebase Apps projects, 2. Creating or configuring features, 3. Running features locally or deploying them 4. Setting up feature permissions for dashboards."
---

# Fusebase CLI (fusebase)

This skill describes how to use the Fusebase CLI tool to manage and deploy Fusebase Apps features.

## Overview

The Fusebase CLI (`fusebase`) is a command-line tool for:

- Initializing new Fusebase Apps projects
- Managing feature development with hot reload
- Deploying features to the Fusebase platform

## Installation & Authentication

The `fusebase` CLI is installed globally. Always invoke it as `fusebase <command>` — **never use `npx fusebase`**.

Before using the CLI, authenticate with your API key:

```bash
fusebase auth
```

This stores credentials in `~/.fusebase/config.json`.

## Project Configuration (fusebase.json)

Every Fusebase Apps project requires a `fusebase.json` file in the project root. This file defines the app and its features.

For details on the `fusebase.json` schema, see references/fusebase-json-schema.md.

## Feature Permissions

Features can have permissions that define which dashboard views they can access. This is **required** when creating features that interact with specific dashboards.

### Permission Format

Permissions are specified as a semicolon-separated string:

```
dashboardView.dashboardId:viewId.privileges[;dashboardView.dashboardId2:viewId2.privileges2;...]
```

Where:

- `dashboardView` - The permission type (currently only `dashboardView` is supported)
- `dashboardId` - The dashboard's global ID (UUID from MCP or Fusebase UI)
- `viewId` - The view's global ID (UUID from MCP or Fusebase UI)
- `privileges` - Comma-separated: `read`, `write`, or `read,write`

### Setting Permissions

**Always set permissions during feature creation** using `--permissions`. This is the correct time — do not skip it and do `feature update` later.

```bash
fusebase feature create --name="Sales Report" --subdomain=sales-report --path=features/sales-report --dev-command="npm run dev" --build-command="npm run build" --output-dir=dist --permissions="dashboardView.dash123:view456.read,write"
```

**Only use `feature update` when changing existing permissions** (e.g. adding a new view, changing privileges):

```bash
fusebase feature update <featureId> --permissions="dashboardView.dash123:view456.read;dashboardView.dash789:viewABC.read,write"
```

### When to Use `feature update` for Permissions

Only use `feature update --permissions` when:

- Feature already exists and needs access to **additional** dashboard views
- Changing from read-only to read-write (or vice versa) on an existing feature
- Restricting access to fewer views on an existing feature

**Do NOT** use `feature update` to set permissions that should have been set at creation time.

## CLI Commands

### Version

```bash
fusebase version   # Print CLI version (from package.json)
fusebase -V        # Same
```

### Initialize a New Project

```bash
fusebase init [options]
```

Options:

- `--name <name>` - App title/name (if not provided, will prompt interactively)
- `--org <orgId>` - Organization ID (skips org selection if provided)
- `--ide <preset>` - IDE preset: `claude-code`, `cursor`, `vscode`, `opencode`, `codex`, or `other` (single choice; generates all supported IDE configs by default)
- `--force` - Overwrite existing IDE config files/folders
- `--git` - After setup, offer to initialize a local Git repository (local only until you add a `git remote` and push)
- Global flag `git-init` also enables the same post-init Git offer automatically (`fusebase config set-flag git-init`)
- Global flag `git-debug-commits` enables strict debug/deploy traceability section in the `git-workflow` skill (deploy preflight, commit-per-fix, SHA/tag references)

This command **always creates a new app** on Fusebase and initializes the project. It will:

- Prompt for organization selection (or use `--org` if provided)
- Create a new app with the specified name
- Generate `fusebase.json` configuration
- Set up the basic project structure with template files

If the current directory is not empty and you decline the confirmation prompt, initialization stops without creating the app or local config.

Examples:

```bash
# Initialize interactively (prompts for all values)
fusebase init

# Initialize with app name specified
fusebase init --name="My App"

# Initialize with all options (fully non-interactive, assumes single org)
fusebase init --name="My App" --org=org_abc123
```

### Local Git (optional)

```bash
fusebase git
```

Runs `git init` in the current directory. This is **local version control only** — nothing is uploaded until you add a remote (e.g. GitHub/GitLab) and `git push`. The CLI also creates or updates **`.gitignore`** with common ignores (`node_modules/`, `dist/`, `.env` files, logs, caches, OS/IDE noise). If Git is missing, the CLI points to the official install page and asks you to run `fusebase git` again afterward.

Use `fusebase init --git` to be **prompted** whether to initialize Git after app setup.

### Development Mode

#### Start the Dev Server

```bash
fusebase dev start [FEATURE_ID_OR_PATH]
```

FEATURE_ID_OR_PATH - id of the feature of relative path to it, for example if a feature is in `features/my-feature`, you can pass `my-feature` or `features/my-feature`.

Starts the development environment:

- **UI Server (port 4173)**: Displays features in iframes for testing
- **API Proxy (port 4174)**: Proxies API requests with authentication

The dev server automatically:

- Injects your API credentials
- Delivers feature tokens to iframes via `postMessage`
- Refreshes tokens when features are selected
- Creates per-session debug logs under the selected feature directory's `logs/dev-<timestamp>/`:
  - `browser-logs.jsonl`
  - `access-logs.jsonl`
  - `backend-logs.jsonl`
  - `frontend-dev-server-logs.jsonl`

When debugging local runtime issues after starting the dev server, load skill **dev-debug-logs**. It explains which file to inspect for browser errors, proxied API traffic, frontend dev server output, and backend output.

#### Create and Configure Feature

```bash
fusebase feature create --name <name> --subdomain <subdomain> --path <path> --dev-command <command> --build-command <command> --output-dir <dir> [options]
```

This command **always creates a new feature** on Fusebase servers and configures its development parameters. All six core options are required.

**Required Options:**

- `--name <name>` - Name for the new feature
- `--subdomain <subdomain>` - Subdomain for the feature (e.g., `my-feature`); the feature is served from the root of this subdomain
- `--path <path>` - Relative path to the feature directory (e.g., `features/my-feature`)
- `--dev-command <command>` - Dev server command (e.g., `npm run dev`)
- `--build-command <command>` - Build command (e.g., `npm run build`)
- `--output-dir <dir>` - Build output directory (e.g., `dist`)

**Optional Options:**

- `--access <principals>` - Set access principals, comma-separated (e.g., `visitor`, `orgRole:member`, `visitor,orgRole:guest`)
- `--permissions <permissions>` - Set dashboard view permissions (format: `dashboardView.dashboardId:viewId.read,write;...`)
- `--backend-dev-command <command>` - Backend dev command (e.g., `npm run dev`). Only if the feature has a `backend/` folder.
- `--backend-build-command <command>` - Backend build command (e.g., `npm run build`). Only if the feature has a `backend/` folder.
- `--backend-start-command <command>` - Backend start command for production (e.g., `npm run start`). Only if the feature has a `backend/` folder.

**Examples:**

```bash
# Create a feature
fusebase feature create --name="Dashboard Widget" --subdomain=dashboard-widget --path=features/dashboard --dev-command="npm run dev" --build-command="npm run build" --output-dir=dist

# Create feature with permissions for specific dashboard views
fusebase feature create --name="Sales Report" --subdomain=sales-report --path=features/sales-report --dev-command="npm run dev" --build-command="npm run build" --output-dir=dist --permissions="dashboardView.dash123:view456.read,write;dashboardView.dash789:viewABC.read"

# Create feature with a backend
fusebase feature create --name="My App" --subdomain=my-app --path=features/my-app --dev-command="npm run dev" --build-command="npm run build" --output-dir=dist --backend-dev-command="npm run dev" --backend-build-command="npm run build" --backend-start-command="npm run start"
```

### Update Feature Settings

```bash
fusebase feature update <featureId> [options]
```

Update settings for an existing feature.

**Options:**

- `--access <principals>` - Set access principals, comma-separated (e.g., `visitor`, `orgRole:member`, `visitor,orgRole:guest`)
- `--permissions <permissions>` - Set dashboard view permissions (format: `dashboardView.dashboardId:viewId.read,write;...`)
- `--sync-gate-permissions` - Analyze Gate SDK calls in the feature's runtime code and sync the detected operations as Gate permissions on the feature. Required before a feature that uses `@fusebase/fusebase-gate-sdk` can be considered fully published.

**Access Principals:**

The `--access` option replaces the entire access principal list. Principals are comma-separated entries of the form `type` or `type:id`:

| Principal      | Example          | Description                                                                                  |
| -------------- | ---------------- | -------------------------------------------------------------------------------------------- |
| `visitor`      | `visitor`        | Any unauthenticated visitor (public access).                                                 |
| `orgRole:<id>` | `orgRole:member` | Org members with the given role. Valid ids: `guest`, `client`, `member`, `manager`, `owner`. |

**Permissions:**
The `--permissions` option specifies which dashboard views the feature can access and with what privileges.

Format: `dashboardView.dashboardId:viewId.privileges` separated by semicolons for multiple views.

- `dashboardView` - The permission type (required prefix)
- `dashboardId` - The dashboard's global ID (UUID)
- `viewId` - The view's global ID (UUID)
- `privileges` - Comma-separated list: `read`, `write`, or `read,write`

**Examples:**

```bash
# Make a feature publicly accessible (visitor = any unauthenticated user)
fusebase feature update аgjg851jguanadi41 --access=visitor

# Allow org members only
fusebase feature update аgjg851jguanadi41 --access=orgRole:member

# Allow multiple roles
fusebase feature update аgjg851jguanadi41 --access=orgRole:member,orgRole:client

# Public + org members
fusebase feature update аgjg851jguanadi41 --access=visitor,orgRole:member

# Remove all access principals (pass empty string), it will allow access for every role in organization, but not for visitors
fusebase feature update аgjg851jguanadi41 --access=""

# Grant read access to a single dashboard view
fusebase feature update аgjg851jguanadi41 --permissions="dashboardView.dashABC:view123.read"

# Grant read/write access to multiple views
fusebase feature update аgjg851jguanadi41 --permissions="dashboardView.dash1:view1.read,write;dashboardView.dash2:view2.read"

# Update both access and permissions
fusebase feature update аgjg851jguanadi41 --access=visitor --permissions="dashboardView.dash1:view1.read"
```

### Update AGENTS.md and Skills

```bash
fusebase skills update
```

Overwrites `AGENTS.md` and the `.claude/skills/` folder in the project with the latest from the Fusebase CLI project template. Use this to refresh agent rules and skill documentation without re-running `fusebase init`. Requires `fusebase.json` in the project root.

### Create or update .env (MCP token)

```bash
fusebase env create
```

Creates or overwrites `.env` with `DASHBOARDS_MCP_TOKEN` and `DASHBOARDS_MCP_URL`. Use after `fusebase init` or when the MCP token has expired. Requires `fusebase.json` (with `orgId`) and `fusebase auth` to be set.

### Configure optional MCP integrations

```bash
fusebase integrations
```

This runs an interactive step to enable/disable optional MCP servers from the CLI integrations catalog and any **custom** HTTP MCP servers listed under `fusebase.json` → `mcpIntegrations.custom`.
`required: true` servers are always enabled when you run this command.

Add a custom MCP by URL (checks reachability with HTTP GET unless `--skip-check`):

```bash
fusebase integrations add <name> --url <url> [--type http] [--token <token>]
fusebase integrations disable <name>   # keep fusebase.json; remove from IDE configs
fusebase integrations enable <name>
fusebase integrations remove <name>    # or: delete
```

During `fusebase init`, only **required** MCP servers (per the catalog, respecting flags) are written to IDE configs; run `fusebase integrations` afterward to add optional servers.

### Create Feature Secrets

```bash
fusebase secret create --feature <featureId> --secret <KEY:description> [--secret ...]
```

Creates secrets (with empty values) for an app feature and prints the URL where you can set the actual values.

**Required Options:**

- `--feature <featureId>` - Feature ID to create secrets for
- `--secret <KEY:description>` - Secret to create. Format: `KEY` or `KEY:description`. **Repeatable** — pass multiple `--secret` flags to create several secrets at once.

**Examples:**

```bash
# Create a single secret
fusebase secret create --feature abc123 --secret "API_KEY:Third-party API key"

# Create multiple secrets at once
fusebase secret create --feature abc123 \
  --secret "API_KEY:Third-party API key" \
  --secret "DB_PASSWORD:Database connection password" \
  --secret "WEBHOOK_SECRET"
```

After creating the secrets, the CLI prints `https://{org-domain}/dashboard/{orgId}/apps/features/{featureId}/secrets` — open that URL to fill in the actual secret values.

<% if (it.scaffold) { %>
### Scaffold a Feature

Scaffold a new feature from a built-in template.

```bash
# List available templates (with descriptions)
fusebase scaffold

# Scaffold a template into a directory
fusebase scaffold --template <templateId> --dir <path>
```

Available templates:

| Template | Description |
|----------|-------------|
| `spa` | React + Vite SPA — scaffolds directly into `<dir>` |
| `backend` | Node.js + Hono backend — scaffolds into `<dir>/backend/` |

**Rules:**
- Errors if any files in the target directory would be overwritten (no partial writes).
- The `backend` template can be scaffolded on top of an existing SPA — only the `backend/` subfolder must be absent.

Then implement the feature. **After the code is complete**, register and start dev — **execute these automatically, do NOT list them as "next steps" for the user**:

```bash
# Register the feature (derive name/subdomain from context)
# add --permissions if dashboard access is needed
fusebase feature create \
  --name="<Feature Name>" \
  --subdomain=<feature-sub> \
  --path=features/<name> \
  --dev-command="npm run dev" \
  --build-command="npm run build" \
  --output-dir=dist

# Start the dev server
fusebase dev start features/<name>
```

<% } %>
### Deploy Features

```bash
fusebase deploy
```

Deploys all features to Fusebase:

1. Installs dependencies and runs lint for each feature (if the feature has a `lint` script in `package.json`)
2. Runs each feature's build command
3. Uploads the built files from `outputDir`
4. Activates the new version on Fusebase

The project template includes ESLint (`npm run lint`) and root `npm run typecheck` (TypeScript across features — catches errors ESLint does not). Run both before saying "Done" so deploy succeeds; see AGENTS.md "Final Gate". Claude Code runs lint and typecheck on Stop via `.claude/settings.json` hooks.

### Remote Logs (Deployed Backends)

Fetch logs from deployed feature backends. **Only applicable to features with a `backend/` folder.** Use this for production issues, NOT for local development (for local dev, see the `dev-debug-logs` skill).

#### Build Logs

```bash
fusebase remote-logs build <featureId>
```

Fetch the build image logs from the most recent deployment. Shows the container image build output.

#### Runtime Logs

```bash
fusebase remote-logs runtime <featureId> [--tail <number>] [--type <console|system>]
```

Fetch runtime logs from the deployed container.

**Options:**

- `--tail <number>` - Number of log lines to fetch (default: 100, max: 300)
- `--type <console|system>` - Log type: `console` for app output, `system` for container system logs (default: `console`)

**Examples:**

```bash
# Get build logs for a feature
fusebase remote-logs build abc123

# Get last 100 runtime console logs
fusebase remote-logs runtime abc123 --tail 100

# Get system logs (container lifecycle events)
fusebase remote-logs runtime abc123 --type system
```

## Creating a New Feature

<% if (it.scaffold) { %>
1. **Scaffold** the feature: `fusebase scaffold --template spa --dir features/my-new-feature` (add `--template backend` for a backend).
<% } else { %>
1. **Create the feature directory** under `features/`:
   ```
   features/
     my-new-feature/
       package.json
       vite.config.ts
       src/
         App.tsx
         main.tsx
   ```
<% } %>
2. **Implement the feature code** — write all source files, components, and logic.

3. **Register and start dev** — **execute these automatically after the code is written; do NOT list them as "next steps" for the user**:

   a. **Run `fusebase feature create`** — include `--permissions` now if the feature needs dashboard access (do not save it for a separate `feature update` step later):

   ```bash
   # Without dashboard access
   fusebase feature create --name="My New Feature" --subdomain=my-new-feature --path=features/my-new-feature --dev-command="npm run dev" --build-command="npm run build" --output-dir=dist

   # With dashboard view permissions (preferred: set at creation)
   fusebase feature create --name="My New Feature" --subdomain=my-new-feature --path=features/my-new-feature --dev-command="npm run dev" --build-command="npm run build" --output-dir=dist --permissions="dashboardView.dash123:view456.read,write"

   # With a backend
   fusebase feature create --name="My New Feature" --subdomain=my-new-feature --path=features/my-new-feature --dev-command="npm run dev" --build-command="npm run build" --output-dir=dist --backend-dev-command="npm run dev" --backend-build-command="npm run build" --backend-start-command="npm run start"
   ```

   This will create the feature on Fusebase and add it to `fusebase.json`

   b. **Run `fusebase dev start`** to test locally

## Updating an Existing Feature

After changing feature code, run `fusebase feature update <featureId>` if any of these need to be updated:

- `--permissions` — dashboard view access added, removed, or modified
- `--access` — access principals (visitor / org roles) changed
- `--sync-gate-permissions` — always include for features using `@fusebase/fusebase-gate-sdk` at runtime

```bash
# Update permissions and sync Gate permissions
fusebase feature update <featureId> --permissions="dashboardView.dash1:view1.read,write" --sync-gate-permissions
```

## Typical Workflow

1. `fusebase auth` - Authenticate (one-time setup)
2. `fusebase init` - Initialize project
<% if (it.scaffold) { %>
3. `fusebase scaffold --template spa --dir features/<name>` - Scaffold feature files (dependencies are installed automatically)
3a. Implement the feature code
4. *(after code is written)* `fusebase feature create --name="Feature Name" --subdomain=feature-name --path=features/feature-name --dev-command="npm run dev" --build-command="npm run build" --output-dir=dist [--permissions="..."]` - Register feature; **include `--permissions` at this step** if the feature needs dashboard access. **Execute automatically — do NOT list as next steps for the user.**
<% } else { %>
3. Implement the feature code under `features/<name>/`
4. *(after code is written)* `fusebase feature create --name="Feature Name" --subdomain=feature-name --path=features/feature-name --dev-command="npm run dev" --build-command="npm run build" --output-dir=dist [--permissions="..."]` - Create and configure feature; **include `--permissions` at this step** if the feature needs dashboard access. **Execute automatically — do NOT list as next steps for the user.**
<% } %>
4a. *(after registering)* `fusebase dev start` - Start dev and test locally. **Execute automatically.**
5. *(if feature settings changed)* `fusebase feature update <featureId> [--permissions="..."] [--sync-gate-permissions]` - Sync updated settings before deploying
6. `fusebase deploy` - Deploy to production
7. `fusebase remote-logs build|runtime <featureId>` - Check logs if deployed app has issues (see `remote-logs` skill for more)

## Troubleshooting

### "Not authenticated" error

Run `fusebase auth` to set your API credentials.

### Feature not showing in dev server

Ensure the feature is:

- Registered via `fusebase feature create` (so it exists in Fusebase and `fusebase.json`)
- Added to `fusebase.json` with correct `id`
- Has a running dev server (the `dev.command` process is up)

### Build fails during deploy

Check that:

- `npm run lint` passes in the feature directory (deploy runs lint before build)
- `npm run typecheck` passes from project root (or fix TypeScript errors from the feature’s `tsc` step — ESLint alone may not report them)
- `build.command` is correct
- `build.outputDir` exists after build
- All dependencies are installed in the feature directory (`npm install --include=dev`)
