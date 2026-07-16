import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  getConfig,
  getEnv,
  getRawConfig,
  setBackendApiKey,
  setConfig,
  setConfigFilePathForTests,
  setProcessEnvOverride,
  type Config,
} from "../lib/config";
import {
  overrideEnvironmentsFeatureForTests,
  resetEnvironmentsStateForTests,
  writeEnvironmentConfig,
} from "../lib/environments";

describe("per-backend auth config", () => {
  let dir: string;
  let prevCwd: string;
  let configPath: string;
  let prevFusebaseApiKey: string | undefined;
  let prevFusebaseEnv: string | undefined;
  let prevProcessEnv: string | undefined;

  beforeEach(() => {
    prevCwd = process.cwd();
    prevFusebaseApiKey = process.env.FUSEBASE_API_KEY;
    prevFusebaseEnv = process.env.FUSEBASE_ENV;
    prevProcessEnv = process.env.ENV;
    delete process.env.FUSEBASE_API_KEY;
    delete process.env.FUSEBASE_ENV;
    delete process.env.ENV;
    dir = mkdtempSync(join(tmpdir(), "fuse-auth-config-"));
    process.chdir(dir);
    configPath = join(dir, "config.json");
    setConfigFilePathForTests(configPath);
    resetEnvironmentsStateForTests();
    setProcessEnvOverride(undefined);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    setConfigFilePathForTests(null);
    resetEnvironmentsStateForTests();
    setProcessEnvOverride(undefined);
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("FUSEBASE_API_KEY", prevFusebaseApiKey);
    restore("FUSEBASE_ENV", prevFusebaseEnv);
    restore("ENV", prevProcessEnv);
    rmSync(dir, { recursive: true, force: true });
  });

  function seedConfig(config: Config): void {
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    // Reset the in-memory cache so the seed is re-read.
    setConfigFilePathForTests(configPath);
  }

  it("resolves apiKey from the auth map for the current backend", () => {
    seedConfig({
      env: "dev",
      apiKey: "legacy-key",
      auth: { dev: { apiKey: "dev-key" }, prod: { apiKey: "prod-key" } },
    });
    expect(getEnv()).toBe("dev");
    expect(getConfig().apiKey).toBe("dev-key");

    seedConfig({
      env: "prod",
      apiKey: "legacy-key",
      auth: { dev: { apiKey: "dev-key" }, prod: { apiKey: "prod-key" } },
    });
    expect(getConfig().apiKey).toBe("prod-key");
  });

  it("falls back to the legacy apiKey when the backend has no map entry", () => {
    seedConfig({
      env: "prod",
      apiKey: "legacy-key",
      auth: { dev: { apiKey: "dev-key" } },
    });
    expect(getConfig().apiKey).toBe("legacy-key");
  });

  it("FUSEBASE_API_KEY overrides both the map and the legacy key", () => {
    seedConfig({
      env: "dev",
      apiKey: "legacy-key",
      auth: { dev: { apiKey: "dev-key" } },
    });
    process.env.FUSEBASE_API_KEY = "ci-key";
    expect(getConfig().apiKey).toBe("ci-key");
  });

  it("active environment backend drives key selection", () => {
    seedConfig({
      env: "dev",
      apiKey: "legacy-key",
      auth: { dev: { apiKey: "dev-key" }, prod: { apiKey: "prod-key" } },
    });
    overrideEnvironmentsFeatureForTests(true);
    writeEnvironmentConfig(dir, "prod-test", {
      backend: "prod",
      orgId: "org-qa",
    });
    // Single env auto-picks; its backend (prod) selects the prod key even
    // though the legacy global env is dev.
    expect(getEnv()).toBe("prod");
    expect(getConfig().apiKey).toBe("prod-key");
  });

  it("setProcessEnvOverride wins over stored env for backend resolution", () => {
    seedConfig({
      env: "prod",
      apiKey: "legacy-key",
      auth: { dev: { apiKey: "dev-key" }, prod: { apiKey: "prod-key" } },
    });
    setProcessEnvOverride("dev");
    expect(getEnv()).toBe("dev");
    expect(getConfig().apiKey).toBe("dev-key");
  });

  it("setBackendApiKey writes the map entry and mirrors the legacy key", () => {
    seedConfig({ env: "dev", apiKey: "old-key" });
    setBackendApiKey("dev", "new-dev-key");
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Config;
    expect(raw.auth?.dev?.apiKey).toBe("new-dev-key");
    expect(raw.apiKey).toBe("new-dev-key");

    setBackendApiKey("prod", "new-prod-key");
    const raw2 = JSON.parse(readFileSync(configPath, "utf-8")) as Config;
    expect(raw2.auth?.dev?.apiKey).toBe("new-dev-key");
    expect(raw2.auth?.prod?.apiKey).toBe("new-prod-key");
    expect(raw2.apiKey).toBe("new-prod-key");
  });

  it("first auth to another backend preserves the legacy key into its own slot", () => {
    // Machine was prod (env: prod, legacy prod key), user runs `auth --dev`:
    // the prod key must not be orphaned by the legacy-mirror overwrite.
    seedConfig({ env: "prod", apiKey: "prod-key" });
    setBackendApiKey("dev", "dev-key");
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Config;
    expect(raw.auth?.dev?.apiKey).toBe("dev-key");
    expect(raw.auth?.prod?.apiKey).toBe("prod-key");
    expect(raw.apiKey).toBe("dev-key");
  });

  it("no legacy migration when authing the same backend or when the map already exists", () => {
    seedConfig({ env: "dev", apiKey: "old-dev-key" });
    setBackendApiKey("dev", "new-dev-key");
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Config;
    expect(Object.keys(raw.auth ?? {})).toEqual(["dev"]);
    expect(raw.auth?.dev?.apiKey).toBe("new-dev-key");

    // Map already populated: later auth never resurrects the legacy key.
    setBackendApiKey("prod", "prod-key");
    const raw2 = JSON.parse(readFileSync(configPath, "utf-8")) as Config;
    expect(raw2.auth?.dev?.apiKey).toBe("new-dev-key");
    expect(raw2.auth?.prod?.apiKey).toBe("prod-key");
  });

  it("setConfig merges against the raw config, never persisting the substituted key", () => {
    seedConfig({
      env: "dev",
      apiKey: "legacy-key",
      auth: { dev: { apiKey: "dev-key" } },
    });
    // Effective read sees the dev key…
    expect(getConfig().apiKey).toBe("dev-key");
    // …but an unrelated write keeps the legacy field untouched on disk.
    setConfig({ gitlabHost: "gl.example.com" });
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Config;
    expect(raw.apiKey).toBe("legacy-key");
    expect(raw.gitlabHost).toBe("gl.example.com");
  });

  it("getFlags never mutates the cached raw flags array via implied/always-on entries", async () => {
    const { getFlags } = await import("../lib/config");
    seedConfig({ env: "prod", flags: ["environments"] });
    getFlags();
    // Unrelated writes persist only the user's own flags.
    setConfig({ gitlabHost: "x" });
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Config;
    expect(raw.flags).toEqual(["environments"]);
  });

  it("getConfig returns a fresh copy — mutations do not leak into the cache", () => {
    seedConfig({ env: "dev", apiKey: "legacy-key" });
    const copy = getConfig();
    copy.apiKey = "mutated";
    copy.env = "prod";
    expect(getConfig().apiKey).toBe("legacy-key");
    expect(getRawConfig().env).toBe("dev");
  });
});
