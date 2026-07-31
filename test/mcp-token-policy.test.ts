import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  getExpectedMcpPolicyFingerprints,
  buildGateMcpTokenRequest,
  matchesCurrentOrLegacyFallback,
} from "../lib/mcp-token-policy.ts";
import {
  setConfigFilePathForTests,
  type Config,
} from "../lib/config.ts";

describe("MCP token policy", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fuse-mcp-policy-"));
    configPath = join(dir, "config.json");
    setConfigFilePathForTests(configPath);
  });

  afterEach(() => {
    setConfigFilePathForTests(null);
    rmSync(dir, { recursive: true, force: true });
  });

  function seedConfig(config: Config): void {
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    setConfigFilePathForTests(configPath);
  }

  it("does not include markdown note permissions by default", () => {
    seedConfig({ env: "dev" });

    expect(buildGateMcpTokenRequest("org_1", "app_1").permissions).not.toContain(
      "notes.markdown.write",
    );
  });

  it("includes markdown note permissions when notes-markdown flag is enabled", () => {
    seedConfig({ env: "dev", flags: ["notes-markdown"] });

    expect(buildGateMcpTokenRequest("org_1", "app_1").permissions).toEqual(
      expect.arrayContaining(["notes.markdown.read", "notes.markdown.write"]),
    );
  });

  it("requires MCP token refresh for legacy envs when notes-markdown flag is enabled", () => {
    seedConfig({ env: "dev", flags: ["notes-markdown"] });

    expect(matchesCurrentOrLegacyFallback({})).toBe(false);
    expect(
      matchesCurrentOrLegacyFallback({
        dashboards: getExpectedMcpPolicyFingerprints().dashboards,
        gate: getExpectedMcpPolicyFingerprints().gate,
      }),
    ).toBe(true);
  });
});
