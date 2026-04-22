# CLI Commands & Interactive Prompts

## 1. Overview

**Fusebase Apps CLI** (`fusebase`) is a command-line tool for managing Fusebase applications. It provides commands for authentication, project initialization, feature configuration, development, and deployment.

### Typical Usage Scenarios

1. **Initial Setup**: Authenticate → Initialize app → Configure features
2. **Development**: Start dev server → Develop features locally
3. **Deployment**: Build features → Deploy to Fusebase

### Interactive Mode vs Flags

Most commands support both interactive and non-interactive modes:

- **Interactive mode**: Prompts appear when running in a TTY (terminal) and required information is missing
- **Non-interactive mode**: Use flags/options to provide all required values (useful for CI/CD)

Commands automatically detect TTY availability (`process.stdin.isTTY`) and skip prompts when not available, unless explicitly overridden.

## 2. Global CLI Structure

### Command Entrypoint

```bash
fusebase <command> [options] [arguments]
```

The CLI is invoked via the `fusebase` command (or `bun index.ts` in development).

### Global Flags

No global flags are currently defined. Each command has its own options.

### Help & Version

```bash
fusebase --help          # Show help for all commands
fusebase <command> --help # Show help for specific command
fusebase --version       # Show CLI version (from package.json)
fusebase version         # Same: print version
```

## 3. Commands Reference

### `fusebase version`

**Purpose**: Print the CLI version (from `package.json`).

**Syntax**:

```bash
fusebase version
```

**Example**:

```bash
fusebase version   # e.g. 0.1.0
```

### `fusebase auth [--api-key <apiKey>]`

**Purpose**: Set the API key for authentication with the Fusebase API.

**Syntax**:

```bash
fusebase auth [--api-key <apiKey>] [--dev]
```

**Options**:

- `--api-key <apiKey>`: The API key to store. If not provided, starts the OAuth auth flow.
- `--dev`: Use the dev environment (sets `env: "dev"` in config).

**Behavior**:

- If `--api-key` is not provided, starts the OAuth auth flow
- Extra positional arguments are ignored
- If `--api-key` is provided, validates it by calling `fetchOrgs(apiKey)`
- Saves to `~/.fusebase/config.json`:
  ```json
  {
    "apiKey": "your-api-key",
    "env": "dev" // if --dev flag used
  }
  ```
- Exits with error if API key is invalid

**Examples**:

```bash
# Interactive mode
fusebase auth

# Direct mode
fusebase auth --api-key=your-api-key-here

# Use dev environment
fusebase auth --api-key=your-api-key --dev
```

---

### `fusebase init`

**Purpose**: Initialize a new Fusebase app in the current directory.

**Syntax**:

```bash
fusebase init [--ide <presets>] [--force]
```

**Options**:

- `--ide <presets>`: Comma-separated IDE presets to configure (e.g., `cursor,vscode`). Available: `cursor`, `vscode`, `claude-code`, `claude-desktop`, `jetbrains`, `antigravity`, `other`
- `--force`: Overwrite existing IDE config files/folders

**Prerequisites**:

- API key must be configured (`fusebase auth`)
- Directory must not already have `fusebase.json`

**Interactive Prompts**:

1. **Continue In Current Folder** (if directory is not empty):
   - Prompt: `"Would you still like to continue in the current one?"`
   - Type: `confirm` (yes/no)
   - Default: `false`
   - When: Only if directory contains visible files (ignores hidden files like `.git`)
   - If declined: initialization stops before creating the app or writing `fusebase.json`

2. **IDE Selection** (if using template and `--ide` not provided):
   - Prompt: `"Select IDE configuration to set up:"`
   - Type: `select` (single choice)
   - Options:
     - `Claude Code - repo root .mcp.json`
     - `Cursor - project-level MCP config`
     - `VS Code - workspace MCP config`
     - `Other (Antigravity, WebStorm, Claude Desktop, etc.) - scripts + mcp_example.json`
   - When: Only if `useTemplate` is true and running in TTY

3. **Organization Selection**:
   - Prompt: `"Select an organization:"`
   - Type: `select` (single choice)
   - Options: Fetched from API (organization titles)
   - Auto-select: If only one organization exists
   - When: Always (unless only one org)

4. **App Selection**:
   - If no apps exist:
     - Prompt: `"Enter a title for the new app:"`
     - Type: `input`
     - Validation: Required, non-empty
     - Then: `"Enter a subdomain for the app (e.g., my-app):"`
     - Validation: Required, must match `/^[a-z0-9-]+$/`
   - If apps exist:
     - Prompt: `"Select an app:"`
     - Type: `select`
     - Options: App titles + descriptions, plus `"+ Create new app"`
     - If creating new: Same prompts as above

5. **App Name for package.json** (if using template):
   - Prompt: `"Enter the app name for package.json:"`
   - Type: `input`
   - Default: Selected app's title
   - When: Only if `useTemplate` is true

**Output**:

- Creates `fusebase.json`:
  ```json
  {
    "orgId": "organization-id",
    "appId": "app-id"
  }
  ```
- If using template:
  - Copies project template files
  - Sets up IDE configs (if selected)
  - Creates `.env` file with MCP token (if template used)
  - Runs `npm install --include=dev` in project directory (so devDependencies like vite/ts are installed even if NODE_ENV=production)

**Examples**:

```bash
# Interactive mode
fusebase init

# Non-interactive (skip IDE setup)
fusebase init --ide ""

# Configure specific IDEs
fusebase init --ide "cursor,vscode"

# Force overwrite existing IDE configs
fusebase init --ide "cursor" --force
```

---

### `fusebase deploy`

**Purpose**: Deploy features to Fusebase.

**Syntax**:

```bash
fusebase deploy
```

**Options**: None

**Prerequisites**:

- App must be initialized (`fusebase init`)
- API key must be configured (`fusebase auth`)
- At least one feature must have a `path` configured in `fusebase.json`

**Interactive Prompts**: None (fully automated)

**Behavior**:

1. Reads `fusebase.json` to get features with `path` configured
2. For each feature:
   - Runs `npm install --include=dev` if `package.json` exists in feature directory
   - Runs build command (if `build.command` configured)
   - Creates new feature version via API
   - Initializes upload and gets signed URLs
   - Uploads all files from output directory (or feature path if no `build.outputDir`)
   - Shows progress bar with file count and bytes
3. Prints deployment summary with version IDs and URLs

**Output**:

- Creates new feature versions in Fusebase
- Uploads files to S3
- Prints summary:
  ```
  ✓ Successful deployments:
    • feature-id
      Version ID: version-id
      URL: https://app-sub.thefusebase.app/feature-path
  ```

**Examples**:

```bash
fusebase deploy
```

---

### `fusebase feature create`

**Purpose**: Create and configure a feature for development. All options are required.

**Syntax**:

```bash
fusebase feature create --name <name> --subdomain <subdomain> --path <path> --dev-command <command> --build-command <command> --output-dir <dir> [options]
```

**Required Options**:

- `--name <name>`: Feature title
- `--subdomain <subdomain>`: Subdomain for the feature (e.g., `my-feature`); feature is served from the root of this subdomain
- `--path <path>`: Path to the feature folder (e.g., `features/product-add`)
- `--dev-command <command>`: Dev server command (e.g., `npm run dev`)
- `--build-command <command>`: Build command (e.g., `npm run build`)
- `--output-dir <dir>`: Build output directory (e.g., `dist`)

**Optional Options**:

- `--access <principals>`: Set access principals, comma-separated (e.g., `visitor`, `orgRole:member`)
- `--permissions <permissions>`: Set manual resource permissions (format: `dashboardView.dashboardId:viewId.read,write;database.id:databaseId.read`)

**Prerequisites**:

- App must be initialized (`fusebase init`)
- API key must be configured (`fusebase auth`)

**Output**:

- Creates feature record in Fusebase API
- Updates `fusebase.json` with feature configuration:
  ```json
  {
    "features": [
      {
        "id": "feature-id",
        "path": "features/my-feature",
        "dev": {
          "command": "npm run dev"
        },
        "build": {
          "command": "npm run build",
          "outputDir": "dist"
        }
      }
    ]
  }
  ```

**Examples**:

```bash
fusebase feature create --name="Dashboard" --subdomain=dashboard --path=features/dashboard --dev-command="npm run dev" --build-command="npm run build" --output-dir=dist

fusebase feature create --name="Sales Report" --subdomain=sales-report --path=features/sales-report --dev-command="npm run dev" --build-command="npm run build" --output-dir=dist --permissions="dashboardView.dash123:view456.read,write"
```

**Important**:

- `fusebase deploy` publishes code only; it does not publish feature permissions
- runtime permissions are stored on the remote feature record
- use `fusebase feature update <featureId>` to change permissions after creation
- if the feature uses Gate SDK at runtime, run `fusebase feature update <featureId> --sync-gate-permissions`

See [PERMISSIONS.md](PERMISSIONS.md) for the canonical permission workflow.

---

### `fusebase dev start [feature]`

**Purpose**: Start the development server for a feature.

**Syntax**:

```bash
fusebase dev start [feature]
```

**Arguments**:

- `[feature]` (optional): Feature ID or path (from `fusebase.json` features). If not provided, prompts to select.

**Options**: None

**Prerequisites**:

- App must be initialized (`fusebase init`)
- API key must be configured (`fusebase auth`)
- At least one feature must be configured in `fusebase.json`

**Interactive Prompts**:

1. **Feature Selection** (if `[feature]` not provided and multiple features exist):
   - Prompt: `"Select a feature to develop:"`
   - Type: `select`
   - Options: Feature paths/IDs, with `(no dev command)` suffix if missing dev command
   - Auto-select: If only one feature exists

**Behavior**:

1. Selects feature (via argument, auto-select, or prompt)
2. Runs `npm install --include=dev` if `package.json` exists in feature directory
3. Starts feature's dev server (if `dev.command` configured) and detects URL from stdout/stderr
4. Starts API proxy server (port 4174, auto-finds available port)
5. Starts frontend dev UI server (port 4173, auto-finds available port)
6. Opens browser to dev UI
7. Handles SIGINT/SIGTERM to cleanly shutdown all servers

**Output**:

- Prints CLI version
- Shows selected feature
- Shows detected dev server URL (if auto-detected)
- Opens browser to `http://localhost:{vite-port}`

**Examples**:

```bash
# Interactive feature selection
fusebase dev start

# Start specific feature by ID
fusebase dev start my-feature-id

# Start specific feature by path
fusebase dev start features/dashboard
```

---

## 4. Interactive Prompts

### IDE Selection

**When it appears**: During `fusebase init`, if:

- Project template is being used (`useTemplate === true`)
- `--ide` flag is not provided
- Running in TTY (`process.stdin.isTTY === true`)

**Prompt details**:

- Type: `checkbox` (multi-select)
- Message: `"Select IDE configurations to set up:"`
- Options:
  - `Cursor - project-level MCP config` → Creates `.cursor/mcp.json`
  - `VS Code - workspace MCP config` → Creates `.vscode/mcp.json`
  - `Claude Code - repo root .mcp.json` → Creates `.mcp.json`
  - `Claude Desktop - generates snippet file` → Creates `mcp/claude_desktop_config.snippet.json`
  - `JetBrains/WebStorm - setup docs & snippet` → Creates `mcp/jetbrains_mcp_setup.md` and `mcp/jetbrains_mcp_config.snippet.json`
  - `Google Antigravity - global config (~/.gemini/antigravity/)` → Creates `mcp/antigravity_mcp_setup.md` and `mcp/antigravity_mcp_config.snippet.json`
  - `Other (Antigravity, WebStorm, Claude Desktop, etc.)` → Creates `mcp_example.json` and `scripts/`
- Validation: At least one selection required
- Default: None (user must select)

**Where choice is stored**: IDE config files are copied to project directory. No persistent config file stores the selection.

**Non-interactive bypass**: Use `--ide <presets>` flag:

```bash
fusebase init --ide "cursor,vscode"
```

---

### MCP Preconfiguration

**When it appears**: During `fusebase init`, if project template is used.

**What it configures**:

- Creates `.env` file with:
  - `DASHBOARDS_MCP_URL=https://dashboards-mcp.{FUSEBASE_HOST}/mcp`
  - `DASHBOARDS_MCP_TOKEN=<generated-token>`
- Token is generated via API with full permissions for the organization scope

**Behavior**:

- If `.env` doesn't exist: Creates it with MCP vars
- If `.env` exists but missing MCP vars: Adds them (preserves existing vars)
- If `.env` exists with MCP vars: Skips (unless `--force` used)

**How to skip**: Not directly skippable, but can be bypassed by:

- Not using project template (answer "no" to template prompt)
- Run `fusebase env create` to refresh MCP token if needed

**Note**: There is no `fusebase mcp doctor` command currently. MCP setup is only done during `fusebase init`.

---

### Organization Selection

**When it appears**: During `fusebase init`, if multiple organizations exist.

**Prompt details**:

- Type: `select` (single choice)
- Message: `"Select an organization:"`
- Options: Organization titles fetched from API
- Auto-select: If only one organization exists (no prompt)

**Where choice is stored**: `fusebase.json` → `orgId`

---

### App Selection

**When it appears**: During `fusebase init`, after organization is selected.

**Prompt details**:

- If no apps exist:
  - Prompt: `"Enter a title for the new app:"`
  - Type: `input`
  - Validation: Required, non-empty
  - Then: `"Enter a subdomain for the app (e.g., my-app):"`
  - Type: `input`
  - Validation: Required, must match `/^[a-z0-9-]+$/`
- If apps exist:
  - Prompt: `"Select an app:"`
  - Type: `select`
  - Options: App titles + descriptions, plus `"+ Create new app"`
  - If `"+ Create new app"` selected: Same prompts as above

**Where choice is stored**: `fusebase.json` → `appId` (or creates new app via API)

---

### Feature Selection

**When it appears**:

- During `fusebase feature create`: If multiple features exist or no features exist
- During `fusebase dev start`: If multiple features exist and no argument provided

**Prompt details**:

- Type: `select` (single choice)
- Message: `"Select a feature to develop:"` or `"Select a feature to develop:"`
- Options: Feature titles + descriptions, plus `"+ Create new feature"` (in `fusebase feature create`)
- Auto-select: If only one feature exists (in `fusebase dev start`)

**Where choice is stored**:

- `fusebase feature create`: Updates `fusebase.json` → `features[]`
- `fusebase dev start`: No persistent storage (temporary selection)

---

### Confirmation Prompts

**Continue In Current Folder**:

- When: During `fusebase init`, if directory is not empty
- Type: `confirm` (yes/no)
- Message: `"Would you still like to continue in the current one?"`
- Default: `false`
- If `Yes`: continue initialization without copying the project template into the non-empty directory
- If `No`: initialization stops immediately
- Message: `"Initialization of the app has been stopped. Please create an empty folder and try again."`
- Result: no app is created and no local config is written

---

## 5. Configuration Files

### Global Config: `~/.fusebase/config.json`

**Location**: `~/.fusebase/config.json` (cross-platform via `os.homedir()`)

**Structure**:

```json
{
  "apiKey": "your-api-key",
  "env": "dev" // optional, set by --dev flag
}
```

**Written by**:

- `fusebase auth` command

**Read by**:

- All commands that need API authentication

---

### Project Config: `fusebase.json`

**Location**: Project root directory

**Structure**:

```json
{
  "env": "dev", // optional, overrides global env
  "orgId": "organization-id",
  "appId": "app-id",
  "features": [
    {
      "id": "feature-uuid",
      "path": "features/my-feature",
      "dev": {
        "command": "npm run dev"
      },
      "build": {
        "command": "npm run build",
        "outputDir": "dist"
      }
    }
  ]
}
```

**Written by**:

- `fusebase init`: Creates file with `orgId` and `appId`
- `fusebase feature create`: Updates `features[]` array

**Read by**:

- `fusebase deploy`: Reads features with `path` configured
- `fusebase dev start`: Reads features list
- `fusebase feature create`: Reads existing feature configs

---

### Environment File: `.env`

**Location**: Project root directory

**Structure**:

```
DASHBOARDS_MCP_URL=https://dashboards-mcp.{FUSEBASE_HOST}/mcp
DASHBOARDS_MCP_TOKEN=generated-token-here
```

**Written by**:

- `fusebase init` (if project template used)

**Read by**: Not read by CLI (intended for MCP servers and feature code)

---

### Precedence Rules

**Environment resolution** (from `lib/config.ts` → `getEnv()`):

1. `~/.fusebase/config.json` → `env` field
2. `fusebase.json` → `env` field
3. `process.env.ENV`

**API URL resolution** (from `lib/api.ts` → `getBaseUrl()` returns public API base URL string):

- `env === "dev"` → `https://public-api.dev-thefusebase.com`
- `env === "prod"` → `https://public-api.thefusebase.com`
- `env === "local"` → `http://localhost:3000`

---

## SDK Usage

Features use `@fusebase/dashboard-service-sdk` for runtime execution:

**Notes**:

- SDK is OpenAPI-based
- SDK methods mirror MCP tools 1:1 by operation ID
- Use MCP for discovering available operations (`tools_list`, `tools_search`)
- Use SDK for executing operations in feature code

**For conceptual understanding**, see [Conceptual Model](CONCEPTS.md) for details on MCP vs SDK usage.

**For conceptual understanding**, see [Conceptual Model](CONCEPTS.md) for details on MCP vs SDK usage.

---

## 6. Non-Interactive / CI Usage

### Bypassing Prompts

**API Key**:

```bash
fusebase auth --api-key=$API_KEY
```

**Init with flags**:

```bash
fusebase init --ide ""  # Skip IDE setup
```

**Dev feature with path**:

```bash
fusebase feature create --path features/my-feature  # Skip path prompt
```

**Dev start with feature**:

```bash
fusebase dev start my-feature-id  # Skip feature selection
```

### CI Pipeline Recommendations

1. **Set API key**:

   ```bash
   fusebase auth --api-key=$FUSEBASE_API_KEY
   ```

2. **Initialize project** (if needed):

   ```bash
   fusebase init --ide ""  # Skip IDE setup in CI
   ```

3. **Deploy**:
   ```bash
   fusebase deploy  # Fully automated, no prompts
   ```

### Safe Defaults

- **IDE selection**: If not TTY and no `--ide` flag, IDE setup is skipped (empty set)
- **Feature selection**: Auto-selects if only one feature exists
- **Organization selection**: Auto-selects if only one organization exists
- **Template usage**: Defaults to `false` if directory is not empty

---

## 7. Extending the CLI

### Adding a New Command

1. **Create command file** in `lib/commands/`:

   ```typescript
   // lib/commands/my-command.ts
   import { Command } from "commander";

   export const myCommand = new Command("my-command")
     .description("Description")
     .option("--flag", "Flag description")
     .action(async (options) => {
       // Implementation
     });
   ```

2. **Register in `index.ts`**:
   ```typescript
   import { myCommand } from "./lib/commands/my-command";
   program.addCommand(myCommand);
   ```

### Adding Interactive Prompts

**Use `@inquirer/prompts`**:

```typescript
import { select, input, confirm, checkbox } from "@inquirer/prompts";

// Single choice
const choice = await select({
  message: "Select option:",
  choices: [
    { name: "Option 1", value: "opt1" },
    { name: "Option 2", value: "opt2" },
  ],
});

// Text input
const text = await input({
  message: "Enter value:",
  default: "default-value",
  validate: (value) => {
    if (!value.trim()) return "Value is required";
    return true;
  },
});

// Yes/No
const yes = await confirm({
  message: "Continue?",
  default: true,
});

// Multi-select
const selected = await checkbox({
  message: "Select items:",
  choices: [
    { name: "Item 1", value: "item1" },
    { name: "Item 2", value: "item2" },
  ],
  required: true,
});
```

**Conventions**:

- Check `process.stdin.isTTY` before prompting (or let inquirer handle it)
- Provide sensible defaults
- Validate input with clear error messages
- Use descriptive prompt messages

---

## 8. Appendix

### Common Pitfalls

1. **"App not initialized"**: Run `fusebase init` first
2. **"No API key configured"**: Run `fusebase auth` first
3. **"No features configured"**: Run `fusebase feature create` to configure at least one feature
4. **Port conflicts**: Dev server auto-finds available ports, but if issues persist, kill processes on ports 4173/4174
5. **Feature token not received**: Ensure feature iframe listens for `postMessage` with `type: 'featuretoken'`

### Troubleshooting Interactive Issues

**Prompts not appearing in CI**:

- Check `process.stdin.isTTY` - prompts are skipped in non-TTY environments
- Use flags/options to provide values instead

**IDE configs not copied**:

- Ensure `--ide` flag is provided or running in TTY
- Check that project template is being used (answer "yes" to template prompt)

**MCP token not generated**:

- Ensure project template is used during `fusebase init`
- Check API key is valid (run `fusebase auth` again)
- Run `fusebase env create` to create or overwrite `.env` with MCP token
- In TTY mode after successful `env create`, confirm immediate `fusebase config ide --force` to refresh all IDE MCP configs (or run it manually if declined)

### Glossary

- **Feature**: A deployable unit in a Fusebase app (e.g., a dashboard, form, widget)
- **Feature Token**: Authentication token for a feature to call Fusebase APIs (delivered via `postMessage` in dev server)
- **Dev Server**: Local development environment consisting of:
  - Frontend UI (port 4173): React app that displays features in iframes
  - API Proxy (port 4174): Proxies requests to Fusebase API with authentication
- **MCP**: Model Context Protocol - configuration for AI assistants to interact with Fusebase
- **Workspace**: The project directory (where `fusebase.json` lives)
- **App**: A Fusebase application (contains multiple features)
- **Organization**: Top-level entity that contains apps

### Related Documentation

- **Architecture**: [Architecture Documentation](ARCHITECTURE.md)
- **CLI Flows**: [Step-by-Step CLI Flows](CLI-FLOWS.md)
- **Conceptual Model**: [Apps, Features, and Data Access](CONCEPTS.md)
- **Guide**: [Env + IDE MCP refresh rules](guides/env-mcp-refresh.md)
