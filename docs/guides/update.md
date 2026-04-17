# Update Guide (CLI + App)

This is the canonical update guide for Fusebase Apps CLI.

## Command Map

- `fusebase cli update` - update the CLI binary itself.
- `fusebase app update` - update the current app project.
- `fusebase update` - alias of `fusebase app update`.

Use `fusebase cli update` when you want newer CLI behavior.
Use `fusebase app update`/`fusebase update` when you want to refresh project files/config/deps.

## Main Scenarios

1. Upgrade CLI only:

```bash
fusebase cli update
```

2. Full project refresh (recommended after CLI/template changes):

```bash
fusebase update
```

3. Preview changes without writing:

```bash
fusebase update --dry-run
```

4. Refresh only MCP tokens/configs:

```bash
fusebase update --no-skills --no-deps
```

5. Refresh project but skip checkpoint commit:

```bash
fusebase update --no-commit
```

## `fusebase app update` Stages

Default flow:

1. Pre-update Git checkpoint commit (optional prompt in TTY).
2. Agent assets refresh (`AGENTS.md`, `.claude/skills`, `.claude/agents`, `.claude/hooks`, `.claude/settings.json`).
3. MCP refresh (Dashboards/Gate tokens in `.env`) + IDE MCP config refresh.
4. Managed dependency sync in root + feature `package.json`.
5. `npm install` only where managed dependency versions changed.
6. End-of-run summary block.

## `fusebase app update` Parameters

| Flag | Effect |
|---|---|
| `--no-skills` | Skip agent assets refresh |
| `--no-mcp` | Skip MCP token + IDE refresh stage |
| `--force-mcp` | Force MCP refresh even if policy markers are up to date |
| `--no-deps` | Skip managed dependency sync |
| `--no-install` | Skip `npm install` after dependency sync |
| `--no-commit` | Skip pre-update checkpoint commit |
| `--commit` | Force checkpoint in non-interactive mode |
| `--dry-run` | Print plan only, no writes |

## MCP Refresh Rules (App Update)

Source of truth: `.env` markers

- `DASHBOARDS_MCP_POLICY_FP`
- `GATE_MCP_POLICY_FP`

Refresh logic:

- If markers are missing/mismatched, relevant token(s) are refreshed.
- Dashboards and Gate are checked independently (selective refresh).
- IDE MCP config refresh runs when MCP stage performs a refresh.
- `--force-mcp` refreshes both regardless of markers.

Legacy compatibility:

- Old projects with no FP markers can be accepted by legacy fallback baseline.
- Once policy drift is detected, refresh writes current FP markers.

## Pre-update Commit and Push

- In TTY, user is prompted to create checkpoint commit.
- If branch has upstream tracking, commit is pushed immediately.
- If no Git repo, user gets warning and can initialize Git first.

Commit format:

- `chore(update): pre app update (<local timestamp>)`

## Managed Dependencies

- Managed package names come from `project-template/package.json`:
  - `fusebaseCli.managedDependencies`
- Root `package.json`: managed deps can be added/updated.
- Feature `package.json`: only update if managed dep already exists (no auto-add).
- `npm install` runs only in directories with actual managed version changes.

