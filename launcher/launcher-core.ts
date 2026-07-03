/**
 * Pure launcher helpers (no IO) so the launcher's decisions are unit-testable on
 * Linux. The IO orchestration lives in `launcher/index.ts`.
 */

import { compareVersions, isDevVersion } from "../lib/remote-version";

export const PREVIOUS_VERSION_FLAG = "--previous-version";
export const LAST_LEGACY_PROD_WINDOWS_CLI = "0.25.16";
export const FIRST_LAUNCHER_AWARE_DEV_WINDOWS_CLI = "2026.070310.2507";

/** Whether the user asked to run the retained previous version. */
export function wantsPreviousVersion(args: string[]): boolean {
  return args.includes(PREVIOUS_VERSION_FLAG);
}

/** Strips launcher-only flags before forwarding args to the CLI child. */
export function stripLauncherFlags(args: string[]): string[] {
  return args.filter((a) => a !== PREVIOUS_VERSION_FLAG);
}

/**
 * The version to fall back to (newest cached folder that isn't `active`), or
 * null when there is no previous version. `enumerated` is newest-first
 * (as returned by `enumerateVersions`).
 */
export function selectFallbackVersion(
  enumerated: string[],
  active: string,
): string | null {
  return enumerated.find((v) => v !== active) ?? null;
}

/** Whether forwarded args target the normal CLI update command. */
export function isUpdateCommand(args: string[]): boolean {
  return args[0] === "update";
}

/** `update --launcher` must keep the explicit launcher-refresh path. */
export function isLauncherUpdateCommand(args: string[]): boolean {
  return isUpdateCommand(args) && args.includes("--launcher");
}

/**
 * Known legacy Windows CLIs predate the launcher cache-swap updater and must not
 * handle `update` once they are running under the launcher.
 */
export function isLauncherAwareCliVersion(version: string): boolean {
  if (isDevVersion(version)) {
    return compareVersions(version, FIRST_LAUNCHER_AWARE_DEV_WINDOWS_CLI) >= 0;
  }
  return compareVersions(version, LAST_LEGACY_PROD_WINDOWS_CLI) > 0;
}

/** Newest launcher-aware cached version that is not the active legacy version. */
export function selectLauncherAwareFallback(
  enumerated: string[],
  active: string,
): string | null {
  return enumerated.find((v) => v !== active && isLauncherAwareCliVersion(v)) ?? null;
}
