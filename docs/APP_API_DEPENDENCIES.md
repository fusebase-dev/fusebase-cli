# App API Dependencies Meta (`fusebaseAppApiDependenciesMeta`)

This document describes how the CLI records **cross-app API dependencies** detected from runtime TypeScript code. The snapshot is stored in `fusebase.json` under each app's `fusebaseAppApiDependenciesMeta`.

This flow is gated by feature flag `cross-app-api-calls-analysis`.

## Command

Hidden analyzer command:

```bash
fusebase config set-flag cross-app-api-calls-analysis
```

```bash
fusebase analyze app-apis
fusebase analyze app-apis --sync
fusebase analyze app-apis --sync --force
```

Options:

| Option | Meaning |
|---|---|
| `--feature <featureId>` | Analyze only one app; otherwise analyze all apps with `path`. |
| `--json` | Print machine-readable JSON output. |
| `--sync` | After local snapshot write, sync the full current `dependencies` set to `PUT /v1/orgs/{orgId}/products/{productId}/apps/{appId}/app-api-dependencies`. |
| `--force` | Requires `--sync`. Sync even when `dependencies` are unchanged on this run (repair/reconciliation mode). |

## Detection scope (current)

The analyzer currently detects dependencies from calls on Gate SDK `AppApisApi.callAppApi(...)` where it can statically resolve:

- `path.orgId`
- `path.appId`
- `path.operationId`

It supports:

- string literals
- `as const` string literals
- local `const` variables
- imported `const` variables
- simple const object property access

If a call is detected but those values cannot be resolved, the call is added to `unresolved` with reason + file position.

## `fusebase.json` shape

```json
{
  "apps": [
    {
      "id": "caller-app-id",
      "fusebaseAppApiDependenciesMeta": {
        "sdkVersion": "2.2.15-sdk.6",
        "analyzedAt": "2026-05-22T12:37:39.328Z",
        "dependenciesChangedAt": "2026-05-22T12:37:39.328Z",
        "unresolvedChangedAt": "2026-05-22T12:37:39.328Z",
        "dependencies": [
          {
            "targetOrgId": "u8wk",
            "targetAppId": "x61lirs4igylyygz",
            "operationId": "listTasks",
            "source": "static"
          },
          {
            "targetOrgId": "u8wk",
            "targetAppId": "x61lirs4igylyygz",
            "operationId": "createTask",
            "source": "manual"
          }
        ],
        "unresolved": []
      }
    }
  ]
}
```

## Merge behavior

On each `analyze app-apis` run:

- existing `dependencies` with `source: "manual"` are preserved
- detected static dependencies are written as `source: "static"`
- previous static dependencies are replaced by the current detected set
- both `dependencies` and `unresolved` are sorted and deduplicated deterministically

This guarantees stale static entries are removed when code usage is removed.

## Remote sync behavior

Remote sync is opt-in and runs only with `--sync`.

- default `--sync`: sync only apps where `dependenciesChangedAt === analyzedAt`
- `--sync --force`: sync all analyzed apps regardless of local change detection
- synced payload is always the full current `dependencies` set (including preserved `source: "manual"` entries)

## Changed-at semantics

- `dependenciesChangedAt` updates only when the normalized dependency set changes.
- `unresolvedChangedAt` updates only when the normalized unresolved set changes.
- `analyzedAt` updates on every successful run.

## Unresolved reasons

Examples of reasons:

- `dynamic-arguments`
- `missing-path`
- `dynamic-path`
- `missing-orgId` / `dynamic-orgId`
- `missing-appId` / `dynamic-appId`
- `missing-operationId` / `dynamic-operationId`

Unresolved entries are diagnostics only. They are not converted to dependency edges automatically.

## Manual dependencies

When a call is dynamic by design, declare dependency manually by adding an entry to:

- `apps[].fusebaseAppApiDependenciesMeta.dependencies[]` with `source: "manual"`

Manual entries are preserved on future analyzer runs.

CLI helper flow:

```bash
fusebase analyze app-apis --feature <consumerAppId>
fusebase app-api-contracts unresolved --app <consumerAppId>
fusebase app-api-contracts add-manual-dependency --app <consumerAppId> --provider <providerAppId> --operation <operationId>
```

Notes:

- `add-manual-dependency` defaults `targetOrgId` to project `fusebase.json` `orgId`
- once the manual dependency exists, `fusebase app-api-contracts scaffold ...` can generate the matching draft consumer contract
