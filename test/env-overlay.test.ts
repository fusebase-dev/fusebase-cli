import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  invalidateFuseConfigCache,
  loadFuseConfig,
  persistResolvedAppId,
  type FeatureConfig,
} from "../lib/config";
import {
  buildEnvInfoPayload,
  getActiveEnvironment,
  injectEnvInfoIntoIndexHtml,
  overrideEnvironmentsFeatureForTests,
  resetEnvironmentsStateForTests,
  writeEnvironmentConfig,
  type EnvInfoPayload,
  type EnvironmentConfig,
} from "../lib/environments";

describe("environment overlay on fusebase.json", () => {
  let dir: string;
  let prevCwd: string;
  let prevFusebaseEnv: string | undefined;

  const rawFuseConfig = {
    orgId: "org-dev",
    productId: "prod-dev",
    apps: [
      {
        id: "app-dev-1",
        subdomain: "portal",
        name: "Portal",
        path: "apps/portal",
        isolatedStores: {
          sql: [{ alias: "portal", storeId: "dev-store-uuid" }],
        },
      },
      {
        subdomain: "admin",
        name: "Admin",
        path: "apps/admin",
      },
    ],
  };

  const prodEnv: EnvironmentConfig = {
    backend: "prod",
    orgId: "org-prod",
    productId: "prod-prod",
    subdomainSuffix: "-beta",
    apps: {
      portal: {
        id: "app-prod-1",
        subdomain: "portal-live",
        stores: { portal: "prod-store-uuid" },
      },
    },
  };

  beforeEach(() => {
    prevCwd = process.cwd();
    prevFusebaseEnv = process.env.FUSEBASE_ENV;
    delete process.env.FUSEBASE_ENV;
    dir = mkdtempSync(join(tmpdir(), "fuse-env-overlay-"));
    process.chdir(dir);
    writeFileSync(
      join(dir, "fusebase.json"),
      JSON.stringify(rawFuseConfig, null, 2),
      "utf-8",
    );
    resetEnvironmentsStateForTests();
    overrideEnvironmentsFeatureForTests(true);
    invalidateFuseConfigCache();
  });

  afterEach(() => {
    process.chdir(prevCwd);
    if (prevFusebaseEnv === undefined) delete process.env.FUSEBASE_ENV;
    else process.env.FUSEBASE_ENV = prevFusebaseEnv;
    resetEnvironmentsStateForTests();
    invalidateFuseConfigCache();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the raw config in legacy mode", () => {
    const config = loadFuseConfig();
    expect(config?.orgId).toBe("org-dev");
    expect(config?.apps?.[0]?.id).toBe("app-dev-1");
    expect(config?.apps?.[0]?.isolatedStores?.sql?.[0]?.storeId).toBe(
      "dev-store-uuid",
    );
  });

  it("overlays org/product/app id/subdomain/storeId from the active environment", () => {
    writeEnvironmentConfig(dir, "prod-beta", prodEnv);
    const config = loadFuseConfig();
    expect(config?.orgId).toBe("org-prod");
    expect(config?.productId).toBe("prod-prod");

    const portal = config?.apps?.[0] as FeatureConfig;
    expect(portal.id).toBe("app-prod-1");
    // Explicit per-app subdomain wins over the suffix.
    expect(portal.subdomain).toBe("portal-live");
    expect(portal.key).toBe("portal");
    expect(portal.isolatedStores?.sql?.[0]?.storeId).toBe("prod-store-uuid");

    // Entry without an env binding: foreign fusebase.json id must NOT leak;
    // suffix applies to the default subdomain.
    const admin = config?.apps?.[1] as FeatureConfig;
    expect(admin.id).toBeUndefined();
    expect(admin.subdomain).toBe("admin-beta");
  });

  it("drops the fusebase.json storeId when the env has no binding", () => {
    writeEnvironmentConfig(dir, "prod-beta", {
      ...prodEnv,
      apps: {},
    });
    const config = loadFuseConfig();
    const portal = config?.apps?.[0] as FeatureConfig;
    expect(portal.id).toBeUndefined();
    expect(portal.isolatedStores?.sql?.[0]?.storeId).toBeUndefined();
    expect(portal.isolatedStores?.sql?.[0]?.alias).toBe("portal");
  });

  it("does not mutate the raw fusebase.json on disk", () => {
    writeEnvironmentConfig(dir, "prod-beta", prodEnv);
    loadFuseConfig();
    const onDisk = JSON.parse(readFileSync(join(dir, "fusebase.json"), "utf-8"));
    expect(onDisk.orgId).toBe("org-dev");
    expect(onDisk.apps[0].id).toBe("app-dev-1");
  });

  describe("persistResolvedAppId", () => {
    it("writes into the env lockfile when an environment is active", () => {
      writeEnvironmentConfig(dir, "prod-beta", { ...prodEnv, apps: {} });
      const overlaid = loadFuseConfig()!.apps![1]!; // admin, key stamped
      const written = persistResolvedAppId(dir, overlaid, "app-prod-9", {
        createdSubdomain: "admin-beta",
      });
      expect(written).toBe(true);

      const lockfile = JSON.parse(
        readFileSync(join(dir, "environments", "prod-beta.json"), "utf-8"),
      );
      expect(lockfile.apps.admin.id).toBe("app-prod-9");
      expect(lockfile.apps.admin.subdomain).toBe("admin-beta");
      // fusebase.json untouched.
      const onDisk = JSON.parse(
        readFileSync(join(dir, "fusebase.json"), "utf-8"),
      );
      expect(onDisk.apps[1].id).toBeUndefined();
    });

    it("builds the env-info payload with counterparts", () => {
      writeEnvironmentConfig(dir, "prod-beta", prodEnv);
      writeEnvironmentConfig(dir, "dev", {
        backend: "dev",
        orgId: "org-dev",
        apps: { portal: { id: "app-dev-1" } },
      });
      writeEnvironmentConfig(dir, "prod-qa", {
        backend: "prod",
        orgId: "org-qa",
        protected: true,
        subdomainSuffix: "-qa",
      });
      process.env.FUSEBASE_ENV = "prod-beta";
      const active = getActiveEnvironment(dir)!;

      const payload = buildEnvInfoPayload({
        projectRoot: dir,
        active,
        appKey: "portal",
        appId: "app-prod-1",
        effectiveSubdomain: "portal-live",
        appHostForBackend: (backend) =>
          backend === "prod" ? "thefusebase.app" : "dev-thefusebase-app.com",
      });

      expect(payload.env).toBe("prod-beta");
      expect(payload.backend).toBe("prod");
      expect(payload.appId).toBe("app-prod-1");
      expect(payload.url).toBe("https://portal-live.thefusebase.app/");

      const byEnv = new Map(payload.counterparts.map((c) => [c.env, c]));
      // dev: raw default subdomain "portal", dev host, different backend → not sameOrg.
      expect(byEnv.get("dev")?.url).toBe(
        "https://portal.dev-thefusebase-app.com/",
      );
      expect(byEnv.get("dev")?.sameOrg).toBe(false);
      // prod-qa: suffix applied to the raw default, protected marker carried.
      expect(byEnv.get("prod-qa")?.url).toBe(
        "https://portal-qa.thefusebase.app/",
      );
      expect(byEnv.get("prod-qa")?.protected).toBe(true);
      expect(byEnv.get("prod-qa")?.sameOrg).toBe(false);
      // Deterministic payload — no timestamps.
      expect(Object.keys(payload)).not.toContain("deployedAt");
    });

    it("injects window.__FUSEBASE_ENV__ into index.html idempotently", () => {
      const payload: EnvInfoPayload = {
        env: "dev",
        protected: false,
        backend: "dev",
        orgId: "org-dev",
        appKey: "portal",
        appId: "app-1",
        counterparts: [],
      };
      const html = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<title>App</title>\n</head>\n<body></body></html>`;

      const injected = injectEnvInfoIntoIndexHtml(html, payload)!;
      expect(injected).toContain('window.__FUSEBASE_ENV__={"env":"dev"');
      // Inserted inside <head>, before existing tags.
      expect(injected.indexOf("__FUSEBASE_ENV__")).toBeLessThan(
        injected.indexOf("<title>"),
      );

      // Re-injection replaces the block instead of duplicating it.
      const reinjected = injectEnvInfoIntoIndexHtml(injected, {
        ...payload,
        env: "prod",
      })!;
      expect(reinjected.match(/__FUSEBASE_ENV__/g)?.length).toBe(1);
      expect(reinjected).toContain('"env":"prod"');

      // `<` in payload values cannot break out of the script tag.
      const evil = injectEnvInfoIntoIndexHtml(html, {
        ...payload,
        env: "</script><script>alert(1)",
      } as EnvInfoPayload)!;
      expect(evil).not.toContain("</script><script>alert(1)");
      expect(evil).toContain("\\u003c/script>");

      // No <head> → no injection.
      expect(injectEnvInfoIntoIndexHtml("<div>x</div>", payload)).toBeNull();
    });

    it("falls back to fusebase.json write-back in legacy mode", () => {
      const raw = loadFuseConfig()!;
      const admin = raw.apps![1]!;
      const written = persistResolvedAppId(dir, admin, "app-legacy-2");
      expect(written).toBe(true);
      const onDisk = JSON.parse(
        readFileSync(join(dir, "fusebase.json"), "utf-8"),
      );
      expect(onDisk.apps[1].id).toBe("app-legacy-2");
    });
  });
});
