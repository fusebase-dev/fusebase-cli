# Windows launcher & self-updating CLI

On Windows the `fusebase` command is a small, stable **launcher** that resolves
and runs the real CLI from a user-writable versioned cache. `fusebase update`
swaps the cached CLI binary with **no admin elevation and no installer download**.
macOS and Linux are unaffected — they keep replacing the single binary in place.

This document is the source of truth for the launcher's architecture, the
versioning model, and the developer rollout workflow.

## Architecture

| Component | Location | Owns |
|---|---|---|
| **Launcher** `fusebase.exe` | `Program Files\FuseBase CLI\` (on system PATH) | Resolve `current.json` → exec the cached CLI; first-run bootstrap; rollback fallback. Bun-compiled from `launcher/index.ts`. |
| **CLI binaries** `fusebase-cli.exe` | `%LOCALAPPDATA%\FuseBase\CLI\versions\<version>\` | The real CLI; one folder per version (active + retained previous). |
| **Pointer** `current.json` | `%LOCALAPPDATA%\FuseBase\CLI\` | `{ schemaVersion, version, updatedAt }` — names the active version. |
| **Global config** | `~/.fusebase\config.json` | `apiKey`, `env`, `updateChannel` (`prod`/`dev`), flags. Untouched by the installer. |
| **Installer** (NSIS) | served by the web client | Installs Node + the launcher + PATH; the only path that elevates. |

```
%LOCALAPPDATA%\FuseBase\CLI\
  current.json                       { schemaVersion, version, updatedAt }
  launcher.log                       tiny append-only diagnostics
  versions\
    0.25.6\fusebase-cli.exe          <- active
    0.25.5\fusebase-cli.exe          <- retained previous (rollback)
```

- **The normal CLI never touches the cache.** Only the *updating* CLI writes
  `current.json` / `versions\`; the launcher only reads them.
- **The binary path is derived** (`versions\<version>\fusebase-cli.exe`) — not
  stored. The "previous" version is found by enumerating `versions\` (the folder
  that isn't active), which is why downloads are **staged** (written to a staging
  dir and moved in only on completion) so `versions\` never holds a partial folder.
- Retention is `{active, previous}` total — not per channel.

Code: launcher entrypoint `launcher/index.ts` (+ pure helpers `launcher/launcher-core.ts`);
shared cache module `lib/win-cli-cache.ts`; the Windows branch of
`runCliSelfUpdate` in `lib/commands/cli.ts`.

## Versioning model

Three identifiers govern the launcher↔CLI runtime hand-off:

- **`FUSEBASE_LAUNCHER_VERSION`** — the launcher's own version, **auto-generated**
  from the launcher source's last git change (`scripts/generate-launcher-version.ts`,
  `YYYY.mmddhh.mmss` shape), baked into the launcher (`lib/launcher-version.ts`),
  and injected into the CLI child's env at exec.
- **`launcherVersion`** (manifest) — the latest available launcher version, a
  **single field shared across channels**, carried forward by `upload-to-s3.sh`.
  Drives the **soft nudge**.
- **`REQUIRED_LAUNCHER`** (`lib/required-launcher.ts`) — the minimum launcher a
  CLI build needs, **baked into the CLI binary** and set **by hand**. Drives the
  **hard block**. Default `"0.0.0"` (any real launcher satisfies it).

These are a **separate axis** from `current.json`'s `schemaVersion`, which governs
the on-disk cache *format* (see Migration below).

### Two tiers, both compared against `FUSEBASE_LAUNCHER_VERSION`

- **Hard block** — baked `REQUIRED_LAUNCHER`. On startup the CLI self-rejects every
  non-allowlisted command when the launcher is older (or absent) with
  *"Your launcher is too old for this CLI version. Run `fusebase update --launcher`."*
  plus a second line pointing to the `--previous-version` escape hatch while
  recommending an update as soon as possible.
  Allowlist: `version`, `--version`/`-V`, `--help`/`-h`, `update --launcher`.
  (`fusebase --previous-version` bypasses it — the launcher handles it before exec.)
- **Soft nudge** — manifest `launcherVersion`. The on-launch `checkForUpdates()`
  prints a non-blocking *"A launcher update is available…"* to stderr. Advisory and
  eventually-consistent (cached manifest, refreshed on ~20% of runs).

There is **no pre-flip manifest gate**: the updating (old) CLI doesn't know the new
version's requirement, so it just swaps. The new CLI enforces its own requirement at
next launch.

## Developer rollout workflow

| Scenario | What you do |
|---|---|
| **Normal CLI release** (no launcher change) | Nothing launcher-related. The installer re-bundles the unchanged launcher harmlessly; clients cache-swap the new CLI. |
| **Launcher bugfix** (non-breaking) | Just change the launcher source. `launcherVersion` auto-bumps from the source's git timestamp → the **nudge** fires. No constant edits. Clients refresh at their leisure via `fusebase update --launcher`. |
| **Breaking launcher change** | **Two-step rollout.** (1) Release the launcher first (auto-versioned). (2) In a *later* CLI release, set `REQUIRED_LAUNCHER` in `lib/required-launcher.ts` to that already-published `launcherVersion`. The new CLI then **hard-blocks** until the user runs `fusebase update --launcher`. Never bump both in one release — `REQUIRED_LAUNCHER` may only reference a launcher version that already exists. |

The launcher-version **source set** (`scripts/generate-launcher-version.ts`) is a
documented heuristic: `launcher/` + `lib/win-cli-cache.ts` + `lib/remote-version.ts`.
Keep it in sync if the launcher's imports grow. An under-bump leaves a stale-but-working
launcher; an over-bump fires a redundant nudge — both harmless.

## On-disk contract migration

`current.json` carries a `schemaVersion`; the launcher bakes `SUPPORTED_SCHEMA`
(`lib/win-cli-cache.ts`) and compares on read:

- `==` → use as-is.
- `<` → **migrate forward** (stepwise N→N+1) and rewrite atomically. v1 ships a
  single format, so `migrateCurrentForward` is an `if`-stub — the launcher that
  introduces a new layout adds its migration step there.
- `>` → written by a newer launcher (downgrade) → **fail safe**: re-resolve the
  newest cached version (or re-bootstrap); no down-migration.

This is a **convention, not a framework** — a reserved field + a baked constant.
A layout break is rare-to-never because most launcher changes are in the runtime
hand-off (env/args), not the on-disk layout. **Invariant:** a new launcher must be
able to read+migrate the old layout; during a breaking transition the old launcher
only ever sees the old format (the new CLI's gate blocks all writes until the
launcher is refreshed).

## User-facing flows

- **First install** — run the installer (Node + launcher + PATH). The first
  `fusebase <cmd>` finds an empty cache → the launcher **bootstraps** the latest
  CLI for the active channel, then runs it.
- **`fusebase update`** — cache swap: download the CLI bin to staging → move into
  `versions\<new>\` → atomically flip `current.json` → prune to two. Reports
  `FuseBase CLI updated from <old> to <new>.` No elevation, no installer, no exit.
- **`fusebase update --launcher`** — the only elevating path. Downloads the NSIS
  installer and runs it elevated (UAC) to replace the launcher in Program Files.
  Windows-only; a no-op on macOS/Linux.
- **`fusebase --previous-version`** — launcher-intercepted (before exec); runs the
  retained previous cached version for that one invocation. Escape hatch during a
  breaking-launcher block or a bad new version. Graceful error if no previous exists.
- **Self-reject message** — after a breaking bump, non-allowlisted commands print
  *"Your launcher is too old for this CLI version. Run `fusebase update --launcher`."*
  followed by a second line noting `--previous-version` as a stopgap while urging a
  prompt update, then exit non-zero until the launcher is refreshed.

## Migration from the pre-launcher setup

Automatic and one-time. An existing install has the **old CLI binary** as
`Program Files\FuseBase CLI\fusebase.exe`. Its `fusebase update` still downloads the
**installer** (old `getBinaryUrl(win32)` behavior) and runs it elevated; the **new
installer lays down the launcher** as the same `fusebase.exe`. The next run sees an
empty cache → bootstraps. From then on, updates are cache swaps. Self-correcting:
old CLIs resolve to the installer (→ migrate), new cached CLIs resolve to the bin
(→ cache swap). Re-running the installer on an already-migrated machine is a safe
repair — it overwrites only the launcher and leaves `%LOCALAPPDATA%` untouched.
