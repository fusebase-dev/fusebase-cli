import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  BIN_NAME,
  SUPPORTED_SCHEMA,
  binPathForVersion,
  currentJsonPath,
  enumerateVersions,
  findPreviousVersion,
  migrateCurrentForward,
  pruneToTwo,
  readCurrent,
  resolveActiveVersion,
  stageAndInstallBinary,
  versionsDir,
  writeCurrentAtomic,
  type CurrentJson,
} from "../lib/win-cli-cache";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fb-cli-cache-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function seedVersion(version: string, contents = "exe"): Promise<void> {
  const dir = join(versionsDir(root), version);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, BIN_NAME), contents);
}

describe("current.json read/write", () => {
  it("roundtrips and leaves no temp file behind", async () => {
    const current: CurrentJson = {
      schemaVersion: SUPPORTED_SCHEMA,
      version: "0.25.6",
      updatedAt: "2026-06-17T00:00:00.000Z",
    };
    await writeCurrentAtomic(root, current);

    expect(await readCurrent(root)).toEqual(current);
    const leftover = (await readdir(root)).filter((f) => f.includes(".tmp"));
    expect(leftover).toHaveLength(0);
  });

  it("returns null on missing current.json", async () => {
    expect(await readCurrent(root)).toBeNull();
  });

  it("returns null on corrupt current.json", async () => {
    await writeFile(currentJsonPath(root), "{ not json");
    expect(await readCurrent(root)).toBeNull();
  });
});

describe("enumerate / previous / prune", () => {
  it("enumerates only versions with a present binary, newest first", async () => {
    await seedVersion("0.25.4");
    await seedVersion("0.25.6");
    await seedVersion("0.25.5");
    await mkdir(join(versionsDir(root), "0.25.7"), { recursive: true }); // no bin → excluded

    expect(await enumerateVersions(root)).toEqual(["0.25.6", "0.25.5", "0.25.4"]);
  });

  it("findPreviousVersion returns the newest non-active folder", async () => {
    await seedVersion("0.25.4");
    await seedVersion("0.25.5");
    await seedVersion("0.25.6");
    expect(await findPreviousVersion(root, "0.25.6")).toBe("0.25.5");
  });

  it("findPreviousVersion returns null when only one version is cached", async () => {
    await seedVersion("0.25.6");
    expect(await findPreviousVersion(root, "0.25.6")).toBeNull();
  });

  it("pruneToTwo keeps exactly {active, previous} and deletes older", async () => {
    await seedVersion("0.25.3");
    await seedVersion("0.25.4");
    await seedVersion("0.25.5");
    await seedVersion("0.25.6");

    await pruneToTwo(root, "0.25.6");

    expect((await readdir(versionsDir(root))).sort()).toEqual(["0.25.5", "0.25.6"]);
  });
});

describe("stageAndInstallBinary", () => {
  it("installs into versions\\<v> and leaves no partial staging under versions", async () => {
    const installed = await stageAndInstallBinary(root, "0.25.6", () =>
      Promise.resolve(new TextEncoder().encode("binary-bytes")),
    );

    expect(installed).toBe(binPathForVersion(root, "0.25.6"));
    expect(await readFile(installed, "utf-8")).toBe("binary-bytes");
    // versions\ holds only the finished version folder, no staging artifacts.
    expect(await readdir(versionsDir(root))).toEqual(["0.25.6"]);
  });

  it("accepts raw bytes and overwrites an existing version folder", async () => {
    await seedVersion("0.25.6", "old");
    await stageAndInstallBinary(root, "0.25.6", new TextEncoder().encode("new"));
    expect(await readFile(binPathForVersion(root, "0.25.6"), "utf-8")).toBe("new");
  });
});

describe("migrateCurrentForward", () => {
  it("stamps the supported schema", () => {
    const migrated = migrateCurrentForward({
      schemaVersion: 0,
      version: "0.25.6",
      updatedAt: "",
    });
    expect(migrated.schemaVersion).toBe(SUPPORTED_SCHEMA);
    expect(migrated.version).toBe("0.25.6");
  });
});

describe("resolveActiveVersion", () => {
  it("returns active when the pointer + binary are valid (schema ==)", async () => {
    await seedVersion("0.25.6");
    await writeCurrentAtomic(root, {
      schemaVersion: SUPPORTED_SCHEMA,
      version: "0.25.6",
      updatedAt: "",
    });
    expect(await resolveActiveVersion(root)).toEqual({ kind: "active", version: "0.25.6" });
  });

  it("signals migrated (so the pointer is rewritten) when schema < supported", async () => {
    await seedVersion("0.25.6");
    await writeCurrentAtomic(root, {
      schemaVersion: SUPPORTED_SCHEMA - 1,
      version: "0.25.6",
      updatedAt: "",
    });
    expect(await resolveActiveVersion(root)).toEqual({ kind: "migrated", version: "0.25.6" });
  });

  it("recovers newest cached when schema > supported (newer launcher wrote it)", async () => {
    await seedVersion("0.25.5");
    await seedVersion("0.25.6");
    await writeCurrentAtomic(root, {
      schemaVersion: SUPPORTED_SCHEMA + 1,
      version: "0.25.6",
      updatedAt: "",
    });
    expect(await resolveActiveVersion(root)).toEqual({ kind: "recovered", version: "0.25.6" });
  });

  it("recovers newest cached when current.json is missing", async () => {
    await seedVersion("0.25.5");
    await seedVersion("0.25.6");
    expect(await resolveActiveVersion(root)).toEqual({ kind: "recovered", version: "0.25.6" });
  });

  it("recovers newest cached when the pointed binary is gone", async () => {
    await seedVersion("0.25.5");
    await writeCurrentAtomic(root, {
      schemaVersion: SUPPORTED_SCHEMA,
      version: "0.25.6", // folder absent
      updatedAt: "",
    });
    expect(await resolveActiveVersion(root)).toEqual({ kind: "recovered", version: "0.25.5" });
  });

  it("signals bootstrap when the cache is empty", async () => {
    expect(await resolveActiveVersion(root)).toEqual({ kind: "bootstrap" });
  });
});
