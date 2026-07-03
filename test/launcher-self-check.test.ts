import { describe, expect, it } from "bun:test";

import { evaluateLauncherGate } from "../lib/launcher-self-check";
import { formatVersionInfo } from "../lib/version-output";

const base = {
  platform: "win32" as NodeJS.Platform,
  localLinked: false,
  required: "2026.061508.1200",
  argv: ["app", "list"],
};

describe("evaluateLauncherGate", () => {
  it("blocks on Windows when the launcher is older than required", () => {
    const r = evaluateLauncherGate({ ...base, launcherVersionEnv: "2026.061500.0000" });
    expect(r.block).toBe(true);
    expect(r.message).toContain("update --launcher");
  });

  it("blocks on Windows when the launcher env is absent", () => {
    const r = evaluateLauncherGate({ ...base, launcherVersionEnv: undefined });
    expect(r.block).toBe(true);
  });

  it("allows when the launcher meets the requirement", () => {
    expect(
      evaluateLauncherGate({ ...base, launcherVersionEnv: "2026.061508.1200" }).block,
    ).toBe(false);
    expect(
      evaluateLauncherGate({ ...base, launcherVersionEnv: "2026.070000.0000" }).block,
    ).toBe(false);
  });

  it("never blocks off Windows", () => {
    for (const platform of ["darwin", "linux"] as NodeJS.Platform[]) {
      expect(
        evaluateLauncherGate({ ...base, platform, launcherVersionEnv: undefined }).block,
      ).toBe(false);
    }
  });

  it("never blocks in local-linked/source mode", () => {
    expect(
      evaluateLauncherGate({ ...base, localLinked: true, launcherVersionEnv: undefined }).block,
    ).toBe(false);
  });

  it.each(["version", "--version", "-V", "--help", "-h"])(
    "allowlists %s even when the launcher is too old",
    (arg) => {
      expect(
        evaluateLauncherGate({ ...base, argv: [arg], launcherVersionEnv: undefined }).block,
      ).toBe(false);
    },
  );

  it("allowlists a bare invocation (no args) so help still shows", () => {
    expect(
      evaluateLauncherGate({ ...base, argv: [], launcherVersionEnv: undefined }).block,
    ).toBe(false);
  });

  it("allowlists `update --launcher` while blocking", () => {
    expect(
      evaluateLauncherGate({
        ...base,
        argv: ["update", "--launcher"],
        launcherVersionEnv: undefined,
      }).block,
    ).toBe(false);
  });

  it("does not allowlist a plain `update`", () => {
    expect(
      evaluateLauncherGate({ ...base, argv: ["update"], launcherVersionEnv: undefined }).block,
    ).toBe(true);
  });
});

describe("formatVersionInfo", () => {
  it("prints CLI version only when no launcher env", () => {
    expect(
      formatVersionInfo({ cliVersion: "0.25.6", launcherVersion: undefined, channel: "prod" }),
    ).toBe("0.25.6");
  });

  it("prints CLI + launcher + channel when launched by a launcher", () => {
    expect(
      formatVersionInfo({
        cliVersion: "0.25.6",
        launcherVersion: "2026.061508.1200",
        channel: "dev",
      }),
    ).toBe("FuseBase CLI 0.25.6\nLauncher 2026.061508.1200\nChannel dev");
  });
});
