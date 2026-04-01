# Fusebase Apps CLI

A command-line tool for managing Fusebase applications. Build, develop, and deploy features to the Fusebase platform.

## Architecture

See [Architecture](docs/ARCHITECTURE.md) for detailed documentation on the CLI's architecture, command system, configuration, and development workflow.

For deeper understanding of:
- MCP integration
- API client layers (legacy vs SDK)
- LLM capability discovery
- Core concepts (apps, features, data access)

See:
- [Architecture Documentation](docs/ARCHITECTURE.md)
- [CLI Flows](docs/CLI-FLOWS.md)
- [Conceptual Model](docs/CONCEPTS.md)
- [Feature Permissions](docs/PERMISSIONS.md) — canonical model for `dashboardView`, `database`, `gate`, and `feature update`
- [Fusebase Gate meta (`fusebaseGateMeta`)](docs/FUSEBASE_GATE_META.md) — Gate SDK analyze flow and `fusebase.json` snapshot

## CLI Usage

See [CLI Commands & Interactive Prompts](docs/CLI.md) for comprehensive documentation on all available commands, options, and interactive prompts.

## Installation

The CLI is not published to npm. Install globally from this repo:

**Option 1 – Link from a local clone (for development):**

```bash
cd /path/to/apps-cli
bun install
npm link
```

Then run `fusebase` from anywhere. Requires [Bun](https://bun.sh) (to run the CLI) and Node/npm (for `npm link`). Use `npm link`, not `bun link --global`—Bun does not add the package bin to your PATH.

**Option 2 – Install from Git:**

```bash
npm install -g git+https://github.com/Fusebase/apps-cli.git
# or: bun install -g git+https://github.com/Fusebase/apps-cli.git
```

Replace the URL with your actual repo if different.

**Run without installing:**

```bash
cd /path/to/apps-cli
bun index.ts [command]
```

## Commands

### `fusebase version`

Print CLI version (from package.json).

### `fusebase auth [--api-key <apiKey>]`

Set the API key for authentication with the Fusebase API.

**Options:**

| Option | Description |
|--------|-------------|
| `--api-key <apiKey>` | The API key to store. If not provided, the OAuth auth flow is started. |
| `--dev` | Use the dev environment |

**Example:**

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

Initialize a new Fusebase app in the current directory. This command will:

1. Prompt you to select an organization (or use the only one if there's just one)
2. Let you select an existing app or create a new one
3. Optionally copy a project template if the directory is empty
4. Create a `fusebase.json` configuration file

**Arguments:** None

**Options:**

- `--name <name>` - App title/name (if not provided, prompted)
- `--subdomain <subdomain>` - App subdomain (e.g. `my-app`)
- `--org <orgId>` - Organization ID (skips org selection)
- `--ide <preset>` - IDE preset: `claude-code`, `cursor`, `vscode`, `opencode`, `codex`, or `other` (single choice; generates all IDE configs by default)
- `--force` - Overwrite existing IDE config files/folders
- `--git` - After setup, **offer** to run `git init` (local only; use `git remote add` + `git push` to sync with a host)
  - Also enabled automatically if global flag `git-init` is active (`fusebase config set-flag git-init`)

**Interactive Prompts:**

- **Organization selection** - Choose from your available organizations
- **App selection** - Choose an existing app or create a new one
  - When creating a new app: enter title and subdomain
- **Project template** - If directory is empty, the template is used automatically. If not empty, you'll be asked whether to continue in the current folder.
- **IDE configuration** - MCP config is generated for all supported IDEs by default (unless `--ide` is provided); **required** MCP servers from the catalog (respecting flags) are written automatically. Optional servers are **not** configured during init — run `fusebase integrations` later.
- **App name** - Name for `package.json` (if using template)

**Example:**

```bash
mkdir my-app
cd my-app
fusebase init
```

**Output:**

Creates a `fusebase.json` file with the following structure:

```json
{
  "orgId": "your-org-id",
  "appId": "your-app-id"
}
```

---

### `fusebase git`

Initialize a **local** Git repository in the current directory (`git init`). This does **not** connect to GitHub, GitLab, or any remote — it only creates `.git` on your machine.

If Git is not installed, the CLI prints a link to the [official Git downloads](https://git-scm.com/downloads) and platform-specific pages, then suggests running `fusebase git` again after installation.

After a successful init (or if the folder is already inside a Git work tree), the CLI prints a short guide: local vs remote, how to add `origin` and push, and a compact branch workflow (`main` / feature branches).

**Options:** None

**Example:**

```bash
cd my-app
fusebase git
```

---

### `fusebase feature list`

List all features for the current app with their URLs.

**Arguments:** None

**Options:** None

**Prerequisites:**

- App must be initialized (`fusebase init`)
- API key must be configured (`fusebase auth`)

**Example:**

```bash
fusebase feature list
```

**Output:**

```
Features:

  My Feature
    ID:   feature-id-123
    URL:  https://your-app-id.thefusebase.app/my-feature
    Permissions:
      ID               Title             Type
      ---------------  ----------------  --------
      dashboard-id-123 Sales Dashboard   Table
      database-id-456  Customer Database Database

Total: 1 feature(s)
```

---

### `fusebase deploy`

Deploy features to Fusebase. This command will:

1. Install dependencies and run lint for each feature (if the feature has a `lint` script in its `package.json`)
2. Run the build command for each feature (if configured)
3. Upload all files from the output directory
3. Create a new version of each feature

**Arguments:** None

**Options:** None

**Prerequisites:**

- App must be initialized (`fusebase init`)
- API key must be configured (`fusebase auth`)
- At least one feature must have a `path` configured in `fusebase.json`

**Example:**

```bash
fusebase deploy
```

**Feature Configuration in `fusebase.json`:**

```json
{
  "orgId": "...",
  "appId": "...",
  "features": [
    {
      "id": "feature-id",
      "path": "features/my-feature",
      "build": {
        "command": "npm run build",
        "outputDir": "dist"
      }
    }
  ]
}
```

---

### `fusebase feature update <featureId>`

Update settings for an existing feature.

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `featureId` | Yes | The ID of the feature to update |

**Options:**

| Option | Description |
|--------|-------------|
| `--access <principals>` | Set access principals, comma-separated (e.g., `visitor`, `orgRole:member`) |
| `--permissions <permissions>` | Replace `dashboardView/database` permissions |
| `--sync-gate-permissions` | Analyze the feature path and replace `gate` permissions |

**Access Principals:**

The `--access` option replaces the entire access principal list. Principals are comma-separated entries:

| Principal | Description |
|-----------|-------------|
| `visitor` | Any unauthenticated visitor (public access) |
| `orgRole:<id>` | Org members with a specific role. Valid ids: `guest`, `client`, `member`, `manager`, `owner` |

**Examples:**

```bash
# Make a feature publicly accessible
fusebase feature update feat_abc123 --access=visitor

# Allow org members only
fusebase feature update feat_abc123 --access=orgRole:member

# Allow multiple roles
fusebase feature update feat_abc123 --access=orgRole:member,orgRole:client

# Public access + org members
fusebase feature update feat_abc123 --access=visitor,orgRole:member

# Replace dashboard/database permissions only
fusebase feature update feat_abc123 --permissions="dashboardView.dash_1:view_1.read;database.id:db_1.write"

# Sync Gate permissions only
fusebase feature update feat_abc123 --sync-gate-permissions

# Replace dashboard/database and Gate permissions in one request
fusebase feature update feat_abc123 --permissions="dashboardView.dash_1:view_1.read" --sync-gate-permissions
```

See [Feature Permissions](docs/PERMISSIONS.md) for the full permissions model and merge semantics.

---

### `fusebase feature create`

Create and configure a feature for development.

**Options:**

| Option | Description |
|--------|-------------|
| `--name <name>` | **(Required)** Feature title |
| `--subdomain <subdomain>` | **(Required)** Subdomain for the feature (e.g., `my-feature`) |
| `--path <path>` | **(Required)** Local feature directory path (e.g., `features/my-feature`) |
| `--dev-command <command>` | **(Required)** Dev server command (e.g., `npm run dev`) |
| `--build-command <command>` | **(Required)** Build command (e.g., `npm run build`) |
| `--output-dir <dir>` | **(Required)** Build output directory (e.g., `dist`) |
| `--access <principals>` | Set access principals on creation (e.g., `visitor`, `orgRole:member`) |
| `--permissions <permissions>` | Set manual `dashboardView/database` permissions |

**Example:**

```bash
fusebase feature create --name="My Feature" --subdomain=my-feature --path=features/my-feature --dev-command="npm run dev" --build-command="npm run build" --output-dir=dist
```

**Updates `fusebase.json`:**

```json
{
  "orgId": "...",
  "appId": "...",
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

---

### `fusebase dev start [feature]`

Start the development server for a feature. This command:

1. Starts the feature's dev server (if `dev.command` is configured)
2. Starts the Fusebase dev server UI (port 4173)
3. Starts the API proxy server (port 4174)
4. Creates a per-session debug log folder under the selected feature directory at `logs/dev-<timestamp>/`
5. Opens the dev UI in your browser

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `feature` | No | Feature ID or path (from fusebase.json features). If not provided, you'll be prompted to select one. |

**Options:** None

**Prerequisites:**

- App must be initialized (`fusebase init`)
- API key must be configured (`fusebase auth`)
- At least one feature must be configured in `fusebase.json`

**Example:**

```bash
# Interactive feature selection
fusebase dev start

# Start specific feature by ID
fusebase dev start my-feature-id

# Start specific feature by path
fusebase dev start features/dashboard
```

**Dev Server Components:**

| Component | Port | Description |
|-----------|------|-------------|
| Frontend UI | 4173 | React app that displays features in iframes |
| API Proxy | 4174 | Proxies requests to Fusebase API with authentication |

**Per-session Debug Logs:**

Each `fusebase dev start` run creates a session folder inside the selected feature directory:

```text
<feature-dir>/logs/dev-<timestamp>/
  browser-logs.jsonl
  access-logs.jsonl
  backend-logs.jsonl
  frontend-dev-server-logs.jsonl
```

**Feature Token Flow:**

The dev server automatically handles feature token delivery:
1. Fetches feature tokens from the Fusebase API
2. Sends tokens to the feature iframe via `postMessage`
3. Sets cookie `fbsfeaturetoken` so same-origin app backend requests can authenticate without relying on a custom header
4. Your feature receives the token:

```javascript
window.addEventListener('message', (event) => {
  if (event.data?.type === 'featuretoken' && event.data?.token) {
    // Use event.data.token for API calls
  }
});
```

For custom app backends (`/api/*`), treat `x-app-feature-token` as optional in deployed mode and read `x-app-feature-token` or cookie `fbsfeaturetoken` on the server.

---

### `fusebase skills update`

Overwrite `AGENTS.md` and `.claude/skills/` in the current app with the latest versions from the project template. Use this to refresh agent rules and skill docs without re-running `fusebase init`.

**Prerequisites:** App must be initialized (`fusebase.json` must exist in the current directory).

**Example:**

```bash
fusebase skills update
```

**Output:** `✓ Updated AGENTS.md and .claude/skills`

To validate skills (e.g. when adding or editing skills in `project-template/.claude/skills`), use **`npm run skills:validate`**. It runs [skills-ref](https://github.com/agentskills/agentskills/tree/main/skills-ref) for each skill. Requires `skills-ref` on PATH. On macOS (Homebrew Python) use a venv or pipx: e.g. `pipx install -e /path/to/agentskills/skills-ref`, or create a venv in that directory and activate it before running. CI runs this when skills or the script change.

---

### `fusebase env create`

Create or overwrite `.env` in the current app with MCP token and URL. Use this after `fusebase init` or when the token has expired.

**Options:** `--no-force` — only create .env if missing; do not overwrite existing file.

**Prerequisites:** App must be initialized (`fusebase.json` with `orgId`), API key configured (`fusebase auth`).

**Example:**

```bash
fusebase env create
```

---

## Configuration Files

### `~/.fusebase/config.json`

Global configuration stored in your home directory:

```json
{
  "apiKey": "your-api-key",
  "env": "dev",
  "flags": ["mcp-beta"]
}
```

#### Experimental Flags

Flags gate experimental features. The `skills update` command uses flags to conditionally include/exclude content via Eta templates.

| Flag | Effect |
|------|--------|
| `mcp-beta` | Unlocks optional MCP servers in the integrations catalog that are marked beta (see `ide-configs/mcp-servers.ts`) |
| `git-init` | Makes `fusebase init` automatically offer local Git initialization (same behavior as passing `--git`) |
| `git-debug-commits` | Adds the `git-debug-commits` skill to generated apps: during debugging, create a dedicated fix commit and include SHA in debug report |

```bash
fusebase config set-flag mcp-beta    # Enable beta-gated MCP catalog entries
fusebase config remove-flag mcp-beta # Disable
fusebase config flags              # List active flags
fusebase skills update             # Regenerate project files
```

#### Recreate IDE config

Re-run IDE MCP setup in the current project (same logic as during `fusebase init`): copy config for the chosen IDE and substitute URL/token from `.env`.

```bash
fusebase config ide                # Generate MCP config for all IDEs
fusebase config ide --ide cursor   # Use Cursor preset
fusebase config ide --ide cursor --force   # Overwrite existing files
```

#### MCP Integrations

Interactive catalog (optional servers) plus custom HTTP MCP servers stored in `fusebase.json` under `mcpIntegrations.custom`:

```bash
fusebase integrations                  # checkbox: catalog optional + custom entries
fusebase integrations --ide cursor     # limit writes to one IDE (optional)
fusebase integrations --no-prompt      # skip UI; optional catalog = inferred from IDE configs

# Custom server (GET reachability check by default; use --skip-check to skip)
fusebase integrations add my-mcp --url https://example.com/mcp --type http [--token TOKEN]
fusebase integrations add my-mcp --url https://example.com/mcp --header 'Authorization: Bearer x'
fusebase integrations disable my-mcp   # keep fusebase.json entry; strip from IDE configs
fusebase integrations enable my-mcp    # turn back on and re-apply IDE configs
fusebase integrations remove my-mcp    # alias: delete — remove from fusebase.json and IDE configs
```

Custom definitions may include `token` (sent as `Authorization: Bearer …` unless you set headers yourself) and `enabled: false` when disabled.

### `fusebase.json`

Project-specific configuration in your app root:

```json
{
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

---

## Typical Workflow

1. **Authenticate** with your API key:
   ```bash
   fusebase auth
   ```

2. **Initialize** a new app:
   ```bash
   mkdir my-app && cd my-app
   fusebase init
   ```

3. **Configure** a feature for development:
   ```bash
   fusebase feature create
   ```

4. **Start** the development server:
   ```bash
   fusebase dev start
   ```

5. **Deploy** to Fusebase:
   ```bash
   fusebase deploy
   ```

---

## Framework Detection

The CLI automatically detects common frameworks and suggests appropriate dev/build commands:

- **Vite** - `npm run dev` / `npm run build` (output: `dist`)
- **Next.js** - `npm run dev` / `npm run build` (output: `.next`)
- **Create React App** - `npm start` / `npm run build` (output: `build`)
- **Generic npm** - Reads from `package.json` scripts

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ENV` | Set to `dev` to use the development environment |

---

## License

MIT
