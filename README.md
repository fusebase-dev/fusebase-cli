# Fusebase Apps CLI

A command-line tool for managing Fusebase applications. Build, develop, and deploy apps to the Fusebase platform.

## Architecture

See [Architecture](docs/ARCHITECTURE.md) for detailed documentation on the CLI's architecture, command system, configuration, and development workflow.

For deeper understanding of:
- MCP integration
- API client layers (legacy vs SDK)
- LLM capability discovery
- Core concepts (products, apps, data access)

See:
- [Architecture Documentation](docs/ARCHITECTURE.md)
- [CLI Flows](docs/CLI-FLOWS.md)
- [Git Configuration Guide](docs/guides/git-config.md)
- [App Environments Guide](docs/guides/environments.md) — one project targeting dev/prod/beta platform contexts (`fusebase env`, experimental)
- [App Environment Migration Guide](docs/guides/environment-migration.md) — checklist for converting existing apps to env lockfiles, env-safe runtime config, readonly e2e, and CI
- [E2E Playwright Setup Guide](docs/guides/e2e-playwright-setup.md) — add the CLI e2e template, choose safe env targets, and wire GitLab CI
- [Conceptual Model](docs/CONCEPTS.md)
- [App Permissions](docs/PERMISSIONS.md) — canonical model for `dashboardView`, `database`, `gate`, and `app update`
- [Fusebase Gate meta (`fusebaseGateMeta`)](docs/FUSEBASE_GATE_META.md) — Gate SDK analyze flow and `fusebase.json` snapshot
- [App API dependencies meta (`fusebaseAppApiDependenciesMeta`)](docs/APP_API_DEPENDENCIES.md) — cross-app `callAppApi` static analysis snapshot in `fusebase.json` with optional explicit remote sync (`fusebase analyze app-apis --sync`; requires flag `cross-app-api-calls-analysis`)
- [App API consumer contracts](docs/APP_API_CONTRACTS.md) — local PoC format and hidden CLI validation, unresolved/manual resolution flow, scaffolding, publish-to-central storage, central consumer/provider verification, and machine-readable `--json` output for cross-app API contracts
- [E2E tests](test/e2e/README.md) — CLI end-to-end smoke + dev-start parallel tests, env vars, and CI variables

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
  "productId": "your-app-id"
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

### `fusebase app list`

List all apps for the current app with their URLs.

**Arguments:** None

**Options:** None

**Prerequisites:**

- App must be initialized (`fusebase init`)
- API key must be configured (`fusebase auth`)

**Example:**

```bash
fusebase app list
```

**Output:**

```
Apps:

  My App
    ID:   app-id-123
    URL:  https://your-app-id.thefusebase.app/my-app
    Permissions:
      ID               Title             Type
      ---------------  ----------------  --------
      dashboard-id-123 Sales Dashboard   Table
      database-id-456  Customer Database Database

Total: 1 app(s)
```

---

### `fusebase app portal-embeds <appId>`

List portal pages where an app is embedded in the current product/org.

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `appId` | Yes | The ID of the app to inspect |

**Prerequisites:**

- App must be initialized (`fusebase init`)
- API key must be configured (`fusebase auth`)

**Example:**

```bash
fusebase app portal-embeds feat_abc123
```

**Output:**

```text
Portal embeds:

Portal: Customer Portal
Page: Home
URL: https://customer.example.com/

Total: 1 portal page(s)
```

If no embeds are found, prints `No portal embeds found for this app.` and exits successfully.

---

### `fusebase deploy`

Deploy apps to Fusebase. For each app this command will:

1. Install dependencies and run lint (if the app has a `lint` script in its `package.json`)
2. Run the build command (if configured)
3. Compute a SHA-256 `frontendHash` of the upload directory and a `backendHash` of the `backend/` folder (if present)
4. Compare those hashes against the active version and take one of:
   - **No changes** → skip the app entirely (no new version, no upload, no backend deploy). Logs `✓ No changes for app, skipping deploy`.
   - **Frontend unchanged, backend changed** → create a new version, reuse the previous frontend bundle via `copyFrontendParams` (no upload), then re-deploy the backend.
   - **Frontend changed** → create a new version, upload files, persist the new `frontendHash`. Backend is handled per its own hash (skipped/copied or re-deployed).
5. With `--force`, hash matches are ignored and a full upload + redeploy runs for every app.
6. If the app contains `openapi.json`, validate it and publish the app API manifest to the app registry.

Deploy **reconciles** the declarative manifest against the platform before the per-app loop:
each `apps[]` entry is resolved to a real app id — a legacy `id` is trusted as-is, otherwise
the entry's `subdomain` is matched against existing apps (bind) or a new app is created. After
a successful deploy the resolved id is written back into the matching `apps[]` entry. See
[Declarative `fusebase.json`](#declarative-fusebasejson).

**Arguments:** None

**Options:**

| Option | Description |
|--------|-------------|
| `--force` | Force re-upload and re-deploy regardless of frontend/backend hash match |
| `--nocode` | Only reconcile infrastructure (bind/create apps on the platform, write back resolved ids); skip code build/upload/backend deploy |
| `--app <app>` | Deploy only the app whose `subdomain`, `id`, `name`, or `path` matches |

**Prerequisites:**

- App must be initialized (`fusebase init`)
- API key must be configured (`fusebase auth`)
- At least one app must have a `path` configured in `fusebase.json`

**Examples:**

```bash
# Skips apps with unchanged frontend + backend
fusebase deploy

# Always uploads and redeploys
fusebase deploy --force

# Reconcile apps on the platform without deploying code
fusebase deploy --nocode

# Deploy only one app
fusebase deploy --app my-app
```

**App Configuration in `fusebase.json`:**

```json
{
  "orgId": "...",
  "productId": "...",
  "apps": [
    {
      "subdomain": "my-app",
      "name": "My App",
      "path": "apps/my-app",
      "build": {
        "command": "npm run build",
        "outputDir": "dist"
      }
    }
  ]
}
```

App entries are declarative — they carry `subdomain` + `name` and omit the platform `id` (deploy
resolves it). Legacy entries with a real `id` still deploy unchanged. See
[Declarative `fusebase.json`](#declarative-fusebasejson).

---

### `fusebase api validate [--file <path>]`

Validate the app OpenAPI contract for the Phase 1 app API MVP.

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
  - app API access policy:
    - `x-fusebase-allowed-callers`: array of `client:<clientId>` or `app:<appId>` caller ids
    - `x-fusebase-required-permissions`: array of `app_api.<namespace>.<capability>.<action>` permissions

**Examples:**

```bash
fusebase api validate
fusebase api validate --file openapi.json
```

**App API access policy example:**

```json
{
  "x-fusebase-visibility": "org",
  "x-fusebase-allowed-callers": ["client:signup-client-id"],
  "x-fusebase-required-permissions": [
    "app_api.client_portal.provision.write"
  ]
}
```

`x-fusebase-required-permissions` is intentionally namespaced with `app_api.` so app-to-app
capabilities do not collide with system Gate permissions such as `isolated_store.read`.

**Output:**

- success summary with title, version, and operation ids
- or a list of validation issues with JSON paths

---

### `fusebase app update <appId>`

Update settings for an existing app.

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `appId` | Yes | The ID of the app to update |

**Options:**

| Option | Description |
|--------|-------------|
| `--access <principals>` | Set access principals, comma-separated (e.g., `visitor`, `orgRole:member`) |
| `--permissions <permissions>` | Replace `dashboardView/database` permissions |
| `--sync-gate-permissions` | Analyze the app path and replace `gate` permissions |

**Access Principals:**

The `--access` option replaces the entire access principal list. Principals are comma-separated entries:

| Principal | Description |
|-----------|-------------|
| `visitor` | Any unauthenticated visitor (public access) |
| `orgRole:<id>` | Org members with a specific role. Valid ids: `guest`, `client`, `member`, `manager`, `owner` |
| `portalMember` | Member of the portal the app is embedded in (portal-scoped, no id) |
| `portalManager` | Portal member who is an org `manager`/`owner` (portal-scoped, no id) |
| `portalClient` | Portal member who is an org `client` (portal-scoped, no id) |

Portal principals are **context-relative**: they only match when the app is opened from inside a portal (the platform resolves them from the verified portal context). Outside a portal they never match, so an app restricted to only portal principals is unreachable when opened directly.

**Examples:**

```bash
# Make an app publicly accessible
fusebase app update feat_abc123 --access=visitor

# Allow org members only
fusebase app update feat_abc123 --access=orgRole:member

# Allow multiple roles
fusebase app update feat_abc123 --access=orgRole:member,orgRole:client

# Public access + org members
fusebase app update feat_abc123 --access=visitor,orgRole:member

# Portal-embedded app: only clients and managers of the embedding portal
fusebase app update feat_abc123 --access=portalClient,portalManager

# Replace dashboard/database permissions only
fusebase app update feat_abc123 --permissions="dashboardView.dash_1:view_1.read;database.id:db_1.write"

# Sync Gate permissions only
fusebase app update feat_abc123 --sync-gate-permissions

# Replace dashboard/database and Gate permissions in one request
fusebase app update feat_abc123 --permissions="dashboardView.dash_1:view_1.read" --sync-gate-permissions
```

See [App Permissions](docs/PERMISSIONS.md) for the full permissions model and merge semantics.

---

### `fusebase app create`

Create and configure an app for development.

**Options:**

| Option | Description |
|--------|-------------|
| `--name <name>` | **(Required)** App title |
| `--subdomain <subdomain>` | **(Required)** Subdomain for the app (e.g., `my-app`) |
| `--path <path>` | **(Required)** Local app directory path (e.g., `apps/my-app`) |
| `--dev-command <command>` | **(Required)** Dev server command (e.g., `npm run dev`) |
| `--build-command <command>` | **(Required)** Build command (e.g., `npm run build`) |
| `--output-dir <dir>` | **(Required)** Build output directory (e.g., `dist`) |
| `--access <principals>` | Set access principals on creation (e.g., `visitor`, `orgRole:member`) |
| `--permissions <permissions>` | Set manual `dashboardView/database` permissions |

**Example:**

```bash
fusebase app create --name="My App" --subdomain=my-app --path=apps/my-app --dev-command="npm run dev" --build-command="npm run build" --output-dir=dist
```

If you later scaffold a backend into that app with:

```bash
fusebase scaffold --template backend --dir apps/my-app
```

the CLI creates `openapi.json` automatically if it does not already exist.

Magic-link activation is handled server-side by the platform at **`/_auth/magiclink/{key}`** (fusebase-gate activates the link, sets HttpOnly session cookies, and redirects). The `spa` feature template keeps a legacy **`/link`** route that only forwards old `/link?id={key}` email URLs to that endpoint — the SPA never activates links or writes session cookies via JS. See [`app-magic-links.md`](project-template/.claude/skills/fusebase-gate/references/app-magic-links.md).

**Updates `fusebase.json`:**

```json
{
  "orgId": "...",
  "productId": "...",
  "apps": [
    {
      "id": "app-id",
      "subdomain": "my-app",
      "name": "My App",
      "path": "apps/my-app",
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

`app create` writes the **platform-issued** `id` along with `subdomain` + `name`. That id comes
from the platform — never hand-author one yourself. To add an app **by hand** instead, write a
declarative entry with `subdomain`/`name`/`path` and **no `id`**, then run `fusebase deploy` —
reconcile resolves the id. See [Declarative `fusebase.json`](#declarative-fusebasejson).

---

### `fusebase dev start [app]`

Start the development server for an app. This command:

1. Starts the app's dev server (if `dev.command` is configured)
2. Starts the Fusebase dev server UI (port 4173)
3. Starts the API proxy server (port 4174)
4. Creates a per-session debug log folder under the selected app directory at `logs/dev-<timestamp>/`
5. Opens the dev UI in your browser

> If the selected app has no platform `id` yet, `dev start` first **reconciles** it — binds the
> `subdomain` to an existing platform app or **creates** one — then runs the dev server against
> that id and writes it back into `fusebase.json` (NIM-41996).

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `app` | No | App ID or path (from fusebase.json apps). If not provided, you'll be prompted to select one. |

**Options:** None

**Prerequisites:**

- App must be initialized (`fusebase init`)
- API key must be configured (`fusebase auth`)
- At least one app must be configured in `fusebase.json`

**Example:**

```bash
# Interactive app selection
fusebase dev start

# Start specific app by ID
fusebase dev start my-app-id

# Start specific app by path
fusebase dev start apps/dashboard
```

**Dev Server Components:**

| Component | Port | Description |
|-----------|------|-------------|
| Frontend UI | 4173 | React app that displays apps in iframes |
| API Proxy | 4174 | Proxies requests to Fusebase API with authentication |

**Per-session Debug Logs:**

Each `fusebase dev start` run creates a session folder inside the selected app directory:

```text
<app-dir>/logs/dev-<timestamp>/
  browser-logs.jsonl
  access-logs.jsonl
  backend-logs.jsonl
  frontend-dev-server-logs.jsonl
```

**App Token Flow:**

The dev server automatically handles app token delivery:
1. Fetches app tokens from the Fusebase API
2. Sends tokens to the app iframe via `postMessage`
3. Sets cookie `fbsapptoken` so same-origin app backend requests can authenticate without relying on a custom header
4. Your app receives the token:

```javascript
window.addEventListener('message', (event) => {
  if (event.data?.type === 'featuretoken' && event.data?.token) {
    // Use event.data.token for API calls
  }
});
```

For custom app backends (`/api/*`), treat `x-app-feature-token` as optional in deployed mode and read `x-app-feature-token` or cookie `fbsapptoken` on the server.

---

### `fusebase update`

One command to refresh a generated app after a CLI or template upgrade:

1. **CLI binary update** — runs first (skips automatically in local linked/source mode). Use **`--skip-cli-update`** to disable this stage. On Windows this is a **cache swap** (no admin elevation, no installer download): it updates the cached CLI under `%LOCALAPPDATA%\FuseBase\CLI\` and continues the remaining stages in the same run, just like macOS/Linux. See [`docs/WINDOWS_LAUNCHER.md`](docs/WINDOWS_LAUNCHER.md).
2. **Agent assets** — refreshes `AGENTS.md`, `.claude/skills/`, `.claude/agents/`, `.claude/hooks/`, `.claude/settings.json`.
3. **MCP + IDE** — selectively regenerates Dashboards and/or Gate MCP tokens and refreshes IDE configs when the CLI’s **permission policy** no longer matches **`.env`** markers `DASHBOARDS_MCP_POLICY_FP` and `GATE_MCP_POLICY_FP` (SHA-256 of the canonical permission sets; Gate includes `isolated-stores` extras when that global flag is on). Tokens must also be present in `.env`. Use **`--force-mcp`** to refresh both regardless.
4. **Managed SDK versions** — bumps only packages listed under `fusebaseCli.managedDependencies` in `project-template/package.json` (defaults to `@fusebase/dashboard-service-sdk` and `@fusebase/fusebase-gate-sdk`). Root `package.json` gets missing entries added; **app** `package.json` files are updated only if those deps already exist (nothing new is injected into apps).
5. **`npm install`** — runs **only** in directories where a managed dependency version actually changed.
6. **Gate permission drift (interactive)** — when `@fusebase/fusebase-gate-sdk` version changed and `npm install` completed, dry-runs SDK analysis per deployed app and compares runtime Gate permissions on the platform with what a fresh `--sync-gate-permissions` would publish. If drift is found, prompts (TTY) to run sync for all affected apps. Skipped on `--dry-run`, without auth, when Gate SDK unchanged, or with `--skip-gate-permissions-sync`.

**Pre-update Git checkpoint:** In a TTY, you are prompted for an optional commit before changes (empty commit if the tree is clean). If current branch tracks a remote (upstream configured), the pre-update commit is pushed immediately. Without Git, you are warned about rollback risk and can initialize a repo first. Use **`--skip-commit`** to skip, or **`--commit`** to run the checkpoint in CI/non-interactive mode without prompts.

**Prerequisites:** `fusebase.json` with `orgId` and `productId`; `fusebase auth` for stages that touch MCP tokens.

Behavior by directory:

- In an app directory (`fusebase.json` exists): runs full flow (CLI + app stages) in a single run on every platform (Windows updates via cache swap, no installer/exit).
- Outside an app directory: runs only CLI binary update.
- Use `--skip-product` to force CLI-only mode even inside an app directory.

**Windows launcher (`fusebase update --launcher`, `fusebase --previous-version`):** On Windows `fusebase.exe` is a stable launcher that runs the cached CLI. **`fusebase update --launcher`** refreshes that launcher via the elevated installer (the only path that elevates; Windows-only, no-op elsewhere). **`fusebase --previous-version`** runs the retained previous cached version for one invocation (escape hatch). Full model: [`docs/WINDOWS_LAUNCHER.md`](docs/WINDOWS_LAUNCHER.md).

**Examples:**

```bash
fusebase update
fusebase update --dry-run
fusebase update --skip-product
fusebase update --skip-skills --force-mcp
fusebase update --skip-install
fusebase update --skip-gate-permissions-sync
fusebase update --skip-commit
```

**Flags (stages default on; use `no-*` to disable):**

| Flag | Effect |
|------|--------|
| `--skip-product` | Skip app stages and run only CLI update |
| `--launcher` | Windows only: refresh the launcher (`fusebase.exe`) via the elevated installer (no-op elsewhere) |
| `--skip-cli-update` | Skip automatic CLI self-update stage |
| `--skip-skills` | Skip agent asset refresh |
| `--skip-mcp` | Skip MCP token + IDE refresh |
| `--force-mcp` | Always refresh MCP tokens + IDE configs |
| `--skip-deps` | Skip managed dependency version sync |
| `--skip-install` | After dep sync, do not run `npm install` |
| `--skip-gate-permissions-sync` | After a Gate SDK bump, skip interactive drift check and permission sync prompt |
| `--skip-commit` | Skip pre-update Git checkpoint |
| `--commit` | Run Git checkpoint without prompts (non-interactive) |
| `--dry-run` | Print planned work only |

`fusebase update` is the single update command.

---

### `fusebase sidecar`

Manage sidecar containers for an app backend or for a specific cron job. Sidecars are pre-built Docker images that run alongside the main container, sharing its network namespace (reachable on `localhost`). Stored in `fusebase.json` under `apps[].backend.sidecars[]` (backend) or `apps[].backend.jobs[].sidecars[]` (per cron job).

```bash
# Add a sidecar to the backend (default — same as today)
fusebase sidecar add --app <appPath> --name <name> --image <image> \
  [--port <port>] [--tier small|medium|large] [--env KEY=VALUE ...] \
  [--secret KEY|KEY:ALIAS ...]

# Add a sidecar to a specific cron job
fusebase sidecar add --app <appPath> --job <jobName> --name <name> --image <image> \
  [--port <port>] [--tier small|medium|large] [--env KEY=VALUE ...] \
  [--secret KEY|KEY:ALIAS ...]

# Remove a sidecar
fusebase sidecar remove --app <appPath> --name <name> [--job <jobName>]

# List configured sidecars
fusebase sidecar list --app <appPath> [--job <jobName>]
```

**Options:**

- `--app <appPath>` (required) — the app's `path` in `fusebase.json` (the declarative entry key; a platform `id` is only assigned at deploy-time reconcile). `--feature` (`-f`) is accepted as a deprecated alias.
- `--name <name>` (required for add/remove) — sidecar name. Lowercase letters, digits, and hyphens; max 63 chars; must start with a lowercase letter.
- `--image <image>` (required for add) — Docker image reference (e.g. `browserless/chrome:latest`)
- `--port <port>` — port the sidecar listens on (informational; `localhost:<port>` from the main container)
- `--tier small|medium|large` — resource tier (default: `small`)
- `--env KEY=VALUE` — environment variables, repeatable
- `--secret KEY|KEY:ALIAS` — whitelist an app secret key (registered via `fusebase secret create`) to inject into the sidecar as an env var, repeatable. Use `KEY:ALIAS` to expose the secret under a different env var name inside the sidecar. On collision between sidecar `env` and a secret key, the sidecar's static `env` value wins. Deploy fails with a `ValidationError` listing every missing key if any referenced secret is not registered for the app.
- `--job <jobName>` — attach the sidecar to the named cron job instead of the backend. Without `--job`, all three subcommands target backend sidecars exactly as today.

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

### `fusebase env …` — app environments (experimental, flag `environments`)

Named environment profiles let one project target several platform contexts —
e.g. `prod` (customer org), `prod-beta` (beta stage on the prod platform),
`dev` (dev platform org).

**Full guide: [docs/guides/environments.md](docs/guides/environments.md)**
(getting started, day-to-day commands, auth, env panel, fixtures, gotchas).
For existing apps, use the migration checklist:
[docs/guides/environment-migration.md](docs/guides/environment-migration.md).
Design rationale: [docs/proposals/APP-ENVIRONMENTS.md](docs/proposals/APP-ENVIRONMENTS.md).

- `environments/<name>.json` (committed) — the env lockfile: `backend`
  (`dev`|`prod`|`local`), `orgId`, `productId`, per-app resolved `id`,
  per-env `subdomain` / `subdomainSuffix` (subdomains are globally unique per
  backend), isolated-store ids by alias, `fixtures.testUsers`, `protected`.
- `.env.<name>` (gitignored) — per-env MCP tokens and secrets. The active
  env's file is **materialized into `.env`**, so IDE configs, the dev server,
  and app code keep reading the single `.env` they always did.
- Active env: `--env <name>` on any command > `FUSEBASE_ENV` >
  `.fusebase/state.json` (set by `env use`) > `defaultEnvironment` in
  fusebase.json > single-env auto-pick. Without an `environments/` dir
  everything behaves exactly as before (legacy mode).
- Auth is per backend: `auth.dev` / `auth.prod` in `~/.fusebase/config.json`
  (`fusebase auth [--dev]` binds a key to that backend; `FUSEBASE_API_KEY`
  overrides in CI).

| Command | Behavior |
|---------|----------|
| `fusebase env init [--name <n>] [--strip]` | Adopt environments: current fusebase.json context becomes the first env; `.env` → `.env.<name>`; `--strip` moves `apps[].id`/`storeId` out of the manifest |
| `fusebase env add [name] [--backend <dev\|prod>] [--org <orgId>] [--product <id>] [--subdomain-suffix <s>] [--protected]` | New env file; in a terminal, missing parameters are prompted interactively (org picked from the live org list of the chosen backend) |
| `fusebase env clone <from> <to> [--org] [--backend] [--subdomain-suffix]` | Copy structure/fixtures; platform ids cleared |
| `fusebase env use <name> [--tokens]` | Switch active env; offers re-auth for the backend and token refresh |
| `fusebase env list` / `env status` | Envs with backend/org/auth; active env detail incl. per-app id resolution and MCP token freshness |
| `fusebase env tokens [--env <name>]` | Write MCP tokens into `.env.<name>` (and materialize `.env` when active) |
| `fusebase env remove <name> [--yes]` (alias `delete`) | Remove the env's **local** files (lockfile + `.env.<name>`, clears active state); deployed product/apps on the platform are NOT deleted |
| `fusebase env strip [--into <name>]` | Move leftover env-specific ids (`apps[].id`, store `storeId`) from fusebase.json into an environment lockfile; ids unknown to every env are first recorded into the home env (matching org/product) or `--into` |

First deploy of a new environment bootstraps it: `fusebase deploy --env <name>`
creates the product (declarative flag required), binds/creates apps by their
env-effective subdomains, and writes resolved ids back into the env lockfile.
Deploy also bakes **`fusebase-env.json`** into the bundle — read by the
template's floating `EnvPanel` (staff/debug surface: env name, backend, org,
appId, links to counterpart deployments; `?envpanel=1` to show) and usable by
Playwright tests to assert they run against the intended stage.

`protected: true` marks production-like envs; `fusebase env use` prints a
warning banner for them.

---

### `fusebase isolated-store sql bundle`

Builds the Gate SQL migration request body from app-owned files and, when requested, calls Gate status/dry-run/apply using `GATE_MCP_TOKEN` from `.env`.

A matched app entry may be id-less (authored with only a `path`/`subdomain`), and its platform app may not exist yet. On **`--apply`** the command reconciles it first — exactly like `fusebase dev` start: it binds the subdomain to an existing platform app or creates one, then persists the resolved `id` back into `fusebase.json` — so migrations apply against a real app. Read-only operations never reconcile, to avoid creating/mutating the app as a side effect. In particular **`--status`** on a not-yet-deployed declarative app (no resolved `id`) returns a predefined status instead of erroring:

```json
{
  "appExists": false,
  "app": "apps/client-portal",
  "subdomain": "client-portal",
  "migrations": { "applied": [], "pending": [] },
  "message": "App is not deployed on the platform yet, so its isolated store has no migration status. Run `fusebase deploy` to provision it first."
}
```

Branch on `appExists` to tell "not deployed" apart from a real Gate status. Entries that already carry an `id` are used as-is with no reconcile.

This command is operator/CI tooling. Its `storeId` is allowed in `fusebase.json`, `--store-id`, command output, or handoff logs so migrations can target an exact Gate store/stage. Do not copy that `storeId` into app runtime secrets or env vars. Runtime app code should resolve Gate isolated stores through app scope/permissions and stable aliases, or use platform-provided bindings when available.

RLS manifests are experimental and are only attached when the `postgres-rls` flag is enabled. Without the flag, the command still builds/applies the SQL migration bundle but omits `rlsManifest`.

Use `--rls-status` to inspect the live PostgreSQL RLS posture for the selected store/stage. The response includes the runtime DB role and `bypassRls`; if `bypassRls=true`, policies may exist but PostgreSQL does not enforce them for runtime queries. `--apply --yes` also checks this after a successful apply and prints a warning when the runtime role bypasses RLS.

Expected app config in `fusebase.json`:

```json
{
  "apps": [
    {
      "id": "client-portal",
      "path": "apps/client-portal",
      "isolatedStores": {
        "sql": [
          {
            "alias": "client-portal",
            "storeId": "00000000-0000-0000-0000-000000000000",
            "migrationsDir": "postgres/migrations",
            "schemaName": "public",
            "rlsManifestFile": "postgres/migrations/rls-manifest.json"
          }
        ]
      }
    }
  ]
}
```

Commands:

```bash
# Print summary and checksum warnings
fusebase isolated-store sql bundle --app client-portal

# Print the exact Gate request body
fusebase isolated-store sql bundle --app client-portal --json

# Call Gate migration status / dry-run / apply
fusebase isolated-store sql bundle --app client-portal --stage dev --status
fusebase isolated-store sql bundle --app client-portal --stage dev --rls-status
fusebase isolated-store sql bundle --app client-portal --stage dev --dry-run
fusebase isolated-store sql bundle --app client-portal --stage dev --apply --yes
```

The migration manifest remains app-owned and environment-neutral. Stage state still lives in Gate's `fusebase_schema_migrations` journal and stage metadata.

To include `rlsManifest` in Gate status/dry-run/apply calls:

```bash
fusebase config set-flag postgres-rls
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
| `postgres-rls` | Enables experimental RLS manifest helpers for isolated SQL stores |
| `portal-specific-apps` | Includes portal-specific app guidance in prompts: `fusebase-portal-specific-apps` skill, `{{CurrentPortal}}` dashboard filter reference, and portal auth-context handling notes |
| `cross-app-api-calls-analysis` | Enables hidden `fusebase analyze app-apis` command and cross-app API dependency guidance in generated prompts/skills. |
| `environments` | Enables named app environments: `environments/<name>.json` + `.env.<name>`, the `fusebase env` command group, `--env <name>` on every command, per-backend auth. See [docs/proposals/APP-ENVIRONMENTS.md](docs/proposals/APP-ENVIRONMENTS.md). |
| `dev-backend` | Internal: shows the dev/prod platform-backend choice in interactive env prompts (`fusebase env add`). Off (default): interactive flows assume prod; explicit `--backend` always works. |

Enable a flag globally, then refresh the project template:

```bash
fusebase config set-flag app-business-docs   # Business-logic documentation skill
fusebase config set-flag mcp-gate-debug      # Gate MCP debug / improvement summary skill
fusebase config set-flag isolated-stores     # Isolated stores functionality (SQL/NoSQL)
fusebase config set-flag postgres-rls        # PostgreSQL RLS manifest helpers for isolated SQL stores
fusebase config set-flag portal-specific-apps # Portal-specific apps prompts/guidance
fusebase config set-flag cross-app-api-calls-analysis # Cross-app AppApisApi dependency analysis command/guidance
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
fusebase integrations list-templates   # requires managed-integrations flag
fusebase integrations connect-template --template-name github # requires managed-integrations flag; scopes to current appId

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
  "productId": "app-id",
  "apps": [
    {
      "subdomain": "my-app",
      "name": "My App",
      "path": "apps/my-app",
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

#### Backend replicas and cold starts (`backend.minReplicas`)

`apps[].backend.minReplicas` (`0..3`, default **`0`**) is the minimum number of backend replicas kept
running. With the default the backend **scales to zero when idle** and there is no post-deploy warm-up,
so the first request after idle or deploy pays a **cold start of up to ~10s** — give client requests a
timeout of **at least 15s** (platform ceiling 30s, CloudFront). Set `minReplicas: 1` for webhook /
always-on apps, where a cold start would exceed the provider's timeout; each warm replica runs 24/7, so
prefer `1`. `backend.maxReplicas` is **not supported** — deploy ignores it silently.

#### Declarative `fusebase.json`

`apps[]` is a **declarative manifest**. An app entry describes the app
(`subdomain`, `name`, `path`, `dev`, `build`) and **omits the platform app `id`** —
`fusebase deploy` resolves the id at deploy time. `productId` (the product id) stays
required.

| Field | Required | Notes |
|-------|----------|-------|
| `apps[].subdomain` | Yes (declarative) | Match key; the app's `{subdomain}.thefusebase.app` domain |
| `apps[].name` | Yes (declarative) | App title used when reconcile creates the app |
| `apps[].id` | No | **Legacy only.** Old apps keep a real `id`; never hand-author one |
| `apps[].path` | Yes | Local app directory |

**Deploy reconcile** — before deploying, the CLI resolves every entry to a real app id:

1. Entry has a legacy `id` → trust it as-is.
2. Else `subdomain` matches an existing platform app → **bind** to it.
3. Else → **create** the app from the declaration (`name` + `subdomain` + `path`).

`fusebase app create` is also declarative: it **only writes the `apps[]` entry** (no `id`, no
platform call) — the app is created on the first `fusebase deploy`. `--access`/`--permissions`
require a deployed app id, so apply them via `fusebase app update <appId>` after that deploy.

After a successful deploy, the resolved id is written back into the entry, so the next deploy
takes the legacy fast path. You still never hand-author one — the platform owns it.

> **Never invent or hand-write an app `id`.** The platform owns app ids. Writing your own
> `id` and then running `fusebase app create` causes a double-registration conflict (a freshly
> created platform app whose id ≠ the one in the file). Write a declarative record
> (`subdomain`/`name`/`path`, no `id`) and run `fusebase deploy` or `fusebase app create`.

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

3. **Configure** an app for development:
   ```bash
   fusebase app create
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
