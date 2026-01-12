# Architecture Documentation

## Purpose & Scope

**Fusebase Apps CLI** is a command-line tool for managing Fusebase applications. It enables developers to:

- Authenticate with the Fusebase API
- Initialize new Fusebase apps in local directories
- Configure and develop features locally
- Deploy features to the Fusebase platform
- Run a local development server with integrated API proxy

**Target Users:**

- Developers building Fusebase applications
- Engineers onboarding to the Fusebase ecosystem
- AI-assisted development tools

**Problems Solved:**

- Streamlined local development workflow for Fusebase features
- Automated feature deployment with build pipeline integration
- Development server with automatic feature token injection and `fbsfeaturetoken` cookie setup
- Framework-agnostic feature development (auto-detects Vite, Next.js, React, etc.)

## Conceptual Model

For a detailed explanation of core concepts (apps vs projects, features vs code, MCP vs SDK), see [Conceptual Model: Apps, Features, and Data Access](CONCEPTS.md).

**Quick reference**:

- **App**: Server-side entity in Fusebase API (source of truth)
- **Local Project**: Directory with `fusebase.json` linking to an app
- **Feature Record**: Server-side entity representing a deployable unit
- **Feature Code**: Local source code that gets built and deployed
- **MCP**: Discovery and reasoning layer (for LLMs and developers)
- **SDK**: Execution layer (for feature code)

## High-Level Architecture

### Module Layout

```
apps-cli/
├── index.ts                    # CLI entrypoint (Commander.js setup)
├── lib/
│   ├── api.ts                  # Fusebase API client (HTTP requests)
│   ├── config.ts               # Configuration management (global + project; getFusebaseAppHost for deploy URLs)
│   ├── logger.ts               # Pino-based logging to ~/.fusebase/error.log
│   ├── dev-server/
│   │   ├── server.ts           # Dev server orchestration (API proxy)
│   │   ├── browser-debug.ts    # Browser log capture and HTML injection helpers
│   │   ├── dev-debug-logs.ts   # Per-session local dev logging utilities
│   │   ├── backend-output.ts   # Backend process output capture
│   ├── framework-detect.ts     # Framework detection from package.json
│   ├── feature-templates.ts   # Feature template utilities (list, copy)
│   └── commands/
│       ├── init.ts             # App initialization command
│       ├── deploy.ts           # Feature deployment command
│       ├── dev.ts              # Dev server command
│       ├── dev-feature.ts      # Feature creation/configuration command
│       └── steps/
│           ├── ide-setup.ts    # IDE config file generation
│           └── create-env.ts   # .env file creation
├── dev-server/                 # Dev UI frontend (Vite + React)
│   ├── src/                    # React app source
│   └── vite.config.ts          # Vite configuration
├── project-template/           # Template copied during `fusebase init`
│   ├── AGENTS.md               # Feature development guide
│   └── skills/                 # Development skills documentation
├── feature-templates/          # Feature templates (copied only when selected)
│   └── hello-world/            # Hello World template (React + Vite + SDK)
├── ide-configs/                # IDE configuration templates
└── package.json                # Dependencies and build scripts
```

### Main Execution Flow

1. **Entrypoint**: `index.ts` (shebang: `#!/usr/bin/env bun`)
   - Creates Commander.js `program`
   - Registers commands: `auth`, `init`, `deploy`, `dev`
   - Parses CLI arguments and routes to command handlers

2. **Command Execution**:
   - Each command is a `Command` instance from `commander`
   - Commands read config via `lib/config.ts`
   - Commands call API functions from `lib/api.ts`
   - Commands write to `fusebase.json` or `~/.fusebase/config.json`

3. **Dev Server Flow** (`fusebase dev start`):
   - Spawns feature's dev server (if `dev.command` configured)
   - Starts API proxy server (port 4174) via `lib/dev-server/server.ts`
   - Starts frontend server (port 4173) - Vite in dev, static in binary
   - Detects feature dev URL from stdout/stderr
   - Injects feature tokens via `postMessage` to iframe
   - Sets cookie `fbsfeaturetoken` for same-origin runtime/backend auth

## Command System

### Command Registration

Uses **Commander.js** (`commander` package). Commands are registered in `index.ts`:

```typescript
// Direct command registration
program.command("auth").action(...)

// Subcommand registration
program.addCommand(initCommand)  // from lib/commands/init.ts
program.addCommand(deployCommand) // from lib/commands/deploy.ts
program.addCommand(devCommand)    // from lib/commands/dev.ts
```

### Adding a New Command

**Step-by-step:**

1. **Create command file** in `lib/commands/`:

   ```typescript
   // lib/commands/my-command.ts
   import { Command } from "commander";

   export const myCommand = new Command("my-command")
     .description("Description of my command")
     .argument("[arg]", "Argument description")
     .option("--flag", "Flag description")
     .action(async (arg: string, options: { flag?: boolean }) => {
       // Implementation
     });
   ```

2. **Import and register** in `index.ts`:

   ```typescript
   import { myCommand } from "./lib/commands/my-command";

   program.addCommand(myCommand);
   ```

3. **Use shared utilities**:
   - `getConfig()` / `loadFuseConfig()` from `lib/config.ts` for config
   - `logger` from `lib/logger.ts` for logging
   - API functions from `lib/api.ts` for HTTP requests

4. **Handle errors**:
   - Use `console.error()` for user-facing errors
   - Use `process.exit(1)` for fatal errors
   - Use `logger.error()` for detailed error logging

## Configuration & Environment

### Config Sources

1. **Global Config** (`~/.fusebase/config.json`):
   - Path: `lib/config.ts` → `CONFIG_FILE`
   - Fields: `apiKey`, `env` (optional)
   - Read via: `getConfig()`
   - Written by: `fusebase auth` command

2. **Project Config** (`fusebase.json` in project root):
   - Fields: `orgId`, `appId`, `env?`, `features[]`
   - Optional per-feature field: `features[].fusebaseGateMeta` — Gate SDK operation scan + resolved permissions (see [Fusebase Gate meta](FUSEBASE_GATE_META.md))
   - Read via: `loadFuseConfig()`
   - Written by: `fusebase init`, `fusebase feature create`, `fusebase analyze gate`

3. **Environment Variables**:
   - `ENV`: Set to `"dev"` to use dev API endpoints
   - Can be set via CLI flag (`--dev`) or process.env

### Precedence Rules

Environment resolution (from `lib/config.ts` → `getEnv()`):

1. `~/.fusebase/config.json` → `env` field
2. `fusebase.json` → `env` field
3. `process.env.ENV`

API URL resolution (from `lib/api.ts` → `getBaseUrl()` returns public API base URL string):

- `env === "dev"` → `https://public-api.dev-thefusebase.com`
- `env === "prod"` → `https://public-api.thefusebase.com`
- `env === "local"` → `http://localhost:3000`

## Runtime Concerns

### Logging

- **Library**: Pino (`pino` package)
- **Location**: `~/.fusebase/error.log`
- **Level**: `debug` (all levels logged)
- **Usage**: Import `logger` from `lib/logger.ts`
- **Format**: JSON logs with structured fields

Example:

```typescript
import { logger } from "./logger";

logger.info("User action: %s", action);
logger.error("Error: %j", error);
logger.debug("Debug info: %s", data);
```

### Error Handling

- **User-facing errors**: `console.error()` + `process.exit(1)`
- **Detailed errors**: `logger.error()` (written to log file)
- **API errors**: Caught in try/catch, logged, then user message shown
- **Exit codes**: `0` for success, `1` for failure

### Telemetry/Analytics

**None currently implemented.** No telemetry or analytics collection.

## Integration Points

### MCP Integration (Planned)

**Location**: Would live in `lib/mcp/` or `lib/integrations/mcp.ts`

**Abstractions to hook into:**

- Config system: Extend `lib/config.ts` to store MCP server configs
- Command system: Add `fusebase mcp` subcommand for MCP server management
- Dev server: Inject MCP server endpoints into API proxy routes
- Project template: Include MCP config templates in `ide-configs/`

**Integration points:**

- `lib/config.ts`: Add `mcpServers[]` to `FuseConfig`
- `lib/dev-server/server.ts`: Add MCP proxy routes to API server
- `lib/commands/init.ts`: Writes required MCP IDE configs during init (`ide-configs/mcp-servers.ts`, flags); optional MCP via `fusebase integrations`

### SDK Integration (Planned)

**Location**: Would live in `lib/sdk/` or as a separate package

**How HTTP client/config/auth will be provided:**

- HTTP client: Reuse `fetch` API (already used in `lib/api.ts`)
- Config: Extend `lib/config.ts` to expose SDK-friendly config getters
- Auth: Expose `getApiKey()` helper that reads from `~/.fusebase/config.json`
- Environment: Expose `getBaseUrl()` from `lib/api.ts` (public API base URL) for SDK initialization

**Integration points:**

- `lib/api.ts`: Refactor into SDK-compatible client class
- `lib/config.ts`: Add SDK config export functions
- Commands: Use SDK client instead of direct `fetch` calls

## Dashboard API Access Layers

apps-cli interacts with Dashboard Service through MCP + SDK:

### MCP + SDK

- **MCP provides**:
  - Tool discovery (`tools_list`, `tools_search`)
  - Safe execution via promptGroups
- **SDK**:
  - Generated from TypeScript contracts
  - Mirrors MCP tools 1:1 by operation id
  - Used for runtime execution in feature code

## How LLM Discovers Capabilities

LLM awareness in apps-cli is based on MCP metadata.

### Discovery Sources

- **MCP tools**:
  - `tools_list`: Lists all available tools
  - `tools_search`: Searches tools by query
  - `tools_describe`: Gets detailed tool schema
- **Each tool exposes**:
  - Input schema (parameters, types, validation)
  - HTTP mapping (method, path, headers)
  - Required prompt groups (permissions/context)

### Discovery → Implementation Flow

1. **Discovery Phase** (MCP):
   - LLM queries MCP: `tools_list()` or `tools_search("operation")`
   - Reviews tool schemas, descriptions, and requirements
   - Understands available operations and their parameters

2. **Planning Phase**:
   - LLM reasons about which operations to use
   - Understands data flow and dependencies
   - Plans implementation approach

3. **Implementation Phase** (SDK):
   - LLM writes feature code using SDK methods
   - SDK methods mirror MCP tools by operation ID
   - Same schemas, same endpoints, different execution context

### Prompt Context

- **`bootstrap` prompt explains**:
  - Difference between MCP tools and SDK methods
  - When to use MCP vs SDK
  - Discovery happens via MCP, execution happens via SDK
- **Tool descriptions include**:
  - Prompt invariants (required context)
  - Hints about SDK mirrors (operation IDs)
  - Guidance on when to use each operation

### What LLMs Should NOT Do

**❌ Do NOT guess endpoints**:

- Don't construct HTTP URLs manually
- Don't assume endpoint patterns
- Always use MCP discovery to find correct operations

**❌ Do NOT use MCP tools in feature code**:

- MCP tools are for discovery/reasoning only
- Feature code must use SDK methods
- MCP tools are called by the LLM/IDE, not by feature code

**❌ Do NOT hardcode IDs**:

- Database, dashboard, view IDs must be discovered
- Use `explore-databases.ts` or MCP discovery tools
- Document discovered IDs as constants in feature code

### MCP + SDK Approach

MCP + SDK provides **self-describing** capabilities.
LLM awareness is built-in through:

- MCP tool discovery (`tools_list`, `tools_search`, `tools_describe`)
- Automatic schema discovery
- Unified discovery and execution model

## Development Workflow

### Install

```bash
# Clone repository
git clone <repo-url>
cd apps-cli

# Install dependencies (Bun)
bun install
```

### Build

From `package.json`:

```bash
# Pre-build: Create zip files for embedded assets
bun run prebuild
# - Zips project-template/ → project-template.zip
# - Zips feature-templates/ → feature-templates.zip
# - Zips ide-configs/ → ide-configs.zip
# - Builds dev-server frontend → dev-server-dist.zip

# Build: Compile to binaries
bun run build
# - Compiles index.ts + embedded zips to:
#   - build/fusebase-macos (darwin-arm64)
#   - build/fusebase (linux-x64)
#   - build/fusebase.exe (windows-x64)
```

### Test

**No test suite currently configured.** No `test` script in `package.json`.

### Lint

The **project template** includes ESLint (flat config in `eslint.config.mjs`), a `lint` script in `package.json`, and devDependencies (`eslint`, `typescript-eslint`, etc.). `fusebase deploy` runs `npm run lint` for each feature that has a `lint` script before running the build.

### Release/Publish

**Not documented in package.json.** No `publish` or `release` scripts.

**Build artifacts:**

- Compiled binaries in `build/` directory
- Binaries are platform-specific (macOS ARM, Linux x64, Windows x64)

## Appendix

### Key Entrypoints

| Path                          | Purpose                                     |
| ----------------------------- | ------------------------------------------- |
| `index.ts`                    | CLI entrypoint, command registration        |
| `lib/api.ts`                  | Fusebase API client (all HTTP requests)     |
| `lib/config.ts`               | Configuration management (global + project) |
| `lib/commands/init.ts`        | App initialization logic                    |
| `lib/commands/deploy.ts`      | Feature deployment logic                    |
| `lib/commands/dev.ts`         | Dev server orchestration                    |
| `lib/commands/dev-feature.ts` | Feature creation/configuration command      |
| `lib/dev-server/server.ts`    | Dev server implementation (API proxy)       |
| `lib/framework-detect.ts`     | Framework detection from package.json       |
| `lib/feature-templates.ts`    | Feature template utilities (list, copy)     |

### Glossary

- **Feature**: A deployable unit in a Fusebase app (e.g., a dashboard, form, widget)
- **Feature Token**: Authentication token for a feature to call Fusebase APIs
- **Feature Template**: Pre-built feature starter (e.g., Hello World app) that can be selected during `fusebase feature create`
- **Dev Server**: Local development environment (frontend UI + API proxy)
- **API Proxy**: Server that forwards requests to Fusebase API with auth headers
- **Fusebase Config**: Project-specific config in `fusebase.json`
- **Global Config**: User-specific config in `~/.fusebase/config.json`
- **Embedded Files**: Zip files bundled into compiled binary (project template, feature templates, dev-server dist, IDE configs)

### Troubleshooting

**Top 5 Gotchas:**

1. **Config not found**: Ensure `fusebase init` has been run (creates `fusebase.json`). Global config is auto-created on first `fusebase auth`.

2. **API key errors**: Run `fusebase auth` to set API key. Check `~/.fusebase/config.json` exists and contains `apiKey` field.

3. **Dev server port conflicts**: Dev server auto-finds available ports starting from 4173/4174. If ports are in use, kill existing processes or change ports in code.

4. **Feature token not received**: Ensure feature iframe listens for `postMessage` with `type: 'featuretoken'`. Check browser console for token delivery.

5. **Build failures on deploy**: Ensure `build.command` and `build.outputDir` are correctly configured in `fusebase.json`. Check that build output directory exists and contains files.

**Common Issues:**

- **"App not initialized"**: Run `fusebase init` in project directory
- **"No API key configured"**: Run `fusebase auth <api-key>`
- **"No features configured"**: Run `fusebase feature create` to configure at least one feature
- **Dev server URL not detected**: Manually enter URL in dev UI if auto-detection fails
- **Binary mode vs dev mode**: In development, dev-server uses Vite with HMR. In compiled binary, serves prebuilt static assets from embedded zip.
