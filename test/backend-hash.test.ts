import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  BACKEND_HASH_CONFIG_PREFIX_LEN,
  BACKEND_HASH_SOURCE_PREFIX_LEN,
  calculateBackendConfigHash,
  calculateBackendHash,
  calculateBackendSourceHash,
  canonicalJsonStringify,
  splitBackendHash,
} from "../lib/commands/deploy";
import type { BackendConfig } from "../lib/config";

// Active version's `backendHash` column is VARCHAR(64); fail loudly if the
// combined hash ever overflows that limit again (NIM-41039).
const BACKEND_HASH_MAX_LEN = 64;

const baseBackend: BackendConfig = {
  start: { command: "node server.js" },
  jobs: [
    {
      name: "screenshot",
      type: "cron",
      cron: "* * * * *",
      command: "npm run cron:screenshot",
    },
  ],
  sidecars: [
    {
      name: "redis",
      image: "redis:7",
      port: 6379,
      env: { REDIS_LOG: "1" },
    },
  ],
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("canonicalJsonStringify", () => {
  it("produces the same output regardless of object key order", () => {
    const a = { b: 1, a: { z: 2, y: 3 } };
    const b = { a: { y: 3, z: 2 }, b: 1 };
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
  });

  it("preserves array order (job/sidecar order is significant)", () => {
    expect(canonicalJsonStringify([1, 2, 3])).not.toBe(
      canonicalJsonStringify([3, 2, 1]),
    );
  });

  it("treats undefined like null", () => {
    expect(canonicalJsonStringify(undefined)).toBe("null");
  });
});

describe("calculateBackendConfigHash", () => {
  it("returns the same hash for the same inputs", () => {
    const a = calculateBackendConfigHash(baseBackend, ["DB_PASSWORD"]);
    const b = calculateBackendConfigHash(clone(baseBackend), ["DB_PASSWORD"]);
    expect(a).toBe(b);
  });

  it("differs when backend.jobs[].cron changes", () => {
    const original = calculateBackendConfigHash(baseBackend, []);
    const edited = clone(baseBackend);
    edited.jobs![0]!.cron = "*/5 * * * *";
    expect(calculateBackendConfigHash(edited, [])).not.toBe(original);
  });

  it("differs when backend.sidecars[] changes", () => {
    const original = calculateBackendConfigHash(baseBackend, []);
    const edited = clone(baseBackend);
    edited.sidecars![0]!.image = "redis:8";
    expect(calculateBackendConfigHash(edited, [])).not.toBe(original);
  });

  it("differs when backend.jobs[].sidecars changes (per-job sidecar)", () => {
    const original = calculateBackendConfigHash(baseBackend, []);
    const edited = clone(baseBackend);
    edited.jobs![0]!.sidecars = [{ name: "tool", image: "tool:1" }];
    expect(calculateBackendConfigHash(edited, [])).not.toBe(original);
  });

  it("differs when a secret key is added", () => {
    const original = calculateBackendConfigHash(baseBackend, ["A"]);
    expect(calculateBackendConfigHash(baseBackend, ["A", "B"])).not.toBe(
      original,
    );
  });

  it("differs when a secret key is removed", () => {
    const original = calculateBackendConfigHash(baseBackend, ["A", "B"]);
    expect(calculateBackendConfigHash(baseBackend, ["A"])).not.toBe(original);
  });

  it("is order-insensitive for secret keys (sorted before hashing)", () => {
    const a = calculateBackendConfigHash(baseBackend, ["B", "A"]);
    const b = calculateBackendConfigHash(baseBackend, ["A", "B"]);
    expect(a).toBe(b);
  });

  it("only considers secret KEYS — values never enter the hash", () => {
    // Function signature accepts only string[] of keys, so a value-only edit
    // out-of-band cannot affect the hash. Verifying via key list identity.
    const a = calculateBackendConfigHash(baseBackend, ["DB_PASSWORD"]);
    const b = calculateBackendConfigHash(baseBackend, ["DB_PASSWORD"]);
    expect(a).toBe(b);
  });

  it("differs when the entire backend block changes (e.g. start command)", () => {
    const original = calculateBackendConfigHash(baseBackend, []);
    const edited = clone(baseBackend);
    edited.start = { command: "node other.js" };
    expect(calculateBackendConfigHash(edited, [])).not.toBe(original);
  });

  it("differs when backend.minReplicas is added (forces redeploy)", () => {
    const original = calculateBackendConfigHash(baseBackend, []);
    const edited = clone(baseBackend);
    edited.minReplicas = 1;
    expect(calculateBackendConfigHash(edited, [])).not.toBe(original);
  });

  it("differs when backend.minReplicas value changes", () => {
    const one = clone(baseBackend);
    one.minReplicas = 1;
    const two = clone(baseBackend);
    two.minReplicas = 2;
    expect(calculateBackendConfigHash(two, [])).not.toBe(
      calculateBackendConfigHash(one, []),
    );
  });

  it("is stable when backend.minReplicas is unchanged (no spurious redeploy)", () => {
    const a = clone(baseBackend);
    a.minReplicas = 1;
    const b = clone(baseBackend);
    b.minReplicas = 1;
    expect(calculateBackendConfigHash(a, [])).toBe(
      calculateBackendConfigHash(b, []),
    );
  });
});

describe("splitBackendHash", () => {
  it("splits combined hash on first colon", () => {
    expect(splitBackendHash("aaa:bbb")).toEqual({
      source: "aaa",
      config: "bbb",
    });
  });

  it("treats legacy (no colon) hashes as source-only for backward compat", () => {
    expect(splitBackendHash("legacyhash")).toEqual({ source: "legacyhash" });
  });

  it("returns empty object for undefined", () => {
    expect(splitBackendHash(undefined)).toEqual({});
  });
});

describe("calculateBackendHash (combined)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fusebase-backend-hash-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "index.ts"), "console.log(1);", "utf-8");
    writeFileSync(join(dir, "package.json"), '{"name":"x"}', "utf-8");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("identity: same source + same config + same secrets → same hash", async () => {
    const a = await calculateBackendHash(dir, baseBackend, ["DB"]);
    const b = await calculateBackendHash(dir, baseBackend, ["DB"]);
    expect(a).toBe(b);
  });

  it("source change flips hash", async () => {
    const before = await calculateBackendHash(dir, baseBackend, []);
    writeFileSync(join(dir, "src", "index.ts"), "console.log(2);", "utf-8");
    const after = await calculateBackendHash(dir, baseBackend, []);
    expect(after).not.toBe(before);
  });

  it("config-only change keeps source half stable, flips config half", async () => {
    const before = await calculateBackendHash(dir, baseBackend, []);
    const edited = clone(baseBackend);
    edited.jobs![0]!.cron = "0 * * * *";
    const after = await calculateBackendHash(dir, edited, []);
    expect(after).not.toBe(before);
    const beforeParts = splitBackendHash(before);
    const afterParts = splitBackendHash(after);
    expect(afterParts.source).toBe(beforeParts.source);
    expect(afterParts.config).not.toBe(beforeParts.config);
  });

  it("secret-key change keeps source half stable, flips config half", async () => {
    const before = await calculateBackendHash(dir, baseBackend, ["A"]);
    const after = await calculateBackendHash(dir, baseBackend, ["A", "B"]);
    expect(after).not.toBe(before);
    expect(splitBackendHash(after).source).toBe(splitBackendHash(before).source);
    expect(splitBackendHash(after).config).not.toBe(
      splitBackendHash(before).config,
    );
  });

  it("fits within the active-version backendHash VARCHAR(64) column", async () => {
    const hash = await calculateBackendHash(dir, baseBackend, ["DB", "API"]);
    expect(hash.length).toBeLessThanOrEqual(BACKEND_HASH_MAX_LEN);
    const parts = splitBackendHash(hash);
    expect(parts.source).toHaveLength(BACKEND_HASH_SOURCE_PREFIX_LEN);
    expect(parts.config).toHaveLength(BACKEND_HASH_CONFIG_PREFIX_LEN);
  });

  it("encoded source/config halves are prefixes of the full SHA-256 digests", async () => {
    const hash = await calculateBackendHash(dir, baseBackend, ["DB"]);
    const parts = splitBackendHash(hash);
    const fullSource = await calculateBackendSourceHash(dir);
    const fullConfig = calculateBackendConfigHash(baseBackend, ["DB"]);
    expect(parts.source).toBe(fullSource.slice(0, BACKEND_HASH_SOURCE_PREFIX_LEN));
    expect(parts.config).toBe(fullConfig.slice(0, BACKEND_HASH_CONFIG_PREFIX_LEN));
  });
});

describe("calculateBackendSourceHash", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fusebase-source-hash-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "a.ts"), "a", "utf-8");
    writeFileSync(join(dir, "src", "b.ts"), "b", "utf-8");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("ignores node_modules", async () => {
    const before = await calculateBackendSourceHash(dir);
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    writeFileSync(
      join(dir, "node_modules", "noise.txt"),
      "should-not-be-hashed",
      "utf-8",
    );
    const after = await calculateBackendSourceHash(dir);
    expect(after).toBe(before);
  });
});
