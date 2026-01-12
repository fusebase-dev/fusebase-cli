# Fusebase Gate meta (`fusebaseGateMeta`)

This document describes how the CLI records **which Fusebase Gate SDK operations** your app uses and **which permission strings** the public API maps them to. The result is stored in the project’s **`fusebase.json`** under each feature’s **`fusebaseGateMeta`**.

For the full feature permission model, including `dashboardView`, `database`, `gate`, and `feature update --sync-gate-permissions`, see [PERMISSIONS.md](PERMISSIONS.md).

## Purpose

- **Discoverability**: One place to see Gate `usedOps` (SDK method names in use) and resolved **`permissions`** for authz / reviews.
- **Automation**: CI or scripts can run the analyzer and compare snapshots without parsing TypeScript by hand.
- **Alignment with the API**: Permission strings come from **`POST /v1/gate/resolve-operation-permissions`** (same contract the platform uses to interpret operations).

## Command

The flow is triggered by a **hidden** command (not shown in default `--help`):

```bash
fusebase analyze gate
# or, from the apps-cli repo:
bun index.ts analyze gate
```

Options:

| Option | Default | Meaning |
|--------|---------|--------|
| `--operations` | `true` | Run the Gate SDK scan (only mode implemented today). |
| `--json` | off | Print machine-readable JSON (includes `fusebaseGateMeta` fields when saved). |
| `--feature <featureId>` | off | Analyze only one feature; otherwise analyze all configured features with `path`. |

**Requirements**: `fusebase.json` in the project root (from `fusebase init`), `@fusebase/fusebase-gate-sdk` in `node_modules`, and a valid `tsconfig.json` that includes your app sources.

**API key**: Resolving permissions uses `~/.fusebase/config.json` → `apiKey`. If missing, the analyzer still writes `fusebaseGateMeta` but **skips** the resolve call and prints a warning (unless `--json`).

## What the analyzer does

1. **Allowlist** — Reads operation ids from the installed SDK (`node_modules/@fusebase/fusebase-gate-sdk/dist/apis/*.js`, `opId: "..."`).
2. **TypeScript usage** — Builds a program from your `tsconfig`, walks source files (excluding `node_modules` and `.d.ts`), and records **method names** called on values typed as **`OrgUsersApi` | `TokensApi` | `HealthApi` | `SystemApi`**.
3. **Snapshot** — Writes sorted **`usedOps`**, **`sdkVersion`**, and timestamps into the current feature’s **`fusebaseGateMeta`**.
4. **Resolve permissions** (conditional) — If this run **changed** the `usedOps` set compared to the previous snapshot, calls **`resolveGateOperationPermissions`** with the current `usedOps` and merges the returned **`permissions`** array into the snapshot.

Implementation lives in:

- `lib/gate-sdk-used-operations.ts` — discovery + printing
- `lib/commands/analyze.ts` — command wiring
- `lib/gate-sdk-analyze.ts` — shared analyze + resolve helper
- `lib/config.ts` — read/write `fusebaseGateMeta`, normalization, legacy migration
- `lib/api.ts` — `resolveGateOperationPermissions`

## `fusebase.json` shape

Current canonical location:

```json
{
  "features": [
    {
      "id": "feature-id",
      "path": "features/my-feature",
      "fusebaseGateMeta": {
        "usedOps": ["listTokens"],
        "permissions": ["token.read"]
      }
    }
  ]
}
```

Legacy top-level **`fusebaseGateMeta`** and **`gateSdkOperations`** are still **read** on load for migration and are removed on the next write.

Stable field order when the CLI writes JSON:

| Field | Type | Meaning |
|-------|------|--------|
| `sdkVersion` | `string \| null` | Version of `@fusebase/fusebase-gate-sdk` from its `package.json`. |
| `analyzedAt` | ISO string | When **`fusebase analyze gate`** last completed successfully. |
| `usedOpsChangedAt` | ISO string | Last time the **sorted** `usedOps` array differed from the previous snapshot. |
| `permissionsChangedAt` | ISO string (optional) | Last time the **sorted** `permissions` array **changed** after a resolve. Omitted until permissions exist. |
| `usedOps` | `string[]` | Sorted Gate operation ids in use (e.g. `listOrgUsers`, `createToken`). |
| `permissions` | `string[]` (optional) | Sorted permission strings from the resolve API for the **current** `usedOps`. Omitted until a successful resolve. |

### Why two “changed” timestamps?

- **`usedOpsChangedAt`** — Tracks **code** changes: you added/removed a Gate API call.
- **`permissionsChangedAt`** — Tracks **resolved permission set** changes. If you add an operation that does **not** require new permissions, the API may return the same set; then **`permissionsChangedAt` is not updated** (only **`usedOpsChangedAt`** moves).

This avoids implying “permissions changed” when only operations changed.

## Resolve behavior

Resolve runs when **both** are true:

- `usedOpsChangedAt === analyzedAt` (this run detected a change in `usedOps`), and  
- `usedOps.length > 0`.

If `usedOps` is unchanged, the CLI **copies** `permissions` and `permissionsChangedAt` from the previous snapshot (no redundant API call).

When **`usedOps` changes**, the previous **`permissions`** are cleared until a new resolve succeeds (stale permissions must not stay attached to a new operation set).

Inside **`updateGateSdkPermissionsInFusebaseJson`**, if the API returns a permission set **identical** to the one already stored (same sorted strings), **`permissionsChangedAt` is not bumped**.

## Shrinking lists

When you **remove** Gate calls from the app, `usedOps` **shrinks** on the next analyze: the written array is always the **full** current result, not a merge with history. If `usedOps` changes, old permissions are dropped until resolve runs again.

## Legacy migration

Older projects may have:

- Root key **`gateSdkOperations`** instead of **`fusebaseGateMeta`** — read and migrated on write.
- Inside the snapshot: **`used`** instead of **`usedOps`**, **`requiredPermissions`** or old **`permissions`** naming, **`changedAt`** instead of split timestamps — normalized when read.

**Canonical JSON** today uses **`fusebaseGateMeta`** with **`usedOps`**, **`permissions`**, **`usedOpsChangedAt`**, **`permissionsChangedAt`**.

## Internal scripts

`package.json` includes:

```json
"internal:gate-analyze": "bun index.ts analyze gate --operations"
```

## See also

- [Architecture](ARCHITECTURE.md) — project config overview
- [CLI](CLI.md) — general CLI reference
- `project-template/.claude/skills/fusebase-gate/` — Gate MCP/SDK usage for agents
