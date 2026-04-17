# Universal Project Update Command (Proposal)

## Goal

Add a single command that safely refreshes a Fusebase app project in one run:

1. Update agent assets (AGENTS.md + `.claude/*`).
2. Regenerate MCP tokens (`.env`) and refresh IDE MCP configs.
3. Update CLI-managed SDK dependencies from `project-template/package.json` in:
   - app root `package.json`
   - feature-level `package.json` files (from `fusebase.json.features[].path`)
4. Run package manager install where dependency changes were applied.
5. Offer a pre-update commit when project is a Git repo and working tree is dirty.

The command must not overwrite user-owned dependencies or scripts.

---

## Proposed Command

`fusebase app update`

Alternative naming if we prefer consistency with existing command groups:

- `fusebase project update`
- `fusebase update project`

This proposal uses `fusebase app update`.

---

## Default Behavior

Running `fusebase app update` with no flags performs all update stages in this order:

1. Preflight checks (`fusebase.json`, auth prerequisites for token refresh).
2. Pre-update Git commit prompt (when applicable).
3. Skills/agents refresh.
4. MCP token refresh + IDE config refresh.
5. Managed dependency refresh in root + feature package manifests.
6. `npm install` in each changed package location.
7. Summary output with changed files/paths.

---

## Flags (Unified Format)

Use one boolean style everywhere: `--<stage>` / `--no-<stage>`.

- `--skills` / `--skip-skills` - enable/disable AGENTS/skills/hooks/settings refresh.
- `--mcp` / `--skip-mcp` - enable/disable MCP stage (`.env` token + IDE refresh).
- `--force-mcp` - force MCP token + IDE refresh even when version trigger says "no update needed".
- `--deps` / `--skip-deps` - enable/disable managed dependency sync in `package.json`.
- `--install` / `--skip-install` - enable/disable `npm install` after deps sync.
- `--commit` / `--skip-commit` - enable/disable pre-update commit prompt.
- `--dry-run` - print planned actions and target files without writing.

Default values:

- `skills=true`
- `mcp=true`
- `deps=true`
- `install=true` (applies only when `deps=true`)
- `commit=true` in TTY, `commit=false` in non-interactive mode

Optional (phase 2):

- `--features-only` - update only feature package manifests.
- `--root-only` - update only root package manifest.

---

## Execution Plan (Detailed)

## 1) Preflight

- Ensure current directory contains `fusebase.json`.
- Load global config (`~/.fusebase/config.json`) and app config (`fusebase.json`).
- If MCP stage is enabled:
  - require `apiKey` in global config
  - require `orgId` and `appId` in `fusebase.json`

Failure policy:

- Hard-fail only for enabled stages.
- If user explicitly skipped a stage, missing prerequisites for that stage do not fail command.

## 2) Pre-update Git Commit Prompt

If `commit=true` (for example, default TTY mode or explicit `--commit`):

- Detect Git repo presence.
- If repo does not exist:
  - print warning that running update without Git can lead to unrecoverable data loss if update fails or manual rollback is needed
  - prompt: initialize Git and create pre-update commit first?
  - if user agrees:
    - run git init flow
    - create baseline commit before any update mutations
  - if user declines:
    - require explicit confirmation to continue without Git
- If repo exists:
  - prompt to create automatic pre-update commit
  - if working tree has changes (`git status --porcelain` not empty):
    - create regular commit of current changes
  - if working tree is clean:
    - create empty commit (`git commit --allow-empty`) as an update checkpoint
  - commit message must include both marker and timestamp, for example:
    - `chore(update): pre app update (2026-04-16 14:23:10 +0300)`

Safety:

- Do not force commit.
- If commit fails, stop before mutating project files.

## 3) Skills / Agent Assets Update

Reuse existing implementation:

- Call `copyAgentsAndSkills(cwd)` (current `fusebase skills update` behavior).
- This preserves current flag gating logic and Eta rendering.

Targets:

- `AGENTS.md`
- `.claude/skills/`
- `.claude/agents/`
- `.claude/hooks/`
- `.claude/settings.json`

## 4) MCP Token + IDE Refresh

Reuse existing building blocks:

- Compute expected **policy fingerprints** for Dashboards and Gate MCP token requests (permissions + resource scopes + Gate `isolated-stores` flag); see `lib/mcp-token-policy.ts`.
- Read stored values from project `.env`: `DASHBOARDS_MCP_POLICY_FP`, `GATE_MCP_POLICY_FP`.
- Decision:
  - if either fingerprint is missing or differs from expected -> run MCP refresh (regenerates **both** tokens)
  - if both match -> skip MCP refresh by default
  - if `--force-mcp` set -> always run MCP refresh
- MCP refresh action:
  - `.env`: call `createEnvFile(..., force: true)` to regenerate MCP tokens and rewrite MCP keys + both fingerprint keys.
  - IDE config: call `setupIdeConfig(..., force: true)` for all presets.

Notes:

- This intentionally mirrors `fusebase env create` + `fusebase config ide --force`.
- Keep existing `.env` merge behavior (preserve unrelated environment variables).
- `fusebase env create` without `--no-force` also skips when tokens exist **and** fingerprints still match; missing/outdated fingerprints triggers refresh.
- `--force-mcp` is the safety override when users want guaranteed refresh.

## 5) Managed Dependency Sync

### 5.1 Source of truth

Keep the managed package allowlist near the template (not hardcoded in command code).

Proposed metadata location: `project-template/package.json`, for example:

```json
{
  "fusebaseCli": {
    "managedDependencies": [
      "@fusebase/dashboard-service-sdk",
      "@fusebase/fusebase-gate-sdk"
    ]
  }
}
```

Version source remains `project-template/package.json` -> `dependencies`.

Phase 1 managed set:

- `dependencies["@fusebase/dashboard-service-sdk"]`
- `dependencies["@fusebase/fusebase-gate-sdk"]`

These are the minimum managed dependencies for phase 1.

### 5.2 Target manifests

Collect package manifests:

1. Root: `<cwd>/package.json` (if exists).
2. Features: for each `features[].path` from `fusebase.json`, include `<cwd>/<feature.path>/package.json` if exists.

### 5.3 Merge algorithm (non-destructive)

For each target `package.json`:

- Parse JSON.
- For each managed dependency:
  - if present with different version -> update version only
  - if missing:
    - root `package.json`: add dependency with template version
    - feature `package.json`: do not add (only update if already present)
- Preserve all other keys unchanged:
  - scripts
  - devDependencies
  - user dependencies
  - package manager metadata

Write file only if changed.

This prevents overwriting user-specific dependencies and avoids full manifest replacement.

## 6) Install Step

If `--skip-install` is not set:

- Run `npm install` only in directories where managed dependency versions were actually changed.
- Default to sequential execution for predictable logs and easier failure diagnostics.

Failure policy:

- If install fails in one location, continue remaining locations and report failures at the end.
- Exit non-zero if any install failed.

---

## Output / UX

Final summary should include:

- stages executed/skipped
- files updated by skills stage
- `.env` create/update status
- IDE targets refreshed
- manifests changed (root + feature paths)
- install results per location
- pre-update commit SHA (if created)

Example summary headings:

- `Pre-update commit`
- `Agent assets`
- `MCP tokens and IDE`
- `Managed dependencies`
- `Install results`

---

## Implementation Structure

Recommended files:

- `lib/commands/app.ts` (or `project.ts`) - command group registration.
- `lib/commands/app-update.ts` - orchestrator for `app update`.
- `lib/commands/steps/update-managed-deps.ts` - manifest sync logic.
- optional: `lib/commands/steps/pre-update-commit.ts` - git prompt + commit flow.

Existing code to reuse directly:

- `copyAgentsAndSkills` from `lib/copy-template.ts`
- `createEnvFile` from `lib/commands/steps/create-env.ts`
- `setupIdeConfig` from `lib/commands/steps/ide-setup.ts`

---

## Rollout Plan

## Phase 1 (MVP)

- Add command and full default flow.
- Manage only two Fusebase SDK dependencies.
- Read managed dependency allowlist from `project-template/package.json` metadata (`fusebaseCli.managedDependencies`).
- Root + feature manifests update.
- In features, update managed deps only when already present (no auto-add).
- Install only where managed deps changed.
- Pre-update commit prompt.
- MCP refresh trigger by Dashboards + Gate **permission policy fingerprints** (not SDK semver).
- Manual MCP override via `--force-mcp`.

## Phase 2

- Add richer targeting flags (`--features-only`, `--root-only`).
- Add `--json` machine-readable output for CI.
- Add optional backup file snapshot mode for non-git projects.
- Optional: add explicit `MCP_POLICY_SCHEMA_VERSION` bumps in UI/docs when expanding permission sets beyond fingerprint drift.

---

## Risks and Mitigations

1. **User dependency conflicts**
   - Mitigation: update only managed dependency keys, never replace full manifest.

2. **Install failures in some features**
   - Mitigation: isolate installs per directory and aggregate failure report.

3. **Unexpected git behavior in non-interactive contexts**
   - Mitigation: default no commit in non-TTY unless explicitly enabled later.

4. **Token refresh side effects**
   - Mitigation: keep existing `.env` merge strategy and stage-level skip flags.

---

## Tests

Minimum automated coverage:

1. Dirty git repo + accepted commit -> commit created before file changes.
2. Dirty git repo + declined commit -> command continues safely.
3. Managed deps are updated without deleting user deps/scripts.
4. Root + multiple features: only existing `package.json` files are touched.
5. `.env` merge preserves non-MCP variables.
6. IDE configs refresh with force mode.
7. `--skip-*` flags correctly gate stages.
8. `--dry-run` performs no writes.

---

## Documentation Updates Required

When implemented, update:

- `README.md`
- `AGENTS.md`
- `project-template/.claude/skills/fusebase-cli/SKILL.md`
- `project-template/AGENTS.md` (if command list or flow references need refresh)

