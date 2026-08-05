# Update Guide (CLI + App)

This is the canonical update guide for Fusebase Apps CLI.

## Command Map

- `fusebase update` - single smart update command:
  - in app directory (`fusebase.json` exists): runs full update flow,
  - outside app directory: runs CLI binary update only.

## Main Scenarios

1. Upgrade CLI only (works from any directory):

```bash
fusebase update --skip-product
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
fusebase update --skip-skills --skip-deps
```

5. Refresh project but skip checkpoint commit:

```bash
fusebase update --skip-commit
```

## `fusebase update` Stages

Default flow:

1. CLI binary self-update, unless disabled or local linked mode.
2. Pre-update Git checkpoint commit (optional prompt in TTY).
3. Agent assets refresh (`AGENTS.md`, `.claude/skills`, `.claude/agents`, `.claude/hooks`, `.claude/settings.json`).
4. MCP refresh (Dashboards/Gate tokens in `.env`) + IDE MCP config refresh.
5. Managed dependency sync in root + app `package.json`.
6. `npm install` only where managed dependency versions changed.
7. Gate permission drift check (when Gate SDK changed).
8. Post-update Git commit when the tree is dirty (optional prompt in TTY; always notifies).
9. End-of-run summary block.

## `fusebase update` Parameters

| Flag | Effect |
|---|---|
| `--skip-product` | Skip app stages entirely (CLI update only) |
| `--skip-cli-update` | Skip automatic CLI self-update stage |
| `--skip-skills` | Skip agent assets refresh |
| `--skip-mcp` | Skip MCP token + IDE refresh stage |
| `--force-mcp` | Force MCP refresh even if policy markers are up to date |
| `--skip-deps` | Skip managed dependency sync |
| `--skip-install` | Skip `npm install` after dependency sync |
| `--skip-commit` | Skip pre- and post-update checkpoint commits |
| `--commit` | Force pre/post checkpoints in non-interactive mode |
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

## Pre- and Post-update Commit and Push

**Pre-update**

- In TTY, user is prompted to create checkpoint commit (empty commit if the tree is clean).
- If branch has upstream tracking, commit is pushed immediately.
- If no Git repo, user gets warning and can initialize Git first.
- Commit format: `chore(update): pre app update (<local timestamp>)`

**Post-update**

- After all update stages, if the working tree is dirty, the CLI always prints the changed paths.
- In TTY (or with `--commit`), prompts to create a post-update commit of those changes (no empty commit).
- Upstream push uses the same rule as pre-update.
- `--skip-commit` skips creating the commit but still prints the dirty-tree notification.
- Commit format: `chore(update): post app update (<local timestamp>)`
- `.env` stays gitignored; MCP token refreshes are not committed.

## Managed Dependencies

- Managed package names come from `project-template/package.json`:
  - `fusebaseCli.managedDependencies`
- Root `package.json`: managed deps can be added/updated.
- App `package.json`: only update if managed dep already exists (no auto-add).
- `npm install` runs only in directories with actual managed version changes.

