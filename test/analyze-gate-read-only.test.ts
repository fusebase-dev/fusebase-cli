import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { readGateSdkOperationsFromFusebaseJson } from "../lib/config.ts";
import { analyzeFeatureGatePermissions } from "../lib/gate-sdk-analyze.ts";

// NIM-42738 / B3: `fusebase analyze gate` used to rewrite fusebase.json on every run,
// replacing fusebaseGateMeta.permissions with what static analysis can see — which
// silently deleted hand-declared capabilities such as app_api.analytics.vse_usage.read.
// The command is now read-only unless --write is passed (persistFusebaseJson).

const HAND_DECLARED = "app_api.analytics.vse_usage.read";

const gateMeta = {
  sdkVersion: "1.0.0",
  analyzedAt: "2026-01-01T00:00:00.000Z",
  usedOpsChangedAt: "2026-01-01T00:00:00.000Z",
  usedOps: [],
  permissions: [HAND_DECLARED],
};

const dirs: string[] = [];

/** Project with one app, a tsconfig the analyzer can load, and a stub Gate SDK. */
function createProject(): { root: string; fuseJsonPath: string } {
  const root = mkdtempSync(join(tmpdir(), "fusebase-analyze-readonly-"));
  dirs.push(root);
  const appDir = join(root, "apps", "a");
  const sdkApisDir = join(root, "node_modules", "@fusebase", "fusebase-gate-sdk", "dist", "apis");
  mkdirSync(appDir, { recursive: true });
  mkdirSync(sdkApisDir, { recursive: true });

  writeFileSync(join(sdkApisDir, "TokensApi.js"), `const x = { opId: "listTokens" };\n`);
  writeFileSync(
    join(root, "node_modules", "@fusebase", "fusebase-gate-sdk", "package.json"),
    JSON.stringify({ name: "@fusebase/fusebase-gate-sdk", version: "1.0.0" }),
  );
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { target: "ES2020", module: "ESNext", moduleResolution: "Bundler", strict: false },
      include: ["apps/**/*.ts"],
    }),
  );
  writeFileSync(join(appDir, "index.ts"), `export const hello = 1;\n`);

  const fuseJsonPath = join(root, "fusebase.json");
  writeFileSync(
    fuseJsonPath,
    JSON.stringify(
      { orgId: "o1", productId: "p1", apps: [{ id: "app1", path: "apps/a", fusebaseGateMeta: gateMeta }] },
      null,
      2,
    ) + "\n",
  );
  return { root, fuseJsonPath };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("analyze gate is read-only by default", () => {
  it("leaves fusebase.json byte-identical and keeps hand-declared permissions in the report", async () => {
    const { root, fuseJsonPath } = createProject();
    const before = readFileSync(fuseJsonPath, "utf-8");

    const analysis = await analyzeFeatureGatePermissions({
      projectRoot: root,
      feature: { id: "app1", path: "apps/a", fusebaseGateMeta: gateMeta },
      persistFusebaseJson: false,
    });

    expect(readFileSync(fuseJsonPath, "utf-8")).toBe(before);
    expect(analysis.fusebaseSnapshot.permissions).toContain(HAND_DECLARED);
  });

  it("writes the snapshot when persistence is opted into (--write)", async () => {
    const { root, fuseJsonPath } = createProject();
    const before = readFileSync(fuseJsonPath, "utf-8");

    await analyzeFeatureGatePermissions({
      projectRoot: root,
      feature: { id: "app1", path: "apps/a", fusebaseGateMeta: gateMeta },
      persistFusebaseJson: true,
    });

    expect(readFileSync(fuseJsonPath, "utf-8")).not.toBe(before);
  });

  it("does not touch fusebase.json without --write, and does with it (end to end)", () => {
    const { root, fuseJsonPath } = createProject();
    const before = readFileSync(fuseJsonPath, "utf-8");
    const cli = join(import.meta.dir, "..", "index.ts");

    const readOnly = spawnSync(process.execPath, [cli, "analyze", "gate", "--feature", "app1", "--json"], {
      cwd: root,
      encoding: "utf-8",
    });
    expect(readOnly.status).toBe(0);
    expect(JSON.parse(readOnly.stdout).fusebaseSaved).toBe(false);
    expect(readFileSync(fuseJsonPath, "utf-8")).toBe(before);

    const written = spawnSync(
      process.execPath,
      [cli, "analyze", "gate", "--feature", "app1", "--json", "--write"],
      { cwd: root, encoding: "utf-8" },
    );
    expect(written.status).toBe(0);
    expect(JSON.parse(written.stdout).fusebaseSaved).toBe(true);
    expect(readFileSync(fuseJsonPath, "utf-8")).not.toBe(before);
  });

  it("reports permissions from an app snapshot stored under the legacy keys", () => {
    const { root, fuseJsonPath } = createProject();
    // loadFuseConfig hands these over verbatim; only the writeback path translated them.
    const legacyMeta = {
      changedAt: "2026-01-01T00:00:00.000Z",
      used: [],
      requiredPermissions: [HAND_DECLARED, "token.read"],
    };
    writeFileSync(
      fuseJsonPath,
      JSON.stringify(
        { orgId: "o1", productId: "p1", apps: [{ id: "app1", path: "apps/a", fusebaseGateMeta: legacyMeta }] },
        null,
        2,
      ) + "\n",
    );
    const before = readFileSync(fuseJsonPath, "utf-8");

    const res = spawnSync(
      process.execPath,
      [join(import.meta.dir, "..", "index.ts"), "analyze", "gate", "--feature", "app1", "--json"],
      { cwd: root, encoding: "utf-8" },
    );

    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout).permissions).toEqual([HAND_DECLARED, "token.read"]);
    expect(readFileSync(fuseJsonPath, "utf-8")).toBe(before);
  });

  it("reads the legacy project-level snapshot that loadFuseConfig does not migrate onto the app", () => {
    const { root, fuseJsonPath } = createProject();
    writeFileSync(
      fuseJsonPath,
      JSON.stringify(
        { orgId: "o1", productId: "p1", fusebaseGateMeta: gateMeta, apps: [{ id: "app1", path: "apps/a" }] },
        null,
        2,
      ) + "\n",
    );

    expect(readGateSdkOperationsFromFusebaseJson(root, "app1")?.permissions).toEqual([
      HAND_DECLARED,
    ]);
  });
});
