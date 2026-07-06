import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  assertDeployableFeature,
  invalidateFuseConfigCache,
  KNOWN_FLAGS,
  loadFuseConfig,
  requireAppId,
  type FeatureConfig,
} from "../lib/config";

// NIM-41746: app `id` is optional; a deployable entry needs either a legacy
// `id` or a declarative `subdomain`. Imperative commands still require a
// resolved platform id via `requireAppId`.
describe("declarative FeatureConfig", () => {
  describe("assertDeployableFeature", () => {
    it("accepts a legacy entry with an id and no subdomain", () => {
      expect(() =>
        assertDeployableFeature({ id: "app-1", path: "apps/x" }),
      ).not.toThrow();
    });

    it("accepts a declarative entry with a subdomain and no id", () => {
      expect(() =>
        assertDeployableFeature({ subdomain: "my-app", path: "apps/x" }),
      ).not.toThrow();
    });

    it("rejects an entry with neither id nor subdomain, naming the path", () => {
      expect(() => assertDeployableFeature({ path: "apps/x" })).toThrow(
        /app at "apps\/x".*either an "id".*or a.*"subdomain"/s,
      );
    });
  });

  describe("requireAppId", () => {
    it("returns the id when present", () => {
      expect(requireAppId({ id: "app-1" })).toBe("app-1");
    });

    it("throws for a declarative (id-less) entry", () => {
      expect(() =>
        requireAppId({ subdomain: "my-app", path: "apps/x" }),
      ).toThrow(/missing a platform "id".*apps\/x/s);
    });
  });

  describe("loadFuseConfig parses declarative + legacy entries", () => {
    let dir: string;
    let prevCwd: string;

    beforeEach(() => {
      prevCwd = process.cwd();
      dir = mkdtempSync(join(tmpdir(), "fuse-config-decl-"));
      process.chdir(dir);
      invalidateFuseConfigCache();
    });

    afterEach(() => {
      process.chdir(prevCwd);
      rmSync(dir, { recursive: true, force: true });
      invalidateFuseConfigCache();
    });

    it("loads an id-less subdomain entry and a legacy id entry side by side", () => {
      writeFileSync(
        join(dir, "fusebase.json"),
        JSON.stringify({
          orgId: "org-1",
          productId: "prod-1",
          apps: [
            { subdomain: "declared", name: "Declared App", path: "apps/d" },
            { id: "legacy-1", path: "apps/l" },
          ],
        }),
      );

      const cfg = loadFuseConfig();
      const apps = cfg!.apps as FeatureConfig[];
      expect(apps[0]!.id).toBeUndefined();
      expect(apps[0]!.subdomain).toBe("declared");
      expect(apps[0]!.name).toBe("Declared App");
      expect(apps[1]!.id).toBe("legacy-1");
      expect(apps[1]!.subdomain).toBeUndefined();
      // Both resolve as deployable.
      for (const app of apps) {
        expect(() => assertDeployableFeature(app)).not.toThrow();
      }
    });
  });

  // NIM-41963: the declarative manifest + deploy reconcile are gated behind the
  // `declarative-manifest` flag. Guards `deploy.ts`'s hasFlag("declarative-manifest")
  // string against drift from the registered flag list.
  it("registers the declarative-manifest flag", () => {
    expect(KNOWN_FLAGS).toContain("declarative-manifest");
  });
});
