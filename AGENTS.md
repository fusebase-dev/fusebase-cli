# AGENTS.md

This file provides guidance for AI agents working with the Fusebase Apps CLI codebase.

## Project Overview

Fusebase Apps CLI is a command-line tool built with TypeScript and Bun for managing Fusebase applications.

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **CLI Framework**: Commander.js
- **Config Storage**: JSON files in `~/.fusebase/`
- **Dev Server Frontend**: Vite + React
- **Dev Server Backend**: Bun HTTP server

## Project Structure

```
index.ts        # Main CLI entry point with all commands
package.json    # Project dependencies and scripts
tsconfig.json   # TypeScript configuration
lib/
  api.ts        # Fusebase API client functions
  dev-server/   # Local development proxy and logging sources
    server.ts   # Bun dev proxy server
  feature-templates.ts  # Feature template utilities
  template-engine.ts    # Eta template rendering for skills/AGENTS.md
  commands/
    init.ts     # Initialize command
    deploy.ts   # Deploy command
    dev.ts      # Development server commands
    feature.ts  # Feature list/create/update commands
    env.ts      # Env commands (env create)
    skills.ts   # Skills update command
  steps/
    ide-setup.ts      # IDE configuration setup
    create-env.ts     # .env file creation
dev-server/
  vite.config.ts
  src/
    App.tsx     # Dev UI for testing features in iframes
project-template/
  AGENTS.md     # Single source of truth for feature development
  .claude/skills/  # Feature development skills in agentskills format
    app-ui-design/SKILL.md  # UI/UX and visual design for generated app features
    file-upload/SKILL.md  # File upload guide
    fusebase-cli/SKILL.md  # CLI documentation
    fusebase-dashboards/SKILL.md  # MCP + dashboards/data; SDK discovery for runtime
    fusebase-gate/SKILL.md  # Gate MCP/SDK; orgs, users, platform ecosystem
    handling-authentication-errors/SKILL.md  # Auth error handling
feature-templates/  # Feature templates (copied only when selected)
  hello-world/  # Hello World template (React + Vite + SDK)
ide-configs/    # IDE-specific MCP configurations
```

## Running the CLI

```bash
bun index.ts [command]
```

## Available Commands

- `auth [--api-key <apiKey>]` - Start auth flow or set API key for authentication
- `version` - Print CLI version (from package.json)
- `init` - Initialize a new app in current directory (optional `--ide <preset>`: claude-code, cursor, vscode, opencode, codex, other; single choice; optional `--git` to initialize local Git and sync with configured GitLab remote; `--skip-git` to force-disable git init/sync for this run; optional `--git-tag-managed` to set `managed` topic in GitLab when app is managed; in interactive mode shows editable suggested repo name before sync; same behavior can be enabled globally with flag `git-init`)
- `git` - Initialize a local Git repository in the current directory (`fusebase git`) and sync an existing local repo with configured GitLab remote (`fusebase git sync` or `fusebase git --git-sync`); requires global config keys `gitlabHost`, `gitlabToken`, `gitlabGroup`; baseline `.gitignore` rules are ensured automatically
- `deploy` - Deploy features to Fusebase (runs lint then build per feature). Computes frontend/backend SHA-256 hashes and skips features whose frontend AND backend are unchanged; reuses the previous frontend bundle via `copyFrontendParams` when only the backend changed. Pass `--force` to override the skip and always re-upload + redeploy.
- `feature list` - List all features for the current app with their URLs
- `feature create` - Create and configure a feature (requires `--name`, `--subdomain`, `--path`, `--dev-command`, `--build-command`, `--output-dir`; optional `--access` for access principals e.g. `visitor`, `orgRole:member`; `--permissions` for manual `dashboardView/database` access)
- `feature update <featureId>` - Update feature settings (`--access`, `--permissions` for manual `dashboardView/database`, `--sync-gate-permissions` for Gate analyze + sync)
- `dev start` - Start the development server (creates per-session debug logs in the selected feature directory under `logs/dev-<timestamp>/`, including `browser-logs.jsonl`, `access-logs.jsonl`, `backend-logs.jsonl`, and `frontend-dev-server-logs.jsonl`)
- `env create` - Create or overwrite `.env` with Dashboards/Gate MCP tokens; in TTY offers immediate `config ide --force` refresh for all IDE MCP configs (or prints it as next step when declined)
- `secret create` - Create feature secrets with empty values (`--feature <id> --secret KEY:description`); prints URL to set values
- `update` - Single smart update command: in app directory runs full update flow (CLI self-update + agent assets + MCP/IDE + managed deps/install), outside app directory runs CLI binary update only; use `--skip-app` for CLI-only mode even inside app
- `config set-flag <flag>` - Enable an experimental flag (e.g. `server`, `mcp-beta`)
- `config remove-flag <flag>` - Disable an experimental flag
- `config flags` - Manage experimental flags (interactive selector in TTY; use `--list` for non-interactive output)
- `config ide` - Recreate IDE config in current project (optional `--ide <preset>`, `--force`)
- `config gitlab` - Get/set GitLab sync config in `~/.fusebase/config.json` (`gitlabHost`, `gitlabGroup`, `gitlabToken`); supports interactive setup, `--show`, and direct flags (`--host`, `--group`, `--token`)
- `integrations` - Configure optional MCP integrations (catalog + custom HTTP MCP in `fusebase.json`); `integrations add|disable|enable|remove`; `--no-prompt` skips checkbox
- `scaffold` - Scaffold a feature from a built-in template. Without options, lists available templates with descriptions. Use `--template <id> --dir <path>` to scaffold. Errors if any files would be overwritten. Templates: `spa` (React + Vite SPA, deployed directly into `<dir>`), `backend` (Node.js + Hono, deployed into `<dir>/backend/`). Backend can be scaffolded on top of an existing SPA — only the `backend/` subfolder must be absent.
- `sidecar add` - Add a sidecar container to a feature backend (`--feature <id> --name <name> --image <image> [--port <port>] [--tier small|medium|large] [--env KEY=VALUE...] [--secret KEY|KEY:ALIAS...] [--job <jobName>]`). Max 3 sidecars per scope. Pass `--job <jobName>` to attach the sidecar to a cron job instead of the backend; without `--job` the sidecar is added to the backend, as today. `--secret` (repeatable) whitelists app feature secret keys (registered via `fusebase secret create`) to inject as env vars into the sidecar; use `KEY:ALIAS` to expose the secret under a different env var name. On collision between sidecar `env` and a secret key, the sidecar's static `env` value wins. Deploy fails with a `ValidationError` if any referenced secret key is not registered for the feature.
- `sidecar remove` - Remove a sidecar container by name (`--feature <id> --name <name> [--job <jobName>]`). With `--job`, removes from the named cron job; without `--job`, from the backend.
- `sidecar list` - List configured sidecar containers for a feature (`--feature <id> [--job <jobName>]`). With `--job`, lists sidecars on that cron job; without `--job`, on the backend.

## Configuration

Config is stored in `~/.fusebase/config.json` (cross-platform via `os.homedir()`).

```json
{
  "apiKey": "...",
  "env": "dev",
  "updateChannel": "prod",
  "flags": ["mcp-beta"]
}
```

### Experimental Flags

Flags enable experimental features across all projects. Managed via `config set-flag` / `config remove-flag`.

| Flag | Effect |
|------|--------|
| `analytics` | Enable anonymous usage analytics (coding agent, model, OS stats). All stats/command logging is disabled by default and requires this flag. |
| `mcp-beta` | Unlocks optional MCP servers in the catalog that are gated behind this flag (`ide-configs/mcp-servers.ts`) |
| `scaffold` | Enables the `fusebase scaffold` command and its documentation |
| `git-init` | Makes `fusebase init` automatically run Git initialization + GitLab sync flow (equivalent to `--git`; can be disabled per run with `--skip-git`) and includes Git workflow skill files in generated apps |
| `git-debug-commits` | Enables strict traceability rules inside `git-workflow` skill: deploy preflight + dirty-tree guard, commit-per-fix, and SHA/tag references in debug/deploy reports |
| `app-business-docs` | Includes the `app-business-docs` skill: maintain `docs/en/business-logic.md` (English) describing app business logic, flows, and scenarios; refresh after logic changes or on demand |
| `mcp-gate-debug` | Includes the `mcp-gate-debug` skill: after Gate MCP sessions, produce a short debug summary (what worked, friction, improvements) with emphasis on isolated stores debugging |
| `isolated-stores` | Enables isolated stores functionality (SQL/NoSQL); includes supporting `fusebase-gate` references and `isolated_store.*` permissions in `fusebase env create` |
| `portal-specific-features` | Includes portal-specific feature prompts and references (`fusebase-portal-specific-features`, `{{CurrentPortal}}` filters, and auth-context guidance for portal runtime) |
| `api-exploration` | Includes the `api-exploration` skill: verify API endpoint behavior with temporary tokens and test scripts before writing feature code. Complements MCP discovery. |

After changing flags, run `fusebase update --skip-mcp --skip-deps --skip-cli-update --skip-commit` to regenerate template-driven project files. For `mcp-beta`, enable the flag and re-run `fusebase config ide` and/or `fusebase integrations` to refresh MCP configs.

Project-specific config is stored in `fusebase.json` in the project root:
```json
{
 "orgId": "...",
 "appId": "...",
 "features": [
 { "id": "feature-id", "path": "features/my-feature", "dev": { "command": "npm run dev" }, "build": { "command": "npm run build", "outputDir": "dist" }, "devUrl": "http://localhost:3000" }
 ]
}
```

### Feature Token Flow

Apps running in the iframe need a feature token to communicate with Fusebase APIs. The token flow:

1. Frontend fetches features from `/api/features` (includes `orgId`, `appId`)
2. When a feature is selected, frontend calls `POST /api/orgs/{orgId}/apps/{appId}/features/{featureId}/tokens`
3. API proxy forwards to Fusebase API with auth header
4. Dev tooling delivers the token to the feature runtime:
   - sends token to iframe via `postMessage`
   - sets cookie `fbsfeaturetoken` for same-origin runtime/backend requests
 ```javascript
 iframe.contentWindow.postMessage({ type: 'featuretoken', token: '...' }, '*')
 ```

Important: deployed app backends must not rely on `x-app-feature-token` alone. Platform proxies may strip that header on `/api/*`, so backend handlers should read `x-app-feature-token` or fallback to cookie `fbsfeaturetoken`.

### Reliable Token Delivery

The iframe may not always emit the `load` event reliably. Three strategies are used:

1. **Check ready state**: If `iframe.contentDocument.readyState === 'complete'`, send immediately
2. **addEventListener**: Listen for `load` event (more reliable than `onLoad` prop)
3. **Timeout fallback**: Retry every 500ms until `contentWindow` is available

The app in the iframe receives the token like this:
```javascript
window.addEventListener('message', (event) => {
 if (event.data?.type === 'featuretoken' && event.data?.token) {
 // Use event.data.token
 }
})
```

## Development Guidelines

1. Use async/await for all file operations
2. Follow the existing command pattern using Commander.js
3. Store all persistent configuration in `~/.fusebase/`
4. Provide user feedback with console output (use ✓ for success)
5. Handle errors gracefully with try/catch blocks

## Adding New Commands

```typescript
program
 .command("command-name")
 .description("Command description")
 .argument("<arg>", "Argument description")
 .action(async (arg: string) => {
 // Implementation
 });
```

## Testing Changes

```bash
bun index.ts --help # Verify command registration
bun index.ts <command> # Test specific command
```

### End-to-end tests

E2E tests that exercise the CLI against a real Fusebase environment live in
`test/e2e/` (separate `*.e2e.ts` suffix so they are excluded from the default
`bun test` run). They require `FUSEBASE_API_KEY`, `FUSEBASE_ENV`, and
`FUSEBASE_TEST_ORG_ID`. Run them with:

```bash
bun run test:e2e
```

See `test/e2e/README.md` for the full env-var matrix, GitLab CI variable
list, and the orphan-cleanup note.

## Documentation Updates

When modifying CLI commands (adding/removing options, changing behavior, or adding new commands), **always update** the corresponding documentation:

- `README.md` - Main CLI documentation with detailed command descriptions
- `AGENTS.md` - This file, update the Available Commands list
- `project-template/.claude/skills/fusebase-cli/SKILL.md` - User-facing CLI documentation that gets copied into new projects
- `project-template/AGENTS.md` - It may be updated as well, as it contains description of some commands
- `docs/PERMISSIONS.md` - Canonical feature permissions model (`dashboardView`, `database`, `gate`, analyze + sync flow)
- `docs/FUSEBASE_GATE_META.md` - When changing `fusebase analyze gate` or `fusebaseGateMeta` in `fusebase.json`

This ensures users have accurate documentation for the CLI features.

## API access

You can access the public API using the API key. The API spec is here https://public-api.{FUSEBASE_HOST}/openapi.json .

## Fusebase Gate analyze snapshot

The hidden command `fusebase analyze gate` writes **`fusebaseGateMeta`** into `fusebase.json` (used Gate SDK operations + resolved permissions). See **`docs/FUSEBASE_GATE_META.md`** for the full mechanism.

## Feature permissions

The canonical documentation for feature permission behavior now lives in **`docs/PERMISSIONS.md`**. Use it when changing:

- `feature create` / `feature update`
- manual `--permissions` parsing
- `--sync-gate-permissions`
- how the CLI merges local Gate analysis with remote feature permissions

Important behavioral rule:

- `deploy` publishes code only; it does not publish feature permissions
- runtime permissions appear on the remote feature only after `feature create/update`
- Gate-enabled features must run `feature update --sync-gate-permissions` before they should be treated as fully published

## Feature Development

**Dashboard SDK data in generated apps:** When authoring or reviewing template guidance, any runtime code that calls dashboard data SDK methods must follow `project-template/CLAUDE.md` and **`fusebase-dashboards/references/data-patterns.md`** plus `sdk_describe` — do not guess response shapes.

For guidance on developing Fusebase Apps features, see:
- **`project-template/AGENTS.md`** - Single source of truth for feature development
- **`project-template/.claude/skills/app-ui-design/SKILL.md`** - UI/UX and visual design for generated app features (shadcn/ui + Tailwind CSS v4)
- **`project-template/.claude/skills/fusebase-dashboards/SKILL.md`** - Dashboard MCP flow, dashboard data, and SDK discovery for runtime code
- **`project-template/.claude/skills/fusebase-portal-specific-features/SKILL.md`** - Guide for developing features that depend on the portal they are embedded in (enabled by flag `portal-specific-features`)
- **`project-template/.claude/skills/fusebase-gate/SKILL.md`** - Fusebase Gate MCP/SDK; orgs, user lists, tokens, and broader platform capabilities (e.g. email, automation) as exposed via Gate
- **`project-template/.claude/skills/file-upload/SKILL.md`** - File upload guide

**Important**: Features use MCP for discovery and SDK for execution.
