import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

import { compareVersions, isDevVersion } from "./remote-version";

/**
 * Windows versioned CLI cache (`%LOCALAPPDATA%\FuseBase\CLI\`).
 *
 * This is the single module shared between the Windows `fusebase update` branch
 * and the launcher's first-run bootstrap. Every function takes an injected
 * `cacheRoot` so the logic is unit-testable on Linux against a temp dir.
 *
 * On-disk layout:
 *   <root>\current.json                      { schemaVersion, version, updatedAt }
 *   <root>\versions\<version>\fusebase-cli.exe
 */

export const BIN_NAME = "fusebase-cli.exe";

/** On-disk format version baked into the launcher (reserved-field convention, not a framework). */
export const SUPPORTED_SCHEMA = 1;

export interface CurrentJson {
  schemaVersion: number;
  version: string;
  updatedAt: string;
}

/** Raw bytes, or a lazy downloader producing them. */
export type BinarySource =
  | ArrayBuffer
  | Uint8Array
  | (() => Promise<ArrayBuffer | Uint8Array>);

/** Outcome of resolving which cached version the launcher should run. */
export type ResolveResult =
  | { kind: "active"; version: string }
  | { kind: "migrated"; version: string }
  | { kind: "recovered"; version: string }
  | { kind: "bootstrap" };

export function getCacheRoot(): string {
  const base = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  return join(base, "FuseBase", "CLI");
}

export function versionsDir(root: string): string {
  return join(root, "versions");
}

export function currentJsonPath(root: string): string {
  return join(root, "current.json");
}

export function binPathForVersion(root: string, version: string): string {
  return join(versionsDir(root), version, BIN_NAME);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Reads + validates `current.json`; returns null on missing or corrupt/unreadable. */
export async function readCurrent(root: string): Promise<CurrentJson | null> {
  let raw: string;
  try {
    raw = await readFile(currentJsonPath(root), "utf-8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CurrentJson>;
    if (
      typeof parsed.schemaVersion === "number" &&
      typeof parsed.version === "string" &&
      parsed.version.length > 0
    ) {
      return {
        schemaVersion: parsed.schemaVersion,
        version: parsed.version,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Writes `current.json` atomically (temp file + rename). */
export async function writeCurrentAtomic(
  root: string,
  current: CurrentJson,
): Promise<void> {
  await mkdir(root, { recursive: true });
  const tmp = join(root, `current.json.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tmp, JSON.stringify(current, null, 2), "utf-8");
  await rename(tmp, currentJsonPath(root));
}

/** Cached versions that have a present binary, newest first. */
export async function enumerateVersions(root: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(versionsDir(root));
  } catch {
    return [];
  }
  const present: string[] = [];
  for (const name of entries) {
    if (await pathExists(binPathForVersion(root, name))) {
      present.push(name);
    }
  }
  return present.sort((a, b) => compareVersions(b, a));
}

/**
 * The retained previous version — newest cached folder that isn't `active` and is
 * on the **same channel** as `active` — or null when the channel has only one
 * cached version.
 *
 * Channel-scoped because a dev build sorts above every `0.x` prod version, so a
 * leftover dev folder would otherwise hold the previous slot forever — pinning
 * `--previous-version` to a stale dev build and pruning the real previous prod
 * version on every update (NIM-42951). A folder from the other channel is never
 * returned: after a channel switch `--previous-version` says no previous version
 * is downloaded for this channel rather than silently running the other one.
 */
export async function findPreviousVersion(
  root: string,
  active: string,
): Promise<string | null> {
  const versions = await enumerateVersions(root);
  return (
    versions.find(
      (v) => v !== active && isDevVersion(v) === isDevVersion(active),
    ) ?? null
  );
}

/**
 * Keeps `{active, previous}` plus the running version cached; deletes the rest.
 *
 * `running` is the version whose `.exe` is the live process image. Windows keeps
 * that file memory-mapped, so deleting its folder fails with EACCES — and it is
 * not always the retained `previous` (after a channel switch the running build
 * is on the other channel, so `previous` is a same-channel folder instead). It
 * is kept here and pruned by the next update, when nothing runs from it. Cleanup
 * is best-effort:
 * a folder that cannot be removed is reported, never fatal — the version flip
 * has already committed by this point (NIM-42951).
 *
 * `remove` is injected only by tests, to make an undeletable folder deterministic
 * rather than dependent on the runner's uid.
 */
export async function pruneToTwo(
  root: string,
  active: string,
  running?: string,
  remove: (dir: string) => Promise<void> = (dir) =>
    rm(dir, { recursive: true, force: true }),
): Promise<void> {
  const previous = await findPreviousVersion(root, active);
  const keep = new Set(
    [active, previous, running].filter((v): v is string => Boolean(v)),
  );
  let entries: string[];
  try {
    entries = await readdir(versionsDir(root));
  } catch {
    return;
  }
  for (const name of entries) {
    if (keep.has(name)) continue;
    const dir = join(versionsDir(root), name);
    try {
      await remove(dir);
    } catch (err) {
      console.warn(`⚠ Could not remove old CLI version ${dir}: ${String(err)}`);
    }
  }
}

async function resolveBytes(source: BinarySource): Promise<Buffer> {
  const data = typeof source === "function" ? await source() : source;
  return Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data));
}

/**
 * Downloads/writes the binary into a staging dir and moves it into
 * `versions\<version>\` only on completion, so `versions\` never holds a
 * partial folder that could be mistaken for the retained previous version.
 */
export async function stageAndInstallBinary(
  root: string,
  version: string,
  source: BinarySource,
): Promise<string> {
  const bytes = await resolveBytes(source);
  const stagingDir = join(root, "staging", `${version}.${process.pid}.${Date.now()}`);
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  await writeFile(join(stagingDir, BIN_NAME), bytes);

  const finalDir = join(versionsDir(root), version);
  await mkdir(versionsDir(root), { recursive: true });
  await rm(finalDir, { recursive: true, force: true });
  await rename(stagingDir, finalDir);

  return join(finalDir, BIN_NAME);
}

/**
 * Extension point for on-disk migrations. v1 is the only format, so there is
 * nothing to migrate yet — the next launcher that changes the on-disk layout
 * adds its stepwise N→N+1 migration here (design decision #7).
 */
export function migrateCurrentForward(current: CurrentJson): CurrentJson {
  if (current.schemaVersion < SUPPORTED_SCHEMA) {
    // No migration steps exist yet; reserved for the first real layout change.
  }
  return { ...current, schemaVersion: SUPPORTED_SCHEMA };
}

/**
 * Resolves which cached version to run, recovering from a missing/corrupt
 * pointer or a newer-than-supported schema by falling back to the newest cached
 * version (signalling re-bootstrap when the cache is empty).
 */
export async function resolveActiveVersion(root: string): Promise<ResolveResult> {
  const current = await readCurrent(root);

  if (!current || current.schemaVersion > SUPPORTED_SCHEMA) {
    return recoverNewest(root);
  }

  const migrated = current.schemaVersion < SUPPORTED_SCHEMA;
  const resolved = migrated ? migrateCurrentForward(current) : current;

  if (await pathExists(binPathForVersion(root, resolved.version))) {
    // `migrated` signals the caller to rewrite current.json with the bumped
    // schemaVersion so the migration runs once, not on every launch.
    return { kind: migrated ? "migrated" : "active", version: resolved.version };
  }
  return recoverNewest(root);
}

async function recoverNewest(root: string): Promise<ResolveResult> {
  const newest = (await enumerateVersions(root))[0];
  return newest ? { kind: "recovered", version: newest } : { kind: "bootstrap" };
}
