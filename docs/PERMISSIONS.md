# App Permissions

This document is the central reference for how app permissions work in `apps-cli`.

It covers:

- permission types supported by the CLI
- where permissions are stored
- the end-to-end workflow from local code to runtime tokens
- how `fusebase analyze gate` and `app update` interact
- what gets sent to `public-api`

For the low-level Gate snapshot format in `fusebase.json`, see [FUSEBASE_GATE_META.md](FUSEBASE_GATE_META.md).

## Source of truth

There are two different stores:

1. **Remote app permissions**  
   Canonical runtime permissions live on the platform in the app record (`app.permissions.items`).

2. **Local Gate analysis snapshot**  
   The CLI stores Gate SDK analysis results in `fusebase.json` under the specific app:

```json
{
  "apps": [
    {
      "id": "app-id",
      "path": "apps/my-app",
      "fusebaseGateMeta": {
        "usedOps": ["listTokens"],
        "permissions": ["token.read"]
      }
    }
  ]
}
```

`fusebaseGateMeta` is **not** the canonical permission store for the app. It is only the local Gate analysis snapshot used to help build the next `app update` request.

## End-to-end workflow

This is the full permissions path across `apps-cli`, `public-api`, `nimbus-ai`, and runtime:

```mermaid
flowchart TD
  A["App code in project"] --> B["dashboard/database permissions from --permissions"]
  A --> C["gate permissions from fusebase analyze gate"]

  C --> D["apps[].fusebaseGateMeta in fusebase.json"]
  B --> E["fusebase app create/update"]
  D --> E

  E --> F["apps-cli builds final permissions.items[]"]
  F --> G["public-api app create/update endpoint"]
  G --> H["nimbus-ai stores app.permissions.items"]

  H --> I["runtime token request for app"]
  I --> J["nimbus-ai returns dashboardToken + gateToken"]
  J --> K["app token / proxy auth in runtime"]
  K --> L["dashboard-service and gate-service requests"]
```

### What each layer owns

- `apps-cli`
  - parses manual `dashboardView/database` permissions
  - analyzes Gate SDK usage and stores local `fusebaseGateMeta`
  - fetches the current remote app during `app update`
  - builds one final `permissions.items[]` payload
- `public-api`
  - accepts the mixed permission payload
  - forwards it to `nimbus-ai`
- `nimbus-ai`
  - validates and stores `app.permissions.items`
  - later uses them to generate `dashboardToken` and `gateToken`
- runtime (`app-wrapper` / proxies)
  - requests a token for the app
  - forwards downstream bearer tokens to `dashboard-service` and `gate-service`

## Typical lifecycle

### 1. Create an app

Typical sequence for a new app:

1. `fusebase app create ...`
2. add app code
3. if the app uses Gate SDK, run `fusebase analyze gate --feature <featureId>`
4. push permissions with `fusebase app update <appId> --permissions="..." --sync-gate-permissions`

At creation time, the app may still have no permissions. That is normal. The canonical permission state appears only after create/update requests reach the platform.

### 2. Add or change dashboard/database access

If only resource permissions changed:

1. edit the manual `--permissions` DSL
2. run `fusebase app update <appId> --permissions="..."`
3. CLI keeps current remote `gate` permissions unchanged

### 3. Add or change Gate SDK calls

If only Gate usage changed:

1. edit app code
2. run `fusebase app update <appId> --sync-gate-permissions`
3. CLI analyzes the app path, updates local `fusebaseGateMeta`, keeps current remote `dashboardView/database`, and replaces remote `gate`

### 4. Change both in one pass

If both resource access and Gate usage changed:

1. edit app code
2. run `fusebase app update <appId> --permissions="..." --sync-gate-permissions`
3. CLI sends one full mixed replacement payload

## Runtime path

After permissions are stored on the platform, runtime uses them indirectly through app token generation:

1. runtime requests a token for a specific app
2. `nimbus-ai` reads stored `app.permissions.items`
3. `nimbus-ai` builds downstream service tokens from those permissions
4. runtime uses those service tokens when proxying calls to downstream services

Current downstream mapping:

- `dashboardView` / `database` contribute to `dashboardToken`
- `gate` contributes to `gateToken`

The important consequence is:

- `fusebase.json` is only local analysis state
- runtime permissions come only from the remote app record
- `app update` is the step that turns local intent into runtime behavior
- `deploy` publishes code only; it does not publish permissions

## Deploy and publish

`fusebase deploy` and `fusebase app update` do different jobs:

- `fusebase app update ...` updates the remote app record, including `permissions.items`
- `fusebase deploy` uploads files and creates a new app version

That means an app can be deployed successfully while still having:

```json
{
  "permissions": {
    "items": []
  }
}
```

In that state:

- the page may still load
- local development may still appear to work
- runtime access is not correctly published yet for dashboard/gate-backed apps

For release-ready behavior:

1. sync permissions with `app update`
2. then deploy code with `fusebase deploy`

If the app uses Gate SDK at runtime, `fusebase app update <appId> --sync-gate-permissions` is required before the app should be considered fully published.

## Permission types

The CLI understands three permission item types:

- `dashboardView`
- `database`
- `gate`

### `dashboardView`

Manual DSL:

```bash
dashboardView.<dashboardId>:<viewId>.read
dashboardView.<dashboardId>:<viewId>.read,write
```

API shape:

```json
{
  "type": "dashboardView",
  "resource": {
    "dashboardId": "dash_123",
    "viewId": "view_456"
  },
  "privileges": ["read", "write"]
}
```

### `database`

Manual DSL:

```bash
database.id:<databaseId>.read
database.alias:<databaseAlias>.read,write
```

API shape:

```json
{
  "type": "database",
  "resource": {
    "databaseId": "db_123"
  },
  "privileges": ["read"]
}
```

or

```json
{
  "type": "database",
  "resource": {
    "databaseAlias": "customers"
  },
  "privileges": ["read", "write"]
}
```

### `gate`

`gate` permissions are not entered through the `--permissions` DSL today.

They are derived from Gate SDK usage analysis:

1. `fusebase analyze gate`
2. CLI resolves used operation ids into permission strings via `POST /v1/gate/resolve-operation-permissions`
3. resolved strings are written into `apps[].fusebaseGateMeta.permissions`

When synced to the app, the CLI sends them as:

```json
{
  "type": "gate",
  "privileges": ["org.members.read", "token.write"]
}
```

## Commands

## `fusebase analyze gate`

Purpose:

- scans an app path for Gate SDK API calls
- writes `usedOps` and resolved `permissions` into `apps[].fusebaseGateMeta`

Current behavior:

- `--feature <featureId>` analyzes one app
- without `--app`, the CLI analyzes all configured apps with `path`
- analysis is scoped to `app.path`
- detects calls on full `*Api` instances **and** narrowed clients such as `Pick<AccessApi, "getMe">` (supported for analysis only — **do not use `Pick<>` in app production code**; use full API factories so grants stay aligned)
- warns when a resolve/sync would **remove** permissions that were previously in `fusebaseGateMeta.permissions`

This command only updates local `fusebase.json`. It does **not** update remote app permissions by itself.

## `fusebase app update <appId>`

This is the command that pushes permissions to the platform.

It supports three independent inputs:

- `--access`
- `--permissions`
- `--sync-gate-permissions`

### `--permissions`

`--permissions` updates only the manual resource permissions:

- `dashboardView`
- `database`

If `--sync-gate-permissions` is not passed, existing remote `gate` permissions are preserved.

### `--sync-gate-permissions`

`--sync-gate-permissions` does all of this for the current app:

1. runs Gate analysis for `app.path`
2. updates `apps[].fusebaseGateMeta`
3. resolves Gate operations into permission strings
4. replaces remote `gate` permissions with the analyzed set

If no Gate SDK calls remain in the app, the synced `gate` set becomes empty, so remote `gate` permissions are cleared.

If `--permissions` is not passed, existing remote `dashboardView/database` permissions are preserved.

### Backend-only Gate permissions

Runtime `gate` permissions are embedded in the browser-visible app token (`gst`).
Two categories are kept out of the browser and stored in
`manifest.backendOnlyGatePermissions` instead:

1. **Platform-fixed** (`isolated_store.rls.delegate`, `isolated_store.rls.bypass`) —
   always split out automatically by `splitGatePermissionStrings`. Not app-configurable
   (see [NIM-42003]).
2. **App-declared store permissions** (`isolated_store.*`) — opt-in via
   `--declare-backend-only-gate-permissions`.
3. **App-declared non-store permissions** — list in `fusebase.json` under
   `apps[].backendOnlyGatePermissions` (e.g. `org.members.read`, `portals.read` for gateway apps).
   Merged on `--sync-gate-permissions`. On sync the CLI **subtracts** every merged
   backend-only permission from the runtime `gate` set written to `app.permissions`, so a
   permission the analyzer re-emits (e.g. `getPortal` → `portals.read`) is stripped from the
   browser and lives only in `manifest.backendOnlyGatePermissions` (NIM-42264). The backend
   `/_token` mint still unions the manifest list back in for server-side calls.

#### `--declare-backend-only-gate-permissions` (opt-in, legacy-safe)

For **gateway apps** (the browser only calls the app's own `backend/`, which then
calls Gate with a server-minted token — the Ovation pattern), the app's store
permissions should never reach the browser `gst`. Passing this flag alongside
`--sync-gate-permissions`:

- moves analyzed `isolated_store.*` permissions out of runtime `gate` (control plane)
  and into `manifest.backendOnlyGatePermissions`
- leaves everything else (default sync) identical to the current prod CLI

```bash
fusebase app update <appId> --sync-gate-permissions --declare-backend-only-gate-permissions
```

Without the flag, if the app has a `backend/` folder and the synced set still
contains `isolated_store.*`, the CLI prints a warning suggesting the flag. The flag
requires `--sync-gate-permissions`.

`deploy` preserves `manifest.backendOnlyGatePermissions` when it republishes the
OpenAPI manifest, so app-declared store perms are not clobbered by a later deploy.

#### Clearing app-declared non-store extras (NIM-42223)

`apps[].backendOnlyGatePermissions` in `fusebase.json` is the declarative source of
truth for non-store extras:

- **field absent** — legacy/back-compat: on sync the CLI falls back to the remote
  manifest's existing extras (nothing to clear).
- **field present but empty (`[]`)** — explicit clear: on sync the extras are dropped
  (remote-manifest extras are **not** resurrected), the remote manifest is updated to
  the empty result, and the CLI **removes** the `backendOnlyGatePermissions` field from
  `fusebase.json`. A subsequent `--sync-gate-permissions` does not bring the cleared
  extras back unless they are declared again.
- **field present and non-empty** — merged as before and written back sorted.

Platform-fixed (`delegate`/`bypass`) and `--declare-backend-only-gate-permissions`
store perms are derived from analysis and are unaffected by clearing extras.

#### Validation of declared extras (NIM-42263)

On `--sync-gate-permissions`, declared `apps[].backendOnlyGatePermissions` entries
(or the remote-manifest fallback set, when the field is absent) are validated
against the known Gate permission vocabulary (`KNOWN_GATE_PERMISSIONS` in
`lib/permissions.ts` — the same catalog the Gate MCP token grants, plus the
platform-fixed `isolated_store.rls.*`). An unknown entry (e.g.
`not_a_real_permission.bogus.write`) fails the sync **before** anything is posted:
the CLI exits non-zero with an explicit error and nothing is written to the remote
manifest or `fusebase.json`. Valid extras such as `org.members.read`,
`portals.read`, and `isolated_store.read` pass unchanged.

### Final request shape

The backend receives one final replacement payload.

The CLI fetches the current remote app, replaces only the parts affected by flags, and sends one full `permissions.items[]` array.

That means:

- the backend does not need merge logic
- add/remove flows work through normal full replacement

### Behavior matrix

| Command | Result |
|--------|--------|
| `app update <id> --permissions="..."` | Replace `dashboardView/database`, keep current remote `gate` |
| `app update <id> --sync-gate-permissions` | Replace `gate`, keep current remote `dashboardView/database` |
| `app update <id> --permissions="..." --sync-gate-permissions` | Replace both sections in one request |
| `app update <id> --access="..."` | Change access only; permissions untouched |
| `app update <id> --access="..." --sync-gate-permissions` | Change access and replace `gate` |
| `app update <id> --sync-gate-permissions --declare-backend-only-gate-permissions` | Replace `gate` minus `isolated_store.*`, which move to `manifest.backendOnlyGatePermissions` |
| `apps[].backendOnlyGatePermissions` non-empty in `fusebase.json` | On sync, **merge** into `manifest.backendOnlyGatePermissions` (non-store extras such as `org.members.read`, `portals.read`) **and subtract them from runtime `gate`** so they never ship in `app.permissions` / browser gst (NIM-42264). Written back sorted to `fusebase.json` after sync. |
| `apps[].backendOnlyGatePermissions` **absent** from `fusebase.json` | Legacy: remote manifest extras are preserved (API-patch / Ovation pattern). |
| `apps[].backendOnlyGatePermissions: []` (declared empty) in `fusebase.json` | Explicit clear (NIM-42223): extras dropped, remote manifest updated to empty, field removed from `fusebase.json`; not resurrected on next sync. |
| `apps[].backendOnlyGatePermissions` contains an unknown Gate permission | On sync, **rejected** (NIM-42263): CLI fails fast with a non-zero exit and explicit error; nothing posted to the remote manifest. |

## `fusebase app create`

`app create` can send manual `--permissions` during creation.

For Gate permissions, the usual flow for a brand-new app is:

1. `fusebase app create ...`
2. add Gate SDK code
3. `fusebase app update <appId> --sync-gate-permissions`

If a local app entry with the same `path` already exists and already has `fusebaseGateMeta.permissions`, the create flow may include those `gate` permissions too. But the normal and explicit sync flow is `app update --sync-gate-permissions`.

## Full example

Example project config:

```json
{
  "apps": [
    {
      "id": "ylmqefvwpewz4cwm",
      "path": "apps/gate-demo",
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

Example lifecycle:

1. Developer adds dashboard usage and Gate SDK calls under `apps/gate-demo`
2. Developer runs:

```bash
fusebase app update ylmqefvwpewz4cwm \
  --permissions="dashboardView.dash_1:view_1.read;database.alias:customers.read" \
  --sync-gate-permissions
```

3. CLI:
   - reads the current remote app
   - analyzes `apps/gate-demo`
   - updates `apps[].fusebaseGateMeta`
   - builds one mixed `permissions.items[]` array
   - sends one `PATCH` request
4. `public-api` forwards the request to `nimbus-ai`
5. `nimbus-ai` stores the new permissions on the app
6. at runtime, app token generation uses those stored permissions to issue downstream service tokens

## Examples

Update only resource permissions:

```bash
fusebase app update feat_123 \
  --permissions="dashboardView.dash_1:view_1.read;database.alias:customers.write"
```

Sync only Gate permissions:

```bash
fusebase app update feat_123 --sync-gate-permissions
```

Update both resource permissions and Gate permissions in one request:

```bash
fusebase app update feat_123 \
  --permissions="dashboardView.dash_1:view_1.read,write;database.id:db_1.read" \
  --sync-gate-permissions
```

## Related files

- `lib/permissions.ts` — parse manual DSL and build final permission payloads
- `lib/commands/app-update.ts` — `app update` behavior
- `lib/commands/app-create.ts` — `app create` behavior
- `lib/commands/analyze.ts` — CLI entrypoint for Gate analysis
- `lib/gate-sdk-analyze.ts` — shared Gate analysis + resolve helper
- `lib/config.ts` — `fusebaseGateMeta` read/write logic
