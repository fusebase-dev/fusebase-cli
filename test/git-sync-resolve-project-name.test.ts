import {
  mkdtempSync,
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
import * as configModule from "../lib/config";
import * as apiModule from "../lib/api";
import type { Product } from "../lib/api";
import { resolveProjectName } from "../lib/git-sync";

describe("resolveProjectName fusebase.json lookup", () => {
  let dir: string;
  let prevCwd: string;
  let getConfigSpy: ReturnType<typeof spyOn> | undefined;
  let fetchProductSpy: ReturnType<typeof spyOn> | undefined;
  let getEnvSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    prevCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), "git-sync-resolve-"));
    process.chdir(dir);
    configModule.invalidateFuseConfigCache();
    configModule.resetLegacyShapeWarningForTests();

    getConfigSpy = spyOn(configModule, "getConfig").mockReturnValue({
      apiKey: "test-key",
    });
    getEnvSpy = spyOn(configModule, "getEnv").mockReturnValue("dev");
    fetchProductSpy = spyOn(apiModule, "fetchProduct").mockResolvedValue({
      id: "prod-123",
      title: "Acme Coffee",
      sub: "acme",
    } as Product);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
    configModule.invalidateFuseConfigCache();
    configModule.resetLegacyShapeWarningForTests();
    getConfigSpy?.mockRestore();
    getEnvSpy?.mockRestore();
    fetchProductSpy?.mockRestore();
  });

  it("uses productId from fusebase.json to fetch product when no explicit subdomain/title is provided", async () => {
    writeFileSync(
      join(dir, "fusebase.json"),
      JSON.stringify({ orgId: "org-1", productId: "prod-123" }),
      "utf-8",
    );

    const name = await resolveProjectName({ cwd: dir, env: "dev" });

    expect(fetchProductSpy).toHaveBeenCalledTimes(1);
    expect(fetchProductSpy).toHaveBeenCalledWith(
      "test-key",
      "org-1",
      "prod-123",
    );
    expect(name).toBe("app-acme-coffee-dev");
  });

  it("falls back to folder name when fusebase.json has no productId (and skips fetchProduct)", async () => {
    writeFileSync(
      join(dir, "fusebase.json"),
      JSON.stringify({ orgId: "org-1" }),
      "utf-8",
    );

    const name = await resolveProjectName({ cwd: dir, env: "dev" });

    expect(fetchProductSpy).not.toHaveBeenCalled();
    // folder name is the random tmpdir basename, but should still be slugified with the dev suffix
    expect(name).toMatch(/^app-.+-dev$/);
  });

  it("auto-migrates legacy `appId` and uses it as productId", async () => {
    writeFileSync(
      join(dir, "fusebase.json"),
      JSON.stringify({ orgId: "org-1", appId: "legacy-prod-id" }),
      "utf-8",
    );

    await resolveProjectName({ cwd: dir, env: "dev" });

    expect(fetchProductSpy).toHaveBeenCalledWith(
      "test-key",
      "org-1",
      "legacy-prod-id",
    );
  });

  it("ignores fusebase.json when explicit appSubdomain is provided", async () => {
    writeFileSync(
      join(dir, "fusebase.json"),
      JSON.stringify({ orgId: "org-1", productId: "prod-123" }),
      "utf-8",
    );

    const name = await resolveProjectName({
      cwd: dir,
      env: "dev",
      appSubdomain: "explicit-sub",
      appTitle: "Explicit Title",
    });

    expect(fetchProductSpy).not.toHaveBeenCalled();
    expect(name).toBe("app-explicit-title-dev");
  });
});
