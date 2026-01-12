# CLI Flows

## 0. How to Read This

### What is a "Flow"

A **flow** is an end-to-end interactive journey through the CLI, from entry command to completion. Each flow documents:

- The sequence of prompts/questions
- Files written or modified
- API calls made
- Side effects (processes started, tokens generated, etc.)

### Interactive vs Non-Interactive Steps

- **Interactive steps**: Require user input via prompts (only appear in TTY environments)
- **Non-interactive steps**: Automated actions (file writes, API calls, process spawning)
- **Conditional steps**: Only occur based on previous choices or state

### Config Files Affected

- **Global config**: `~/.fusebase/config.json` (user-level, persists across projects)
- **Project config**: `fusebase.json` (project-level, in project root)
- **Environment file**: `.env` (project-level, for MCP tokens)

See [Configuration Files](#appendix-config-file-locations) for details.

---

## 1. Init Flow (Project Bootstrap)

**Entry command**: `fusebase init [--ide <presets>] [--force]`

### What This Creates

**API-side** (source of truth):

- App record in Fusebase API (if creating new app)
- App has unique `appId` and belongs to an `orgId`
- App exists permanently in Fusebase, independent of local project

**Local-side** (workspace):

- `fusebase.json` file linking local project to API-side app
- Project template files (if template used)
- IDE configuration files (if selected)
- `.env` file with MCP token (if template used)

**Key point**: The app exists in Fusebase regardless of local files. `fusebase.json` is a link, not the source of truth.

### Preconditions

- API key must be configured (`fusebase auth` must have been run)
- Current directory must not already have `fusebase.json`
- Must have at least one organization accessible via API key

### Step-by-Step Flow

#### Step 1: Check Directory State

- **Action**: Check if `fusebase.json` exists
- **If exists**: Exit with error "App is already initialized"
- **If not**: Continue

#### Step 2: Check Directory Emptiness

- **Action**: Check if directory is empty (ignores hidden files like `.git`, `.DS_Store`)
- **If empty**: `useTemplate = true` (auto-use template)
- **If not empty**: Prompt user whether to continue

**Prompt** (if directory not empty):

- **Question**: `"Would you still like to continue in the current one?"`
- **Type**: `confirm` (yes/no)
- **Default**: `false`
- **If `No`**: Stop initialization immediately; do not create the app or `fusebase.json`
- **User message after `No`**: `"Initialization of the app has been stopped. Please create an empty folder and try again."`
- **If `Yes`**: Continue with init, but do not copy the project template into the non-empty directory

#### Step 3: IDE Selection (if `useTemplate === true`)

- **Condition**: Only if `useTemplate === true`
- **If `--ide` flag provided**: Parse comma-separated presets (non-interactive)
- **If TTY and no flag**: Prompt user
- **If not TTY and no flag**: Skip (empty set)

**Prompt** (if TTY and no `--ide` flag):

- **Question**: `"Select IDE configurations to set up:"`
- **Type**: `checkbox` (multi-select)
- **Options**:
  - `Cursor - project-level MCP config` → `cursor`
  - `VS Code - project-level MCP config` → `vscode`
  - `Claude Code - project-level .mcp.json` → `claude-code`
  - `Google Antigravity - generates snippet file` → `antigravity`
  - `Claude Desktop - generates snippet file` → `claude-desktop`
  - `JetBrains/WebStorm - setup docs & snippet` → `jetbrains`
  - `Other (Antigravity, WebStorm, Claude Desktop, etc.)` → `other`
- **Validation**: At least one selection required
- **Where stored**: Set of `IdePreset` values

#### Step 4: Load API Key

- **Action**: Read `~/.fusebase/config.json`
- **If missing**: Exit with error "No API key configured. Run 'fusebase auth' first."

#### Step 5: Fetch Organizations

- **Action**: Call `fetchOrgs(apiKey)` via API
- **If error**: Exit with error "Failed to fetch organizations"
- **If empty**: Exit with error "No organizations found"

#### Step 6: Select Organization

- **If only one org**: Auto-select (no prompt)
- **If multiple orgs**: Prompt user

**Prompt** (if multiple organizations):

- **Question**: `"Select an organization:"`
- **Type**: `select` (single choice)
- **Options**: Organization titles from API
- **Where stored**: `selectedOrg` variable

#### Step 7: Fetch Apps

- **Action**: Call `fetchApps(apiKey, orgId)` via API
- **If error**: Exit with error "Failed to fetch apps"

#### Step 8: Select or Create App

- **If no apps exist**: Prompt to create new app
- **If apps exist**: Prompt to select or create

**Prompts** (if no apps exist):

1. **Question**: `"Enter a title for the new app:"`
   - **Type**: `input`
   - **Validation**: Required, non-empty
2. **Question**: `"Enter a subdomain for the app (e.g., my-app):"`
   - **Type**: `input`
   - **Validation**: Required, must match `/^[a-z0-9-]+$/`

**Prompt** (if apps exist):

- **Question**: `"Select an app:"`
- **Type**: `select`
- **Options**: App titles + descriptions, plus `"+ Create new app"`
- **If `"+ Create new app"` selected**: Same prompts as above

**Action** (if creating new app):

- Call `createApp(apiKey, orgId, title, subdomain)` via API
- **Where stored**: `selectedApp` variable (newly created or selected)

#### Step 9: App Name for package.json (if `useTemplate === true`)

- **Condition**: Only if `useTemplate === true`
- **Prompt**: `"Enter the app name for package.json:"`
- **Type**: `input`
- **Default**: `selectedApp.title`
- **Where stored**: `appName` variable (used for template placeholders)

#### Step 10: Copy Project Template (if `useTemplate === true`)

- **Condition**: Only if `useTemplate === true`
- **Action**: Copy/extract project template files
  - **Binary mode**: Extract from embedded `project-template.zip`
  - **Dev mode**: Copy from `project-template/` directory
- **Files created**:
  - All files from `project-template/` directory
  - `features/` directory (created)
- **Note**: `feature-templates/` directory is NOT copied during `fusebase init` - templates are only used when selected during `fusebase feature create`
- **Placeholders replaced**:
  - `package.json`: `{{APP_NAME}}` → sanitized app name
  - `explore-databases.ts`: `{{ORG_ID}}` → selected org ID

#### Step 11: Setup IDE Configs (if `useTemplate === true`)

- **Condition**: Only if `useTemplate === true`
- **Action**: Copy IDE configuration files
- **Always copied**: `scripts/` directory (MCP bridge scripts)
- **Conditionally copied** (based on IDE selection):
  - `cursor`: `.cursor/mcp.json`
  - `vscode`: `.vscode/mcp.json`
  - `claude-code`: `.mcp.json`
  - `opencode`: `opencode.json`
  - `codex`: `.codex/config.toml`
  - `claude-desktop`: `mcp/claude_desktop_config.snippet.json`
  - `jetbrains`: `mcp/jetbrains_mcp_setup.md`, `mcp/jetbrains_mcp_config.snippet.json`
  - `antigravity`: `mcp/antigravity_mcp_setup.md`, `mcp/antigravity_mcp_config.snippet.json`
  - `other`: `mcp_example.json`
- **Force overwrite**: Controlled by `--force` flag
- **Output**: Prints copied/skipped files and setup instructions (for IDEs without project-level MCP, instructions explain how to configure MCP globally in the IDE)

#### Step 12: Create .env File (if `useTemplate === true`)

- **Condition**: Only if `useTemplate === true`
- **Action**: Generate MCP token and create/update `.env`
- **Token generation**: Calls `createDashboardsToken()` API with full org permissions
- **File**: `.env` in project root
- **Content**:
  ```
  DASHBOARDS_MCP_URL=https://dashboards-mcp.{FUSEBASE_HOST}/mcp
  DASHBOARDS_MCP_TOKEN=<generated-token>
  ```
- **Behavior**:
  - If `.env` doesn't exist: Create with MCP vars
  - If `.env` exists but missing MCP vars: Add them (preserve existing vars)
  - If `.env` exists with MCP vars: Skip (unless `--force` used)

#### Step 13: Create fusebase.json

- **Action**: Write `fusebase.json` to project root
- **Content**:
  ```json
  {
    "orgId": "<selected-org-id>",
    "appId": "<selected-app-id>"
  }
  ```

#### Step 14: Install Dependencies (if `useTemplate === true`)

- **Condition**: Only if `useTemplate === true`
- **Action**: Run `npm install` in project directory
- **If error**: Print warning, continue

### Outputs / Side Effects

**Files created**:

- `fusebase.json` (always)
- Project template files (if template used)
- IDE config files (if template used and IDEs selected)
- `.env` (if template used)

**API calls**:

- `fetchOrgs(apiKey)`
- `fetchApps(apiKey, orgId)`
- `createApp(apiKey, orgId, title, subdomain)` (if creating new app)
- `createDashboardsToken(apiKey, request)` (if template used, for MCP token)

**Processes**:

- `npm install` (if template used)

**Console output**:

- Success messages for each step
- Next steps: "Run 'fusebase dev start' to start the development server"

### How to Rerun / Reset

**To rerun init**:

- Delete `fusebase.json` from project root
- Run `fusebase init` again

**To reset completely**:

- Delete `fusebase.json`
- Delete project template files (if used)
- Delete IDE configs (if created)
- Delete `.env` (if created)

---

## 2. Auth Flow (Login / Credentials)

**Entry command**: `fusebase auth [--api-key <apiKey>] [--dev]`

### Preconditions

- None (can be run at any time)

### Step-by-Step Flow

#### Step 1: Check for --dev Flag

- **If `--dev` provided**: Set `process.env.ENV = "dev"`

#### Step 2: Get API Key

- **If `--api-key` option provided**: Use it (non-interactive)
- **If not provided**: Start the OAuth auth flow
- **Extra positional arguments**: Ignored

#### Step 3: Validate API Key

- **If `--api-key` provided**:
  - **Action**: Call `fetchOrgs(apiKey)` via API
- **If `--api-key` not provided**:
  - **Action**: Run OAuth auth flow and persist the returned API key
- **If error**: Exit with error "Invalid API key. See ~/.fusebase/error.log for details."

#### Step 4: Save Config

- **Action**: Write/update `~/.fusebase/config.json`
- **Content**:
  ```json
  {
    "apiKey": "<api-key>",
    "env": "dev" // only if --dev flag used
  }
  ```
- **Directory creation**: Creates `~/.fusebase/` if it doesn't exist

### Outputs / Side Effects

**Files created/modified**:

- `~/.fusebase/config.json` (global config)

**API calls**:

- `fetchOrgs(apiKey)` (validation)

**Console output**:

- `"✓ API key saved successfully"`

### How to Switch Accounts / Orgs

**To switch API key**:

- Run `fusebase auth --api-key=<new-api-key>` (overwrites existing key)

**To switch environment**:

- Run `fusebase auth --api-key=<api-key> --dev` (sets dev environment)
- Or manually edit `~/.fusebase/config.json` → `env` field

**Note**: There is no command to switch organizations. Organization selection happens during `fusebase init` and is stored in `fusebase.json` (project-level). To use a different org, either:

- Edit `fusebase.json` → `orgId` manually
- Or run `fusebase init` in a new directory

### Common Failure Modes

1. **Invalid API key**: API validation fails → Check key is correct
2. **Network error**: API call fails → Check internet connection
3. **Permission denied**: Cannot write to `~/.fusebase/` → Check directory permissions

---

## 3. Dev Start Flow (Run Local Dev)

**Entry command**: `fusebase dev start [feature]`

### Preconditions

- App must be initialized (`fusebase.json` must exist)
- API key must be configured (`fusebase auth` must have been run)
- At least one feature must be configured in `fusebase.json`

### Step-by-Step Flow

#### Step 1: Print Version

- **Action**: Print `"Fusebase CLI v{version}\n"`

#### Step 2: Check fusebase.json

- **Action**: Load `fusebase.json` from project root
- **If missing**: Exit with error "App not initialized. Run 'fusebase init' first."
- **If invalid**: Exit with error "Invalid fusebase.json. Missing orgId or appId."

#### Step 3: Check Features

- **Action**: Check `fusebase.json.features` array
- **If empty or missing**: Exit with error "No features configured in fusebase.json."

#### Step 4: Load API Key

- **Action**: Read `~/.fusebase/config.json`
- **If missing**: Exit with error "No API key configured. Run 'fusebase auth' first."

#### Step 5: Select Feature

- **If `[feature]` argument provided**: Find feature by ID or path
- **If only one feature**: Auto-select (no prompt)
- **If multiple features and no argument**: Prompt user

**Prompt** (if multiple features and no argument):

- **Question**: `"Select a feature to develop:"`
- **Type**: `select` (single choice)
- **Options**: Feature paths/IDs, with `(no dev command)` suffix if missing dev command
- **Where stored**: `selectedFeature` variable

#### Step 6: Install Dependencies

- **Action**: Check for `package.json` in feature directory
- **If exists**: Run `npm install` in feature directory
- **If not exists**: Skip

#### Step 7: Start Feature Dev Server (if `dev.command` configured)

- **Condition**: Only if `selectedFeature.dev?.command` exists
- **Action**: Spawn feature's dev server process
  - Command: `selectedFeature.dev.command`
  - Working directory: Feature path (or project root if no path)
  - Output: Captured from stdout/stderr for URL detection
- **URL detection**: Parses stdout/stderr for dev server URL patterns
- **If detected**: Stores URL in `devUrlState.url`
- **If not configured**: Prints warning, user can enter URL manually in UI

#### Step 8: Start API Proxy Server

- **Action**: Start Bun HTTP server on port 4174 (auto-finds available port)
- **Routes**:
  - `GET /api/features`: Returns features list with dev URLs
  - `* /api/*`: Proxies to Fusebase API with auth headers
- **Port**: Auto-finds available port starting from 4174
- **Output**: `"🚀 Dev API server running at http://localhost:{port}"`

#### Step 9: Start Frontend Dev UI Server

- **Action**: Start frontend server on port 4173 (auto-finds available port)
- **Binary mode**: Serves prebuilt static assets from embedded zip
- **Dev mode**: Uses Vite with HMR
- **Proxy**: Proxies `/api/*` requests to API server
- **Port**: Auto-finds available port starting from 4173
- **Output**: `"🚀 Dev UI server running at http://localhost:{port}"`

#### Step 10: Open Browser

- **Action**: Open browser to `http://localhost:{vite-port}`
- **Platform-specific**:
  - macOS: `open`
  - Windows: `cmd /c start`
  - Linux: `xdg-open`

#### Step 11: Setup Signal Handlers

- **Action**: Register SIGINT/SIGTERM handlers
- **On cleanup**: Kill feature dev server, stop API server, close Vite server, exit

### Required Config

**From `fusebase.json`**:

- `orgId`: Organization ID
- `appId`: App ID
- `features[]`: At least one feature with `id` (and optionally `path`, `dev.command`)

**From `~/.fusebase/config.json`**:

- `apiKey`: API key for authentication

### Interactive Prompts

- **Feature selection** (if multiple features and no argument provided)
  - See Step 5 above

### Health Checks / Verification

**After start, verify**:

1. API proxy server is running: Check console for `"🚀 Dev API server running at http://localhost:{port}"`
2. Frontend UI server is running: Check console for `"🚀 Dev UI server running at http://localhost:{port}"`
3. Browser opened: Should see dev UI at `http://localhost:{vite-port}`
4. Feature dev server (if configured): Check console for dev server output and URL detection
5. Feature token delivery: Check browser console for `postMessage` with `type: 'featuretoken'`

**Common issues**:

- Port conflicts: Servers auto-find available ports, but if issues persist, kill processes on 4173/4174
- Feature token not received: Ensure feature iframe listens for `postMessage`
- Dev URL not detected: Manually enter URL in dev UI

---

## 4. Feature Configuration Flow

**Entry command**: `fusebase feature create [--path <path>]`

### Preconditions

- App must be initialized (`fusebase.json` must exist)
- API key must be configured (`fusebase auth` must have been run)

### Step-by-Step Flow

#### Step 1: Check fusebase.json

- **Action**: Load `fusebase.json` from project root
- **If missing**: Exit with error "App not initialized. Run 'fusebase init' first."
- **If invalid**: Exit with error "Invalid fusebase.json. Missing orgId or appId."

#### Step 2: Load API Key

- **Action**: Read `~/.fusebase/config.json`
- **If missing**: Exit with error "No API key configured. Run 'fusebase auth' first."

#### Step 3: Fetch Features

- **Action**: Call `fetchAppFeatures(apiKey, orgId, appId)` via API
- **If error**: Exit with error "Failed to fetch app features."

#### Step 4: Select or Create Feature

- **If no features exist**: Prompt to create new feature
- **If features exist**: Prompt to select or create

**Prompts** (if no features exist):

1. **Question**: `"Enter a title for the new feature:"`
   - **Type**: `input`
   - **Validation**: Required, non-empty
2. **Question**: `"Enter a path for the feature (e.g., dashboard):"`
   - **Type**: `input`
   - **Validation**: Required, non-empty

**Prompt** (if features exist):

- **Question**: `"Select a feature to develop:"`
- **Type**: `select`
- **Options**: Feature titles + descriptions, plus `"+ Create new feature"`
- **If `"+ Create new feature"` selected**: Same prompts as above

**Action** (if creating new feature):

- Call `createAppFeature(apiKey, orgId, appId, title, path)` via API
- **Where stored**: `selectedFeature` variable

#### Step 5: Template Selection (if creating new feature)

- **Prompt**: `"Choose how to create the feature:"`
- **Type**: `select`
- **Options**: Available templates (from `feature-templates/` directory) + "From scratch (manual setup)"
- **If template selected**:
  - Generate default path: `features/{pathFriendlyName}` (from feature URL path)
  - Copy template files to feature directory
  - Replace template variables (e.g., `{{FEATURE_NAME}}`)
  - Auto-detect dev/build commands from template's `package.json`

#### Step 6: Get Feature Path

- **If `--path` flag provided**: Use it (convert to relative path)
- **If not provided**: Prompt user

**Prompt** (if `--path` not provided):

- **If `features/` directory exists with subdirectories**:
  - **Question**: `"Select feature folder:"`
  - **Type**: `select`
  - **Options**: Detected folders in `features/`, `"Enter path manually"`, `"Skip (leave empty)"`
  - **Default**: Existing path from config (if exists), else first detected folder
  - **If `"Enter path manually"` selected**: Prompt for manual input
- **If no folders detected**:
  - **Question**: `"Enter the feature path (relative to current directory, leave empty to skip):"`
  - **Type**: `input`
  - **Default**: Existing path from config (if exists)

#### Step 7: Detect/Get Dev Command

- **Action**: Try to detect from `package.json` in feature directory
  - Reads `package.json` and detects framework (Vite, Next.js, React, etc.)
  - Returns detected command or `null`
- **If detected**: Use detected command (prints "Detected {framework} project")
- **If not detected**: Prompt user

**Prompt** (if not detected):

- **Question**: `"Enter the dev command:"`
- **Type**: `input`
- **Default**: Existing command from config (if exists)

#### Step 8: Detect/Get Build Command

- **Action**: Try to detect from `package.json` in feature directory
- **If detected**: Use detected command
- **If not detected**: Prompt user

**Prompt** (if not detected):

- **Question**: `"Enter the build command:"`
- **Type**: `input`
- **Default**: Existing command from config (if exists)

#### Step 9: Detect/Get Build Output Directory

- **Action**: Try to detect from `package.json` in feature directory
- **If detected**: Use detected output directory
- **If not detected**: Prompt user

**Prompt** (if not detected):

- **Question**: `"Enter the build output directory:"`
- **Type**: `input`
- **Default**: Existing output dir from config (if exists), else `"dist"`

#### Step 10: Update fusebase.json

- **Action**: Update `fusebase.json` with feature configuration
- **Content added/updated**:
  ```json
  {
    "features": [
      {
        "id": "<feature-id>",
        "path": "<feature-path>", // if provided
        "dev": {
          "command": "<dev-command>" // if provided
        },
        "build": {
          "command": "<build-command>", // if provided
          "outputDir": "<output-dir>" // if provided
        }
      }
    ]
  }
  ```
- **Behavior**: Updates existing feature config if `id` matches, otherwise appends

### Outputs / Side Effects

**Files created/modified**:

- `fusebase.json` (updated with feature config)

**API calls**:

- `fetchAppFeatures(apiKey, orgId, appId)`
- `createAppFeature(apiKey, orgId, appId, title, path)` (if creating new feature)

**Console output**:

- `"✓ Development mode configured"`
- Feature details (path, dev command, build command, output dir)

### How Feature Selection Works

- Features are fetched from API (not just from `fusebase.json`)
- User can select existing feature or create new one
- Selected feature is then configured with local paths and commands
- Configuration is stored in `fusebase.json` → `features[]` array

### What is Generated/Scaffolded

- **If template selected**: Template files are copied to feature directory (e.g., `features/{url-path}/`)
  - Template files include: `package.json`, `vite.config.ts`, `src/`, etc.
  - Template variables are replaced (e.g., `{{FEATURE_NAME}}`)
  - Dev/build commands are auto-detected from template's `package.json`
- **If "From scratch" selected**: No files are scaffolded
  - Local feature code must exist before running this command (or be created separately)

### Understanding Feature Records vs Feature Code

**Feature Record** (API-side):

- Created via `createAppFeature()` API call
- Has: `id`, `title`, `path` (URL segment), `description`
- Exists permanently in Fusebase
- Source of truth for feature metadata

**Feature Code** (local):

- Lives in `features/{name}/` directory
- Written by developer (React/Vite app)
- Configured in `fusebase.json` with:
  - `id`: Must match API-side feature ID
  - `path`: Local directory path (e.g., `"features/widget"`)
  - `dev.command`: How to run locally
  - `build.command`: How to build for deployment

**The relationship**:

- Feature record (API) and feature code (local) are separate
- `fusebase.json` links them via the `id` field
- Deployment uploads built code to create a new version of the feature record

---

## 5. Deploy Flow

**Entry command**: `fusebase deploy`

### Preconditions

- App must be initialized (`fusebase.json` must exist)
- API key must be configured (`fusebase auth` must have been run)
- At least one feature must have a `path` configured in `fusebase.json`

### Step-by-Step Flow

#### Step 1: Check fusebase.json

- **Action**: Load `fusebase.json` from project root
- **If missing**: Exit with error "App not initialized. Run 'fusebase init' first."
- **If invalid**: Exit with error "Invalid fusebase.json. Missing orgId or appId."

#### Step 2: Load API Key

- **Action**: Read `~/.fusebase/config.json`
- **If missing**: Exit with error "No API key configured. Run 'fusebase auth' first."

#### Step 3: Find Deployable Features

- **Action**: Filter `fusebase.json.features[]` for features with `path` configured
- **If none**: Exit with error "No features with path configured in fusebase.json."

#### Step 4: Fetch App and Features

- **Action**: Call `fetchApp(apiKey, orgId, appId)` and `fetchAppFeatures(apiKey, orgId, appId)` via API
- **If error**: Exit with error "Failed to fetch app or features from API."

#### Step 5: Deploy Each Feature

For each deployable feature:

1. **Check Path Exists**
   - Verify feature path directory exists
   - **If not**: Error, skip feature

2. **Install Dependencies** (if `package.json` exists)
   - Run `npm install` in feature directory
   - **If error**: Error, skip feature

3. **Run Build Command** (if `build.command` configured)
   - Run build command in feature directory
   - **If error**: Error, skip feature

4. **Determine Upload Directory**
   - If `build.outputDir` configured: `{feature.path}/{build.outputDir}`
   - Otherwise: `{feature.path}`
   - Verify directory exists
   - **If not**: Error, skip feature

5. **Collect Files**
   - Recursively collect all files from upload directory
   - **If empty**: Error, skip feature

6. **Create Feature Version**
   - Call `createAppFeatureVersion(apiKey, orgId, appId, featureId)` via API
   - Returns version ID

7. **Initialize Upload**
   - Call `initUpload(apiKey, orgId, appId, featureId, versionId, files)` via API
   - Returns signed upload URLs for each file

8. **Upload Files**
   - Upload files in parallel (5 concurrent uploads)
   - Show progress bar with bytes and file count
   - **If error**: Error, skip feature

9. **Build Feature URL**
   - Format: `https://{app.sub}.{domain}/{feature.path}`
   - Domain: `dev-thefusebase-app.com` (if dev env) or `thefusebase.app` (prod)

### Required Inputs

**From `fusebase.json`**:

- `orgId`: Organization ID
- `appId`: App ID
- `features[]`: At least one feature with `path` configured

**From `~/.fusebase/config.json`**:

- `apiKey`: API key for authentication

**From feature directory**:

- Feature code files (in `path` or `path/{outputDir}`)

### Interactive Confirmations

**None**: This flow is fully automated with no prompts.

### What Artifacts are Built

**Build artifacts** (if `build.command` configured):

- Output directory: `{feature.path}/{build.outputDir}` (or `{feature.path}` if no `outputDir`)
- All files in output directory are uploaded

**Deployment artifacts**:

- New feature version created in Fusebase
- Files uploaded to S3
- Feature accessible at: `https://{app.sub}.{domain}/{feature.path}`

### Rollback Notes

**No rollback command exists**. To rollback:

- Deploy a previous version manually (not supported by CLI)
- Or edit feature code and redeploy

---

## 6. MCP Preconfiguration Flow

**When it happens**: During `fusebase init`, if project template is used.

### Step-by-Step Flow

#### Step 1: Check if Template is Used

- **Condition**: Only if `useTemplate === true` (from init flow)

#### Step 2: Generate MCP Token

- **Action**: Call `createDashboardsToken(apiKey, request)` via API
- **Token permissions**: Broad MCP discovery/development scope for the organization:
  - `database.read`, `database.write`, `database.delete`
  - `dashboard.read`, `dashboard.write`, `dashboard.delete`
  - `template.read`, `template.write`
  - `view.read`, `view.write`, `view.delete`
  - `data.read`, `data.write`
  - `relation.read`, `relation.write`
  - `token.read`, `token.write`, `token.delete`
  - `column.*.read`, `column.*.write`
- **Resource scope**: All databases, dashboards, views (`*`)
- **Token name**: `"MCP Token (generated by CLI)"`

This token is for MCP/development usage only. It is separate from runtime feature permissions and separate from feature tokens used by deployed or locally served features.

#### Step 3: Create/Update .env File

- **File**: `.env` in project root
- **Content**:
  ```
  DASHBOARDS_MCP_URL=https://dashboards-mcp.{FUSEBASE_HOST}/mcp
  DASHBOARDS_MCP_TOKEN=<generated-token>
  ```
- **Behavior**:
  - If `.env` doesn't exist: Create with MCP vars
  - If `.env` exists but missing MCP vars: Add them (preserve existing vars)
  - If `.env` exists with MCP vars: Skip (unless `--force` used in init)

### What is Configured

**Environment variables**:

- `DASHBOARDS_MCP_URL`: MCP server URL (hardcoded to dev URL)
- `DASHBOARDS_MCP_TOKEN`: Generated MCP token for discovery/development

**IDE configuration files** (if IDE selection made during init):

- See [Init Flow - Step 11](#step-11-setup-ide-configs-if-usetemplate--true) for details

### MCP Verification (Important)

apps-cli **does not automatically validate MCP connectivity**.

After MCP variables are configured:

- `DASHBOARDS_MCP_URL`
- `DASHBOARDS_MCP_TOKEN`

The following must be true:

- MCP server is reachable
- Token is valid
- `tools_list` returns available tools

**How to verify MCP manually**:

1. Check `.env` file contains `DASHBOARDS_MCP_URL` and `DASHBOARDS_MCP_TOKEN`
2. Use MCP client (via IDE or CLI) to call `tools_list`
3. If tools are returned, MCP is working
4. If connection fails, check:
   - MCP server URL is correct
   - Token is valid and not expired
   - Network connectivity to MCP server

**What happens if MCP is unavailable**:

- Feature code using SDK may fail at runtime
- LLM-assisted development cannot discover capabilities
- Manual API knowledge required (not recommended)

**Future CLI versions may add**:

- MCP health checks
- Explicit "verify MCP connection" step
- Automatic token refresh

For now, MCP availability is assumed during runtime.

### What CLI Does NOT Do Yet

**Explicit limitations**:

- **No MCP server management**: CLI does not start/stop MCP servers
- **No MCP health checks**: CLI does not verify MCP server connectivity
- **No token refresh**: CLI does not automatically refresh expired tokens
- **No MCP command**: There is no `fusebase mcp` command for MCP-specific operations
- **No token rotation**: CLI does not rotate or revoke tokens
- **Hardcoded URL**: MCP URL is hardcoded to dev environment (`{FUSEBASE_HOST}`)

**Manual steps required**:

- For Claude Desktop: User must manually copy snippet to config file
- For JetBrains: User must follow setup instructions in generated markdown file

---

## 7. Non-Interactive / CI Mode

### How to Run Without Prompts

#### Auth Flow

```bash
# Provide API key as argument
fusebase auth --api-key=$API_KEY

# With dev environment
fusebase auth --api-key=$API_KEY --dev
```

#### Init Flow

```bash
# Skip IDE setup (empty set)
fusebase init --ide ""

# Configure specific IDEs
fusebase init --ide "cursor,vscode"

# Force overwrite existing configs
fusebase init --ide "cursor" --force
```

**Note**: Organization and app selection still require API access. If only one org/app exists, they are auto-selected. Otherwise, init will fail in non-TTY environments.

#### Dev Feature Flow

```bash
# Skip path prompt
fusebase feature create --path features/my-feature
```

**Note**: Other prompts (feature selection, dev command, build command, output dir) will still appear if not auto-detected.

#### Dev Start Flow

```bash
# Skip feature selection prompt
fusebase dev start my-feature-id
# or
fusebase dev start features/dashboard
```

#### Deploy Flow

```bash
# Fully automated, no prompts
fusebase deploy
```

### Precedence Rules for Config Sources

**Environment resolution** (from `lib/config.ts` → `getEnv()`):

1. `~/.fusebase/config.json` → `env` field
2. `fusebase.json` → `env` field
3. `process.env.ENV`

**API URL resolution** (from `lib/api.ts` → `getBaseUrl()` returns public API base URL string):

- `env === "dev"` → `https://public-api.dev-thefusebase.com`
- `env === "prod"` → `https://public-api.thefusebase.com`
- `env === "local"` → `http://localhost:3000`

### Recommended Minimal Environment Variables

**For CI/CD pipelines**:

```bash
# Required
export FUSEBASE_API_KEY="your-api-key"

# Optional (if using dev environment)
export ENV="dev"
```

**Usage in CI**:

```bash
# Set API key
fusebase auth --api-key=$FUSEBASE_API_KEY

# Initialize (if needed, with minimal setup)
fusebase init --ide ""

# Deploy
fusebase deploy
```

**Note**: `fusebase init` may still fail in CI if multiple orgs/apps exist (requires interactive selection). Consider:

- Using an API key that only has access to one org/app
- Or pre-creating `fusebase.json` with correct `orgId` and `appId`

---

## Appendix

### Config File Locations

| File             | Location                       | Purpose                                       | Written By                                 |
| ---------------- | ------------------------------ | --------------------------------------------- | ------------------------------------------ |
| Global config    | `~/.fusebase/config.json`      | User-level API key and environment            | `fusebase auth`                            |
| Project config   | `fusebase.json` (project root) | Project-level org/app IDs and feature configs | `fusebase init`, `fusebase feature create` |
| Environment file | `.env` (project root)          | MCP token and URL for local development       | `fusebase init` (if template used)         |
| Error log        | `~/.fusebase/error.log`        | Detailed error logs (Pino JSON format)        | All commands (via logger)                  |

### Troubleshooting Table

| Symptom                            | Probable Cause                                   | Fix                                                              |
| ---------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| "App not initialized"              | `fusebase.json` missing                          | Run `fusebase init`                                              |
| "No API key configured"            | `~/.fusebase/config.json` missing or invalid     | Run `fusebase auth --api-key=<api-key>`                          |
| "No features configured"           | `fusebase.json.features[]` empty                 | Run `fusebase feature create`                                    |
| "Invalid API key"                  | API key validation failed                        | Check API key is correct, run `fusebase auth` again              |
| "Failed to fetch organizations"    | Network error or invalid API key                 | Check internet connection and API key                            |
| Port conflicts (dev server)        | Ports 4173/4174 in use                           | Kill processes on those ports, servers auto-find available ports |
| Feature token not received         | Iframe not listening for `postMessage`           | Ensure feature code listens for `type: 'featuretoken'` messages  |
| Dev URL not detected               | Dev server output doesn't match patterns         | Manually enter URL in dev UI                                     |
| "No features with path configured" | Features in `fusebase.json` missing `path` field | Run `fusebase feature create` to configure paths                 |
| Build fails on deploy              | Build command or output directory incorrect      | Check `fusebase.json` → `features[]` → `build` config            |
| MCP token not generated            | Template not used during init                    | Re-run `fusebase init` with template, or manually create `.env`  |

### Links

- **Command Reference**: [CLI Commands & Interactive Prompts](CLI.md)
- **Architecture**: [Architecture Documentation](ARCHITECTURE.md)
- **Conceptual Model**: [Apps, Features, and Data Access](CONCEPTS.md)
