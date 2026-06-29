export const MANIFEST_URL =
  "https://fusebase-cli-bin.s3.us-east-1.amazonaws.com/manifest.json";
export const BASE_URL =
  "https://fusebase-cli-bin.s3.us-east-1.amazonaws.com";

export interface Manifest {
  version: string;
  devVersion?: string;
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

export function getBinaryUrl(version: string): string {
  const platform = process.platform;
  if (platform === "win32") {
    return `${BASE_URL}/${version}/fusebase-installer-${version}.exe`;
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
