/**
 * Minimum launcher version this CLI build requires (hard gate; see
 * `launcher-self-check.ts`). Baked into the CLI binary — set by hand to an
 * already-published `launcherVersion` only when a CLI build needs a newer
 * launcher (a breaking, two-step rollout).
 *
 * `"0.0.0"` is the v1 baseline: any real (timestamp-shaped) launcher version
 * satisfies it, so a v1 CLI never blocks when launched by any launcher. A
 * pre-launcher install (no `FUSEBASE_LAUNCHER_VERSION` in env) is still treated
 * as "too old" and blocked, because the env var is absent rather than older.
 */
export const REQUIRED_LAUNCHER = "0.0.0";
