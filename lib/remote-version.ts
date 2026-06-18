const DEFAULT_BASE_URL = "https://fusebase-cli-bin.s3.us-east-1.amazonaws.com";
const DEFAULT_MANIFEST_URL = `${DEFAULT_BASE_URL}/manifest.json`;

// Runtime endpoint overrides (test seam): point the CLI/launcher at a local
// server during off-prod testing. Accept http:// as well as https://.
//
// The overrides redirect where the CLI/launcher download and exec binaries from,
// with no client-side integrity check, so they are honored ONLY when the explicit
// opt-in `FUSEBASE_ALLOW_INSECURE_UPDATE_ENDPOINT=1` is also set. A normal prod
// binary ignores the override env vars entirely. The off-prod rig sets all three.
function overridesAllowed(env: NodeJS.ProcessEnv): boolean {
  return env.FUSEBASE_ALLOW_INSECURE_UPDATE_ENDPOINT === "1";
}

export function resolveBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (!overridesAllowed(env)) return DEFAULT_BASE_URL;
  return env.FUSEBASE_UPDATE_BASE_URL ?? DEFAULT_BASE_URL;
}

export function resolveManifestUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (!overridesAllowed(env)) return DEFAULT_MANIFEST_URL;
  return env.FUSEBASE_MANIFEST_URL ?? DEFAULT_MANIFEST_URL;
}

export const BASE_URL = resolveBaseUrl();
export const MANIFEST_URL = resolveManifestUrl();

export interface Manifest {
  version: string;
  devVersion?: string;
  /** Latest available launcher version (shared across channels); drives the soft nudge. */
  launcherVersion?: string;
  date: string;
  comment: string;
}

export async function fetchManifest(): Promise<Manifest> {
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch manifest (HTTP ${res.status})`);
  }
  return res.json() as Promise<Manifest>;
}

/**
 * Picks the latest version for a channel from the manifest: dev channel uses
 * `devVersion` when present, otherwise `version`. Shared between the CLI update
 * prelude and the launcher's first-run bootstrap.
 */
export function resolveLatestVersion(
  manifest: Manifest,
  channel: "prod" | "dev",
): string {
  return channel === "dev" && manifest.devVersion
    ? manifest.devVersion
    : manifest.version;
}

export function getBinaryUrl(version: string): string {
  const platform = process.platform;
  if (platform === "win32") {
    // Windows now downloads the CLI bin (cache swap), not the installer. The
    // installer URL is reserved for `update --launcher` (see getInstallerUrl).
    return `${BASE_URL}/${version}/fusebase-${version}.exe`;
  } else if (platform === "darwin") {
    const arch = process.arch;
    if (arch === "x64") {
      return `${BASE_URL}/${version}/fusebase-${version}-macos-x64`;
    }
    return `${BASE_URL}/${version}/fusebase-${version}-macos`;
  } else {
    return `${BASE_URL}/${version}/fusebase-${version}`;
  }
}

/** The Windows NSIS installer URL (launcher refresh via `update --launcher`). */
export function getInstallerUrl(version: string): string {
  return `${BASE_URL}/${version}/fusebase-installer-${version}.exe`;
}

/** Returns true if the version string is a dev timestamp build (major segment >= 2026). */
export function isDevVersion(version: string): boolean {
  return Number(version.split(".")[0]) >= 2026;
}

/** Returns >0 if a > b, <0 if a < b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
