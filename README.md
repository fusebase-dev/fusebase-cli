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
- [Git Configuration Guide](docs/guides/git-config.md)
- [Conceptual Model](docs/CONCEPTS.md)
- [Feature Permissions](docs/PERMISSIONS.md) — canonical model for `dashboardView`, `database`, `gate`, and `feature update`
- [Fusebase Gate meta (`fusebaseGateMeta`)](docs/FUSEBASE_GATE_META.md) — Gate SDK analyze flow and `fusebase.json` snapshot

## CLI Usage

See [CLI Commands & Interactive Prompts](docs/CLI.md) for comprehensive documentation on all available commands, options, and interactive prompts.

## Installation

> **Prerequisite: [Bun](https://bun.sh) v1.0+** — the CLI runs as a Bun script and requires Bun at runtime regardless of how you install it.
>
> Install Bun if you don't have it:
> ```bash
> curl -fsSL https://bun.sh/install | bash
> ```

The CLI is not published to npm. Install globally from this repo:

**Option 1 – Install from Git:**

```bash
bun install -g git+https://github.com/fusebase-dev/fusebase-cli.git
```

Bun downloads the package and links the `fusebase` binary globally.

**Option 2 – Link from a local clone (for development):**

```bash
cd /path/to/apps-cli
bun install
npm link
```

Then run `fusebase` from anywhere. Use `npm link`, not `bun link --global` — Bun does not add the package bin to your PATH.

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
- `--git` - After setup, initialize local Git and sync with configured GitLab remote (creates/uses repo in `<gitlabGroup>/<dev|prod>/...`, sets `origin`, pushes current branch)
  - Also enabled automatically if global flag `git-init` is active (`fusebase config set-flag git-init`)
- `--skip-git` - Skip local Git initialization and GitLab sync (overrides both `--git` and global `git-init`)
- `--git-tag-managed` - If app is managed, add `managed` topic to the GitLab project during sync
  - In interactive init, CLI shows a suggested GitLab repo name and lets you edit it before sync

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

Initialize a **local** Git repository in the current directory (`git init`), ensure baseline `.gitignore`, and print local workflow hints.

### `fusebase git sync [--git-tag-managed]`

Sync the current local repository with GitLab using global config from `~/.fusebase/config.json`:

- `gitlabHost` (for example `gl.nimbusweb.co`)
- `gitlabToken`
- `gitlabGroup` (base namespace; env subgroup `dev`/`prod` is selected from current auth env)

Behavior:

- Creates/uses GitLab project with visibility `private`
- Project name is generated as `app-<base>-<env>` (for example `app-workspace-tools-dev`)
- Base priority: Fusebase app title (with transliteration fallback for Cyrillic) → current folder name → app `subdomain`
- Configures local `origin` (without overwriting existing different origin)
- Pushes current branch to remote
- With `--git-tag-managed`, applies topic `managed` for managed apps
- Equivalent short form: `fusebase git --git-sync [--git-tag-managed]`

**Config example:**

```json
{
  "gitlabHost": "gl.nimbusweb.co",
  "gitlabToken": "glpat-xxxxxxxxxxxxxxxx",
  "gitlabGroup": "vibecode"
}
```

**Examples:**

```bash
cd my-app
fusebase git
fusebase git sync
fusebase git sync --git-tag-managed
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

Deploy features to Fusebase. For each feature this command will:

1. Install dependencies and run lint (if the feature has a `lint` script in its `package.json`)
2. Run the build command (if configured)
3. Compute a SHA-256 `frontendHash` of the upload directory and a `backendHash` of the `backend/` folder (if present)
4. Compare those hashes against the active version and take one of:
   - **No changes** → skip the feature entirely (no new version, no upload, no backend deploy). Logs `✓ No changes for feature, skipping deploy`.
   - **Frontend unchanged, backend changed** → create a new version, reuse the previous frontend bundle via `copyFrontendParams` (no upload), then re-deploy the backend.
   - **Frontend changed** → create a new version, upload files, persist the new `frontendHash`. Backend is handled per its own hash (skipped/copied or re-deployed).
5. With `--force`, hash matches are ignored and a full upload + redeploy runs for every feature.
6. If the feature contains `openapi.json`, validate it and publish the app API manifest to the feature registry.

**Arguments:** None

**Options:**

| Option | Description |
|--------|-------------|
| `--force` | Force re-upload and re-deploy regardless of frontend/backend hash match |

**Prerequisites:**

- App must be initialized (`fusebase init`)
- API key must be configured (`fusebase auth`)
- At least one feature must have a `path` configured in `fusebase.json`

**Examples:**

```bash
# Skips features with unchanged frontend + backend
fusebase deploy

# Always uploads and redeploys
fusebase deploy --force
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

### `fusebase api validate [--file <path>]`

Validate the feature OpenAPI contract for the Phase 1 app API MVP.

Behavior:

- looks for `openapi.json` in the current directory by default
- also detects `openapi.yaml` / `openapi.yml`, but YAML validation is not supported in this MVP yet
- validates:
  - `OpenAPI 3.1`
  - `info.title`
  - `info.version`
  - operation presence
  - unique `operationId`
  - basic `x-fusebase-*` fields

**Examples:**

```bash
fusebase api validate
fusebase api validate --file openapi.json
```

**Output:**

- success summary with title, version, and operation ids
- or a list of validation issues with JSON paths

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

If you later scaffold a backend into that feature with:

```bash
fusebase scaffold --template backend --dir features/my-feature
```

the CLI creates `openapi.json` automatically if it does not already exist.

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

### `fusebase update`

One command to refresh a generated app after a CLI or template upgrade:

1. **CLI binary update** — runs first (skips automatically in local linked/source mode). Use **`--skip-cli-update`** to disable this stage.
2. **Agent assets** — refreshes `AGENTS.md`, `.claude/skills/`, `.claude/agents/`, `.claude/hooks/`, `.claude/settings.json`.
3. **MCP + IDE** — selectively regenerates Dashboards and/or Gate MCP tokens and refreshes IDE configs when the CLI’s **permission policy** no longer matches **`.env`** markers `DASHBOARDS_MCP_POLICY_FP` and `GATE_MCP_POLICY_FP` (SHA-256 of the canonical permission sets; Gate includes `isolated-stores` extras when that global flag is on). Tokens must also be present in `.env`. Use **`--force-mcp`** to refresh both regardless.
4. **Managed SDK versions** — bumps only packages listed under `fusebaseCli.managedDependencies` in `project-template/package.json` (defaults to `@fusebase/dashboard-service-sdk` and `@fusebase/fusebase-gate-sdk`). Root `package.json` gets missing entries added; **feature** `package.json` files are updated only if those deps already exist (nothing new is injected into features).
5. **`npm install`** — runs **only** in directories where a managed dependency version actually changed.

**Pre-update Git checkpoint:** In a TTY, you are prompted for an optional commit before changes (empty commit if the tree is clean). If current branch tracks a remote (upstream configured), the pre-update commit is pushed immediately. Without Git, you are warned about rollback risk and can initialize a repo first. Use **`--skip-commit`** to skip, or **`--commit`** to run the checkpoint in CI/non-interactive mode without prompts.

**Prerequisites:** `fusebase.json` with `orgId` and `appId`; `fusebase auth` for stages that touch MCP tokens.

Behavior by directory:

- In an app directory (`fusebase.json` exists): runs full flow (CLI + app stages).
- Outside an app directory: runs only CLI binary update.
- Use `--skip-app` to force CLI-only mode even inside an app directory.

**Examples:**

```bash
fusebase update
fusebase update --dry-run
fusebase update --skip-app
fusebase update --skip-skills --force-mcp
fusebase update --skip-install
fusebase update --skip-commit
```

**Flags (stages default on; use `no-*` to disable):**

| Flag | Effect |
|------|--------|
| `--skip-app` | Skip app stages and run only CLI update |
| `--skip-cli-update` | Skip automatic CLI self-update stage |
| `--skip-skills` | Skip agent asset refresh |
| `--skip-mcp` | Skip MCP token + IDE refresh |
| `--force-mcp` | Always refresh MCP tokens + IDE configs |
| `--skip-deps` | Skip managed dependency version sync |
| `--skip-install` | After dep sync, do not run `npm install` |
| `--skip-commit` | Skip pre-update Git checkpoint |
| `--commit` | Run Git checkpoint without prompts (non-interactive) |
| `--dry-run` | Print planned work only |

`fusebase update` is the single update command.

---

### `fusebase sidecar`

Manage sidecar containers for a feature backend or for a specific cron job. Sidecars are pre-built Docker images that run alongside the main container, sharing its network namespace (reachable on `localhost`). Stored in `fusebase.json` under `features[].backend.sidecars[]` (backend) or `features[].backend.jobs[].sidecars[]` (per cron job).

```bash
# Add a sidecar to the backend (default — same as today)
fusebase sidecar add --feature <featureId> --name <name> --image <image> \
  [--port <port>] [--tier small|medium|large] [--env KEY=VALUE ...]

# Add a sidecar to a specific cron job (requires the job-sidecars flag)
fusebase sidecar add --feature <featureId> --job <jobName> --name <name> --image <image> \
  [--port <port>] [--tier small|medium|large] [--env KEY=VALUE ...]

# Remove a sidecar
fusebase sidecar remove --feature <featureId> --name <name> [--job <jobName>]

# List configured sidecars
fusebase sidecar list --feature <featureId> [--job <jobName>]
```

**Options:**

- `--feature <featureId>` (required) — feature ID
- `--name <name>` (required for add/remove) — sidecar name. Lowercase letters, digits, and hyphens; max 63 chars; must start with a lowercase letter.
- `--image <image>` (required for add) — Docker image reference (e.g. `browserless/chrome:latest`)
- `--port <port>` — port the sidecar listens on (informational; `localhost:<port>` from the main container)
- `--tier small|medium|large` — resource tier (default: `small`)
- `--env KEY=VALUE` — environment variables, repeatable
- `--job <jobName>` — attach the sidecar to the named cron job instead of the backend. **Requires the `job-sidecars` flag** (`fusebase config set-flag job-sidecars`). Without `--job`, all three subcommands target backend sidecars exactly as today.

**Limits and rules:**

- Max **3 sidecars per scope**. The backend's cap is independent of each job's cap — every job has its own 3-sidecar budget.
- Sidecar names must be unique within a scope. The same name (e.g. `chromium`) may exist on the backend and on a cron job; they are separate containers in separate replicas.
- Backend sidecars share the backend container app's network namespace. Cron-job sidecars share **the cron job replica's** network namespace only — they are isolated from the backend's sidecars and from sidecars in other jobs.
- Replicas of a cron job complete when the **main job container** exits. Non-exiting sidecars (headless browsers, Redis, etc.) are torn down automatically with the replica; `replicaTimeout=3600s` is the hard ceiling.
- `fusebase dev start` does not run cron jobs nor sidecars — they only take effect after `fusebase deploy`.

---

### `fusebase env create`

Create or overwrite `.env` in the current app with MCP token and URL. Use this after `fusebase init` or when the token has expired.

When `.env` is created/updated, the command refreshes both Dashboards and Gate MCP tokens. In interactive terminals, it then offers to immediately run `fusebase config ide --force` for all IDE MCP configs; if declined, it prints that command as the next step.

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
  "flags": ["mcp-beta"],
  "gitlabHost": "gl.nimbusweb.co",
  "gitlabGroup": "vibecode",
  "gitlabToken": "glpat-xxxxxxxxxxxxxxxx"
}
```

#### Experimental Flags

Flags gate experimental features. The `update` command uses flags to conditionally include/exclude template assets via Eta templates.

| Flag | Effect |
|------|--------|
| `mcp-beta` | Unlocks optional MCP servers in the integrations catalog that are marked beta (see `ide-configs/mcp-servers.ts`) |
| `git-init` | Makes `fusebase init` automatically offer local Git initialization (same behavior as passing `--git`; can be disabled per run with `--skip-git`) and includes Git workflow skill files in generated apps |
| `git-debug-commits` | Enables strict debug/deploy traceability section inside the `git-workflow` skill: deploy preflight + dirty-tree guard, commit-per-fix, and SHA/tag traceability in debug/deploy reports |
| `app-business-docs` | Copies the `app-business-docs` skill into the app: keeps **`docs/en/business-logic.md`** (English) aligned with real behavior — domain rules, main user flows, edge cases; update after business-logic changes or when debugging unclear behavior |
| `mcp-gate-debug` | Copies the `mcp-gate-debug` skill: after Fusebase Gate MCP tool runs, summarize smooth vs rough paths and suggest improvements to `.claude/skills/fusebase-gate`, prompts, or MCP server behavior — prioritize **isolated stores** (SQL/NoSQL) flows |
| `isolated-stores` | Enables isolated stores functionality (SQL/NoSQL); also turns on required template references and `isolated_store.*` permissions in `fusebase env create` |
| `portal-specific-features` | Includes portal-specific feature guidance in prompts: `fusebase-portal-specific-features` skill, `{{CurrentPortal}}` dashboard filter reference, and portal auth-context handling notes |
| `job-sidecars` | Enables per-job sidecar containers for cron jobs. Unlocks `--job <jobName>` on `fusebase sidecar add/remove/list` so sidecars can be attached to specific cron jobs (`features[].backend.jobs[].sidecars[]`) in addition to the backend. Each job has its own 3-sidecar cap, independent of the backend cap; sidecar names are unique per scope. Also gates the per-job sidecar sections of the `feature-sidecar` and `feature-backend` skill templates. |

Enable a flag globally, then refresh the project template:

```bash
fusebase config set-flag app-business-docs   # Business-logic documentation skill
fusebase config set-flag mcp-gate-debug      # Gate MCP debug / improvement summary skill
fusebase config set-flag isolated-stores     # Isolated stores functionality (SQL/NoSQL)
fusebase config set-flag portal-specific-features # Portal-specific features prompts/guidance
fusebase update --skip-mcp --skip-deps --skip-cli-update --skip-commit  # Refresh agent assets only
```

Other examples:

```bash
fusebase config set-flag mcp-beta    # Enable beta-gated MCP catalog entries
fusebase config remove-flag mcp-beta # Disable
fusebase config flags              # Interactive flag selector (TTY)
fusebase config flags --list       # List active flags (non-interactive)
fusebase update --skip-mcp --skip-deps --skip-cli-update --skip-commit  # Regenerate project files
```

To permanently graduate a flag (remove gating and enable the feature forever), use the `/remove-flag` skill in your coding agent:

```
/remove-flag <flag-name>
```

#### Recreate IDE config

Re-run IDE MCP setup in the current project (same logic as during `fusebase init`): copy config for the chosen IDE and substitute URL/token from `.env`.

```bash
fusebase config ide                # Generate MCP config for all IDEs
fusebase config ide --ide cursor   # Use Cursor preset
fusebase config ide --ide cursor --force   # Overwrite existing files
```

#### GitLab sync config

Configure the GitLab settings used by `fusebase init --git` and `fusebase git sync`:

```bash
fusebase config gitlab                 # Interactive setup/update
fusebase config gitlab --show          # Print current values (token masked)
fusebase config gitlab --host gl.nimbusweb.co --group vibecode --token glpat_xxx
fusebase config gitlab --clear-token   # Remove stored token
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
