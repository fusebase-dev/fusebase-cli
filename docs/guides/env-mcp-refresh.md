# Env MCP Refresh Rules

For full update flows and all update command parameters, see `docs/guides/update.md`.

## MCP policy source of truth

For MCP refresh decisions, source of truth is `.env` fingerprints:

- `DASHBOARDS_MCP_POLICY_FP`
- `GATE_MCP_POLICY_FP`

These are SHA-256 fingerprints for canonical token policy descriptors from `lib/mcp-token-policy.ts`:

- Dashboards: permissions + resource scope.
- Gate: permissions + resource scope, including `isolated-stores` additions when that global flag is enabled.

## When `app update` refreshes MCP tokens

In MCP stage (`--no-mcp` not used), `fusebase app update` refreshes relevant token(s) + IDE MCP configs when **any** of these is true:

- `--force-mcp` is provided
- MCP keys are missing in `.env`
- `DASHBOARDS_MCP_POLICY_FP` is missing or mismatched
- `GATE_MCP_POLICY_FP` is missing or mismatched

If all required MCP keys exist and both fingerprints match current CLI policy, MCP stage is skipped.

Legacy fallback for old projects (without FP keys): if `.env` has MCP token vars but no `*_MCP_POLICY_FP` keys, CLI accepts them without forced reissue while current policy still equals the legacy permission-only baseline. Once policy changes, refresh triggers and FP keys are written.

## What MCP refresh updates in `.env`

When refresh runs, CLI updates `.env` keys:

- `DASHBOARDS_MCP_URL` / `DASHBOARDS_MCP_TOKEN` (when dashboards token is refreshed)
- `GATE_MCP_URL` / `GATE_MCP_TOKEN` (when gate token is refreshed)
- `FUSEBASE_HOST`
- `FUSEBASE_APP_HOST`
- `DASHBOARDS_MCP_POLICY_FP`
- `GATE_MCP_POLICY_FP`

Then it refreshes IDE MCP configs for all presets (equivalent behavior to `fusebase config ide --force` across presets) when MCP refresh was triggered.

## `fusebase env create` behavior

`fusebase env create` uses the same policy logic for skip/update:

- With default force mode: always regenerates.
- With `--no-force`: skips only when MCP vars already exist **and** both policy fingerprints match current CLI policy.

Interactive (`TTY`) behavior after successful token regeneration:

1. Ask to refresh IDE MCP configs now.
2. If confirmed, run IDE refresh immediately.
3. If declined/cancelled, print manual next step:

```bash
fusebase config ide --force
```

Non-interactive mode:

- No prompt.
- No automatic IDE refresh.
- `.env` result only.
