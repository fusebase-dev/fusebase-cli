import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
} from "bun:test";
import {
  invalidateFuseConfigCache,
  loadFuseConfig,
  migrateFeaturesFolderToAppsAtRoot,
  normalizeRawFuseConfigShape,
  resetFeaturesFolderMigrationWarningForTests,
  resetLegacyShapeWarningForTests,
  writeGateSdkOperationsToFusebaseJson,
} from "../lib/config";

describe("fusebase.json shape auto-migration", () => {
  let dir: string;
  let prevCwd: string;
  let warnSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    prevCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), "fuse-config-mig-"));
    process.chdir(dir);
    invalidateFuseConfigCache();
    resetLegacyShapeWarningForTests();
    resetFeaturesFolderMigrationWarningForTests();
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
    invalidateFuseConfigCache();
    resetLegacyShapeWarningForTests();
    resetFeaturesFolderMigrationWarningForTests();
    warnSpy?.mockRestore();
  });

  describe("normalizeRawFuseConfigShape", () => {
    it("aliases legacy `appId` → `productId` and drops `appId`", () => {
      const raw: Record<string, unknown> = { orgId: "o", appId: "p1" };
      const { migrated } = normalizeRawFuseConfigShape(raw);
      expect(migrated).toBe(true);
      expect(raw.productId).toBe("p1");
      expect("appId" in raw).toBe(false);
    });

    it("aliases legacy `features[]` → `apps[]` and drops `features[]`", () => {
      const raw: Record<string, unknown> = {
        orgId: "o",
        productId: "p1",
        features: [{ id: "a-1" }],
      };
      const { migrated } = normalizeRawFuseConfigShape(raw);
      expect(migrated).toBe(true);
      expect(raw.apps).toEqual([{ id: "a-1" }]);
      expect("features" in raw).toBe(false);
    });

    it("does not overwrite an existing `productId` when `appId` is also present", () => {
      const raw: Record<string, unknown> = {
        orgId: "o",
        productId: "new",
        appId: "old",
      };
      normalizeRawFuseConfigShape(raw);
      expect(raw.productId).toBe("new");
      expect("appId" in raw).toBe(false);
    });

    it("does not overwrite an existing `apps` when `features` is also present", () => {
      const raw: Record<string, unknown> = {
        orgId: "o",
        productId: "p",
        apps: [{ id: "new" }],
        features: [{ id: "old" }],
      };
      normalizeRawFuseConfigShape(raw);
      expect(raw.apps).toEqual([{ id: "new" }]);
      expect("features" in raw).toBe(false);
    });

    it("is a no-op on an already-new-shape object", () => {
      const raw: Record<string, unknown> = {
        orgId: "o",
        productId: "p",
        apps: [{ id: "a" }],
      };
      const { migrated } = normalizeRawFuseConfigShape(raw);
      expect(migrated).toBe(false);
      expect(raw).toEqual({
        orgId: "o",
        productId: "p",
        apps: [{ id: "a" }],
      });
    });

    it("rewrites `apps[].path` entries from `features/...` to `apps/...` (independent of filesystem)", () => {
      const raw: Record<string, unknown> = {
        orgId: "o",
        productId: "p",
        apps: [
          { id: "a-1", path: "features/x" },
          { id: "a-2", path: "apps/y" },
          { id: "a-3" },
        ],
      };
      const { migrated } = normalizeRawFuseConfigShape(raw);
      expect(migrated).toBe(true);
      const apps = raw.apps as Array<Record<string, unknown>>;
      expect(apps[0]!.path).toBe("apps/x");
      expect(apps[1]!.path).toBe("apps/y");
      expect(apps[2]!.path).toBeUndefined();
    });

    it("rewrites only the `features/` prefix at the start of the path", () => {
      const raw: Record<string, unknown> = {
        orgId: "o",
        productId: "p",
        apps: [
          { id: "a-1", path: "nested/features/x" },
          { id: "a-2", path: "featuresX/y" },
        ],
      };
      const { migrated } = normalizeRawFuseConfigShape(raw);
      expect(migrated).toBe(false);
      const apps = raw.apps as Array<Record<string, unknown>>;
      expect(apps[0]!.path).toBe("nested/features/x");
      expect(apps[1]!.path).toBe("featuresX/y");
    });
  });

  describe("loadFuseConfig", () => {
    it("reads a legacy-shape fusebase.json and exposes new-shape fields", () => {
      writeFileSync(
        join(dir, "fusebase.json"),
        JSON.stringify({
          orgId: "org-1",
          appId: "prod-1",
          features: [
            { id: "app-1", path: "features/x" },
            { id: "app-2", path: "features/y" },
          ],
        }),
      );

      const cfg = loadFuseConfig();
      expect(cfg).not.toBeNull();
      expect(cfg!.orgId).toBe("org-1");
      expect(cfg!.productId).toBe("prod-1");
      expect(cfg!.apps).toHaveLength(2);
      expect(cfg!.apps?.[0]?.id).toBe("app-1");
      // Path prefixes are rewritten in-memory regardless of filesystem state.
      expect(cfg!.apps?.[0]?.path).toBe("apps/x");
      expect(cfg!.apps?.[1]?.path).toBe("apps/y");
      // Legacy keys are stripped from the in-memory object so subsequent
      // JSON.stringify writes never re-emit them.
      expect((cfg as Record<string, unknown>).appId).toBeUndefined();
      expect((cfg as Record<string, unknown>).features).toBeUndefined();
    });

    it("rewrites `apps[].path` even when `features/` is already absent on disk", () => {
      // Simulates the second-and-later CLI invocation case where a previous
      // run renamed `features/` → `apps/` in-memory but never persisted the
      // path prefix update, and the on-disk fusebase.json still has the
      // legacy path values.
      writeFileSync(
        join(dir, "fusebase.json"),
        JSON.stringify({
          orgId: "org-1",
          productId: "prod-1",
          apps: [{ id: "app-1", path: "features/x" }],
        }),
      );
      // No `features/` directory on disk — only the `apps/` directory.
      mkdirSync(join(dir, "apps", "x"), { recursive: true });

      const cfg = loadFuseConfig();
      expect(cfg!.apps?.[0]?.path).toBe("apps/x");
    });

    it("persists the migrated fusebase.json back to disk so subsequent runs see the new shape", () => {
      const fuseJsonPath = join(dir, "fusebase.json");
      writeFileSync(
        fuseJsonPath,
        JSON.stringify({
          orgId: "org-1",
          appId: "prod-1",
          features: [{ id: "app-1", path: "features/x" }],
        }),
      );

      loadFuseConfig();

      const onDisk = JSON.parse(readFileSync(fuseJsonPath, "utf-8")) as Record<
        string,
        unknown
      >;
      expect(onDisk.productId).toBe("prod-1");
      expect("appId" in onDisk).toBe(false);
      expect("features" in onDisk).toBe(false);
      const apps = onDisk.apps as Array<Record<string, unknown>>;
      expect(apps[0]!.path).toBe("apps/x");
    });

    it("does not rewrite the file on disk when it is already in new shape", () => {
      const fuseJsonPath = join(dir, "fusebase.json");
      const original = JSON.stringify({
        orgId: "org-1",
        productId: "prod-1",
        apps: [{ id: "app-1", path: "apps/x" }],
      });
      writeFileSync(fuseJsonPath, original);
      const mtimeBefore = statSync(fuseJsonPath).mtimeMs;

      loadFuseConfig();

      const mtimeAfter = statSync(fuseJsonPath).mtimeMs;
      expect(mtimeAfter).toBe(mtimeBefore);
      expect(readFileSync(fuseJsonPath, "utf-8")).toBe(original);
    });

    it("reads a new-shape fusebase.json verbatim", () => {
      writeFileSync(
        join(dir, "fusebase.json"),
        JSON.stringify({
          orgId: "org-1",
          productId: "prod-1",
          apps: [{ id: "app-1", path: "features/x" }],
        }),
      );

      const cfg = loadFuseConfig();
      expect(cfg!.productId).toBe("prod-1");
      expect(cfg!.apps?.[0]?.id).toBe("app-1");
    });

    it("prints a one-time `console.warn` when the file is in legacy shape", () => {
      writeFileSync(
        join(dir, "fusebase.json"),
        JSON.stringify({ orgId: "o", appId: "p", features: [] }),
      );
      loadFuseConfig();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = String(warnSpy!.mock.calls[0]?.[0] ?? "");
      expect(msg).toContain("legacy shape");

      // A second migration in the same process must not re-warn.
      const raw2: Record<string, unknown> = { orgId: "o", appId: "p2" };
      normalizeRawFuseConfigShape(raw2);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it("does not warn when the file is already in the new shape", () => {
      writeFileSync(
        join(dir, "fusebase.json"),
        JSON.stringify({ orgId: "o", productId: "p", apps: [] }),
      );
      loadFuseConfig();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("survives an old → new roundtrip via raw-write helpers", () => {
      // 1. Write legacy shape.
      writeFileSync(
        join(dir, "fusebase.json"),
        JSON.stringify(
          {
            orgId: "o",
            appId: "p1",
            features: [{ id: "app-1", path: "features/x" }],
          },
          null,
          2,
        ),
      );

      // 2. Trigger a write through the raw-mutating helper used by
      // `fusebase analyze gate`. After this call, the file must be in
      // new shape only.
      writeGateSdkOperationsToFusebaseJson(dir, "app-1", {
        analyzedAt: "2026-05-05T00:00:00.000Z",
        usedOps: ["listOrgUsers"],
        sdkVersion: "1.0.0",
      });

      const onDisk = JSON.parse(
        readFileSync(join(dir, "fusebase.json"), "utf-8"),
      ) as Record<string, unknown>;
      expect(onDisk.productId).toBe("p1");
      expect("appId" in onDisk).toBe(false);
      expect(Array.isArray(onDisk.apps)).toBe(true);
      expect("features" in onDisk).toBe(false);

      // 3. Re-read with the cached loader; should now be exclusively new shape.
      invalidateFuseConfigCache();
      resetLegacyShapeWarningForTests();
      warnSpy?.mockClear();
      const cfg = loadFuseConfig();
      expect(cfg!.productId).toBe("p1");
      expect(cfg!.apps?.[0]?.id).toBe("app-1");
      // Re-read of new-shape file must not warn.
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("migrateFeaturesFolderToAppsAtRoot", () => {
    it("renames an existing `features/` directory to `apps/`", () => {
      mkdirSync(join(dir, "features", "foo"), { recursive: true });
      writeFileSync(join(dir, "features", "foo", "marker.txt"), "x");

      const { renamed } = migrateFeaturesFolderToAppsAtRoot(dir);
      expect(renamed).toBe(true);
      expect(existsSync(join(dir, "features"))).toBe(false);
      expect(existsSync(join(dir, "apps", "foo", "marker.txt"))).toBe(true);
    });

    it("is a no-op when `features/` does not exist", () => {
      const { renamed } = migrateFeaturesFolderToAppsAtRoot(dir);
      expect(renamed).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("does not rename when both `features/` and `apps/` exist; warns once", () => {
      mkdirSync(join(dir, "features", "old"), { recursive: true });
      mkdirSync(join(dir, "apps", "new"), { recursive: true });

      const { renamed } = migrateFeaturesFolderToAppsAtRoot(dir);
      expect(renamed).toBe(false);
      expect(existsSync(join(dir, "features", "old"))).toBe(true);
      expect(existsSync(join(dir, "apps", "new"))).toBe(true);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = String(warnSpy!.mock.calls[0]?.[0] ?? "");
      expect(msg).toContain("alongside");

      // A second call in the same process must not re-warn.
      migrateFeaturesFolderToAppsAtRoot(dir);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it("is invoked by `loadFuseConfig` so the rename happens during normal CLI startup", () => {
      writeFileSync(
        join(dir, "fusebase.json"),
        JSON.stringify({
          orgId: "o",
          appId: "p",
          features: [{ id: "a-1", path: "features/x" }],
        }),
      );
      mkdirSync(join(dir, "features", "x"), { recursive: true });

      const cfg = loadFuseConfig();
      expect(cfg).not.toBeNull();
      expect(existsSync(join(dir, "features"))).toBe(false);
      expect(existsSync(join(dir, "apps", "x"))).toBe(true);
      expect(cfg!.apps?.[0]?.path).toBe("apps/x");
    });
  });
});
