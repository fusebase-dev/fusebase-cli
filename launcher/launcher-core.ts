/**
 * Pure launcher helpers (no IO) so the launcher's decisions are unit-testable on
 * Linux. The IO orchestration lives in `launcher/index.ts`.
 */

export const PREVIOUS_VERSION_FLAG = "--previous-version";

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
