# Git Configuration Guide

This guide describes the end-to-end Git flow in `fusebase`:

- which config flags are related to Git,
- how to configure GitLab integration,
- how to initialize Git for a new app,
- how to sync an existing local repository.

## What Exists Today

`fusebase` supports:

- local Git initialization (`git init`, baseline `.gitignore`),
- GitLab sync (create/find remote repo, set `origin`, push),
- optional managed tagging (`managed` GitLab topic),
- interactive repo-name preview during `fusebase init --git`.

## 1) One-Time Global Setup

### 1.1 Authenticate in the target environment

Choose environment first, because GitLab sync maps to `<gitlabGroup>/dev` or `<gitlabGroup>/prod` via current auth env:

```bash
fusebase auth --dev
# or
fusebase auth
```

### 1.2 Configure GitLab settings

Use CLI config command (recommended):

```bash
fusebase config gitlab
```

Also available:

```bash
fusebase config gitlab --show
fusebase config gitlab --host gl.nimbusweb.co --group vibecode --token glpat_xxx
fusebase config gitlab --clear-token
```

Required global keys in `~/.fusebase/config.json`:

- `gitlabHost`
- `gitlabGroup`
- `gitlabToken`

## 2) Git-Related Flags

Flags are global (`fusebase config set-flag ...`):

- `git-init`  
  Auto-runs Git initialization + GitLab sync during `fusebase init` (same behavior as passing `--git`).
  Per-run override: pass `--skip-git` to disable local git init + sync for that init call.

- `git-debug-commits`  
  Enables strict debug/deploy traceability rules in generated app guidance (commit-per-fix, deploy preflight, SHA/rollback reporting).

Examples:

```bash
fusebase config set-flag git-init
fusebase config set-flag git-debug-commits
fusebase config flags --list
```

If you changed template-related flags, refresh project guidance files:

```bash
fusebase skills update
```

## 3) Three Supported Scenarios

### Scenario 1: New app (`init`) + Git + Sync

Use when creating a brand new Fusebase app and you want Git + GitLab in one run.

```bash
fusebase init --git
```

Alternative (global auto mode):

```bash
fusebase config set-flag git-init
fusebase init
```

If you need to skip Git for a specific run while `git-init` is enabled:

```bash
fusebase init --skip-git
```

Expected result:

1. local git is initialized,
2. baseline `.gitignore` is ensured,
3. GitLab repo is created/found in `<gitlabGroup>/<env>/...`,
4. `origin` is configured (without overriding a different existing origin),
5. current branch is pushed.

Notes:

- In interactive init, CLI shows suggested repo name and allows editing before sync.
- For managed app tagging:
  - `fusebase init --git --git-tag-managed`

### Scenario 2: Existing project without git/repo -> add Git + Sync

Use when project already exists locally but has no `.git` and no remote.

```bash
fusebase git
fusebase git sync
```

Equivalent sync form:

```bash
fusebase git --git-sync
```

Expected result:

1. local repository is created,
2. `.gitignore` baseline is added/merged,
3. GitLab repo is created/found,
4. `origin` is added,
5. current branch is pushed.

### Scenario 3: Existing project with local git only -> add Sync only

Use when project already has local commits but no remote sync yet.

```bash
fusebase git sync
# or
fusebase git --git-sync
```

Expected result:

1. existing local history is preserved,
2. GitLab repo is created/found,
3. `origin` is added (if not present),
4. current branch is pushed.

Optional managed tagging (scenarios 2/3):

```bash
fusebase git sync --git-tag-managed
```

## 4) Repository Naming Rules

Default GitLab repo naming:

- format: `app-<base>-<env>`
- base priority:
  1. app title (with Cyrillic transliteration fallback),
  2. current folder name,
  3. app subdomain.

Example: `app-my-feature-dev`.

## 5) Common Troubleshooting

- Missing GitLab config  
  Run `fusebase config gitlab` and verify via `--show`.

- Wrong target namespace (dev/prod)  
  Re-auth with desired env (`fusebase auth --dev` vs `fusebase auth`) and retry.

- Origin already points elsewhere  
  Sync will not overwrite a different existing `origin`; update remote manually if intentional.

- Push fails due to token scope  
  Usually `api` is sufficient; add `write_repository` if your GitLab instance requires it.

- No commits yet  
  CLI attempts initial commit automatically; if local Git identity is missing, configure `user.name` / `user.email` and retry.
