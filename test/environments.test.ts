import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
  ENVIRONMENTS_DIR,
  PROJECT_STATE_DIR,
  PROJECT_STATE_FILE,
  effectiveSubdomain,
  ensureEnvGitignoreEntries,
  getActiveEnvironment,
  getActiveEnvironmentBackend,
  getEnvironmentEnvFilePath,
  isValidEnvironmentName,
  listEnvironmentNames,
  loadEnvironmentConfig,
  overrideEnvironmentsFeatureForTests,
  readActiveEnvironmentState,
  requireActiveEnvironment,
  resetEnvironmentsStateForTests,
  resolveActiveEnvironmentName,
  setEnvironmentOverride,
  validateEnvironmentConfig,
  writeActiveEnvironmentState,
  writeEnvironmentConfig,
  type EnvironmentConfig,
} from "../lib/environments";

const devEnv: EnvironmentConfig = {
  backend: "dev",
  orgId: "org-dev",
  productId: "prod-dev",
};

const prodEnv: EnvironmentConfig = {
  backend: "prod",
  orgId: "org-prod",
  productId: "prod-prod",
  protected: true,
};

describe("app environments", () => {
  let dir: string;
  let prevCwd: string;
  let prevFusebaseEnv: string | undefined;
  let warnSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    prevCwd = process.cwd();
    prevFusebaseEnv = process.env.FUSEBASE_ENV;
    delete process.env.FUSEBASE_ENV;
    dir = mkdtempSync(join(tmpdir(), "fuse-environments-"));
    process.chdir(dir);
    resetEnvironmentsStateForTests();
    overrideEnvironmentsFeatureForTests(true);
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(prevCwd);
    if (prevFusebaseEnv === undefined) {
      delete process.env.FUSEBASE_ENV;
    } else {
      process.env.FUSEBASE_ENV = prevFusebaseEnv;
    }
    resetEnvironmentsStateForTests();
    warnSpy?.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  function writeEnv(name: string, config: EnvironmentConfig): void {
    writeEnvironmentConfig(dir, name, config);
  }

  describe("validation", () => {
    it("accepts a minimal valid config", () => {
      expect(validateEnvironmentConfig(devEnv)).toEqual([]);
    });

    it("rejects missing backend and orgId", () => {
      const issues = validateEnvironmentConfig({});
      expect(issues.join("\n")).toContain('"backend" is required');
      expect(issues.join("\n")).toContain('"orgId" is required');
    });

    it("rejects unknown backend", () => {
      const issues = validateEnvironmentConfig({
        backend: "staging",
        orgId: "o",
      });
      expect(issues.join("\n")).toContain('"backend" must be one of');
    });

    it("rejects malformed apps entries", () => {
      const issues = validateEnvironmentConfig({
        backend: "dev",
        orgId: "o",
        apps: { portal: { id: 42 } },
      });
      expect(issues.join("\n")).toContain('"apps.portal.id" must be a string');
    });

    it("validates environment names", () => {
      expect(isValidEnvironmentName("prod-beta")).toBe(true);
      expect(isValidEnvironmentName("Prod")).toBe(false);
      expect(isValidEnvironmentName("")).toBe(false);
      expect(isValidEnvironmentName("-x")).toBe(false);
    });
  });

  describe("loading", () => {
    it("loads a written environment", () => {
      writeEnv("dev", devEnv);
      const loaded = loadEnvironmentConfig(dir, "dev");
      expect(loaded.backend).toBe("dev");
      expect(loaded.orgId).toBe("org-dev");
    });

    it("throws with available names for a missing environment", () => {
      writeEnv("dev", devEnv);
      expect(() => loadEnvironmentConfig(dir, "nope")).toThrow(
        /Available environments: dev/,
      );
    });

    it("throws with init hint when no environments exist", () => {
      mkdirSync(join(dir, ENVIRONMENTS_DIR), { recursive: true });
      expect(() => loadEnvironmentConfig(dir, "nope")).toThrow(
        /fusebase env init/,
      );
    });

    it("throws on invalid JSON", () => {
      mkdirSync(join(dir, ENVIRONMENTS_DIR), { recursive: true });
      writeFileSync(join(dir, ENVIRONMENTS_DIR, "bad.json"), "{oops", "utf-8");
      expect(() => loadEnvironmentConfig(dir, "bad")).toThrow(/invalid JSON/);
    });

    it("lists environment names sorted, ignoring non-json and invalid names", () => {
      writeEnv("prod", prodEnv);
      writeEnv("dev", devEnv);
      writeFileSync(join(dir, ENVIRONMENTS_DIR, "README.md"), "x", "utf-8");
      writeFileSync(join(dir, ENVIRONMENTS_DIR, "Bad Name.json"), "{}", "utf-8");
      expect(listEnvironmentNames(dir)).toEqual(["dev", "prod"]);
    });
  });

  describe("active environment resolution", () => {
    it("returns null in legacy mode (no environments dir)", () => {
      expect(getActiveEnvironment(dir)).toBeNull();
      expect(getActiveEnvironmentBackend()).toBeUndefined();
    });

    it("returns null with one-time hint when flag is off", () => {
      writeEnv("dev", devEnv);
      overrideEnvironmentsFeatureForTests(false);
      expect(getActiveEnvironment(dir)).toBeNull();
      expect(getActiveEnvironment(dir)).toBeNull();
      expect(warnSpy!.mock.calls.length).toBe(1);
      expect(String(warnSpy!.mock.calls[0]![0])).toContain("set-flag");
    });

    it("auto-picks a single environment", () => {
      writeEnv("dev", devEnv);
      const active = getActiveEnvironment(dir);
      expect(active?.name).toBe("dev");
      expect(active?.config.backend).toBe("dev");
      expect(
        resolveActiveEnvironmentName(dir),
      ).toEqual({ name: "dev", source: "single" });
    });

    it("warns once and falls back to legacy when multiple envs and no selection", () => {
      writeEnv("dev", devEnv);
      writeEnv("prod", prodEnv);
      expect(getActiveEnvironment(dir)).toBeNull();
      expect(getActiveEnvironment(dir)).toBeNull();
      expect(warnSpy!.mock.calls.length).toBe(1);
      expect(String(warnSpy!.mock.calls[0]![0])).toContain("fusebase env use");
    });

    it("uses state file selection", () => {
      writeEnv("dev", devEnv);
      writeEnv("prod", prodEnv);
      writeActiveEnvironmentState(dir, "prod");
      expect(readActiveEnvironmentState(dir)).toBe("prod");
      const active = getActiveEnvironment(dir);
      expect(active?.name).toBe("prod");
      expect(active?.config.protected).toBe(true);
    });

    it("FUSEBASE_ENV wins over state", () => {
      writeEnv("dev", devEnv);
      writeEnv("prod", prodEnv);
      writeActiveEnvironmentState(dir, "prod");
      process.env.FUSEBASE_ENV = "dev";
      expect(getActiveEnvironment(dir)?.name).toBe("dev");
    });

    it("setEnvironmentOverride wins over FUSEBASE_ENV and state", () => {
      writeEnv("dev", devEnv);
      writeEnv("prod", prodEnv);
      writeActiveEnvironmentState(dir, "dev");
      process.env.FUSEBASE_ENV = "dev";
      setEnvironmentOverride("prod");
      expect(getActiveEnvironment(dir)?.name).toBe("prod");
    });

    it("falls back to fusebase.json defaultEnvironment", () => {
      writeEnv("dev", devEnv);
      writeEnv("prod", prodEnv);
      writeFileSync(
        join(dir, "fusebase.json"),
        JSON.stringify({
          orgId: "legacy-org",
          productId: "legacy-product",
          defaultEnvironment: "prod",
        }),
        "utf-8",
      );
      expect(getActiveEnvironment(dir)?.name).toBe("prod");
    });

    it("throws on explicitly selected missing environment (no silent fallback)", () => {
      writeEnv("dev", devEnv);
      setEnvironmentOverride("typo");
      expect(() => getActiveEnvironment(dir)).toThrow(/Environment "typo"/);
    });

    it("getActiveEnvironmentBackend reflects the active environment", () => {
      writeEnv("prod", prodEnv);
      expect(getActiveEnvironmentBackend()).toBe("prod");
    });

    it("requireActiveEnvironment throws with guidance in legacy mode", () => {
      expect(() => requireActiveEnvironment(dir)).toThrow(/fusebase env init/);
      writeEnv("dev", devEnv);
      writeEnv("prod", prodEnv);
      expect(() => requireActiveEnvironment(dir)).toThrow(
        /fusebase env use <name>/,
      );
    });

    it("re-resolves after cache invalidation via state write", () => {
      writeEnv("dev", devEnv);
      writeEnv("prod", prodEnv);
      writeActiveEnvironmentState(dir, "dev");
      expect(getActiveEnvironment(dir)?.name).toBe("dev");
      writeActiveEnvironmentState(dir, "prod");
      expect(getActiveEnvironment(dir)?.name).toBe("prod");
    });
  });

  describe("getEnv integration", () => {
    it("getEnv returns the active environment backend", async () => {
      const { getEnv } = await import("../lib/config");
      writeEnv("dev", devEnv);
      expect(getEnv()).toBe("dev");
    });

    it("getEnv keeps legacy behavior without environments", async () => {
      const { getEnv } = await import("../lib/config");
      // No environments dir in cwd; global config may set dev or prod —
      // assert only that resolution does not throw and yields a value.
      expect(typeof getEnv()).toBe("string");
    });
  });

  describe("state & hygiene", () => {
    it("writes state file under .fusebase/", () => {
      writeEnv("dev", devEnv);
      writeActiveEnvironmentState(dir, "dev");
      const statePath = join(dir, PROJECT_STATE_DIR, PROJECT_STATE_FILE);
      expect(existsSync(statePath)).toBe(true);
      expect(JSON.parse(readFileSync(statePath, "utf-8"))).toEqual({
        activeEnvironment: "dev",
      });
    });

    it("preserves unknown state keys", () => {
      mkdirSync(join(dir, PROJECT_STATE_DIR), { recursive: true });
      writeFileSync(
        join(dir, PROJECT_STATE_DIR, PROJECT_STATE_FILE),
        JSON.stringify({ other: 1 }),
        "utf-8",
      );
      writeActiveEnvironmentState(dir, "dev");
      expect(
        JSON.parse(
          readFileSync(join(dir, PROJECT_STATE_DIR, PROJECT_STATE_FILE), "utf-8"),
        ),
      ).toEqual({ other: 1, activeEnvironment: "dev" });
    });

    it("ensureEnvGitignoreEntries appends missing entries once", () => {
      writeFileSync(join(dir, ".gitignore"), "node_modules/\n.env\n", "utf-8");
      const added = ensureEnvGitignoreEntries(dir);
      expect(added).toEqual([".env.*", ".fusebase/"]);
      const content = readFileSync(join(dir, ".gitignore"), "utf-8");
      expect(content).toContain(".env.*");
      expect(content).toContain(".fusebase/");
      expect(ensureEnvGitignoreEntries(dir)).toEqual([]);
    });

    it("ensureEnvGitignoreEntries creates .gitignore when absent", () => {
      const added = ensureEnvGitignoreEntries(dir);
      expect(added.length).toBe(2);
      expect(existsSync(join(dir, ".gitignore"))).toBe(true);
    });

    it("computes per-env dotenv paths", () => {
      expect(getEnvironmentEnvFilePath(dir, "prod-beta")).toBe(
        join(dir, ".env.prod-beta"),
      );
    });
  });

  describe("effectiveSubdomain", () => {
    it("prefers explicit per-app subdomain, then suffix, then default", () => {
      const config: EnvironmentConfig = {
        backend: "prod",
        orgId: "o",
        subdomainSuffix: "-beta",
        apps: {
          portal: { subdomain: "portal-custom" },
          admin: {},
        },
      };
      expect(effectiveSubdomain(config, "portal", "portal")).toBe(
        "portal-custom",
      );
      expect(effectiveSubdomain(config, "admin", "admin")).toBe("admin-beta");
      expect(effectiveSubdomain(config, "unknown", "site")).toBe("site-beta");
      expect(
        effectiveSubdomain({ backend: "dev", orgId: "o" }, "x", "site"),
      ).toBe("site");
    });
  });
});
