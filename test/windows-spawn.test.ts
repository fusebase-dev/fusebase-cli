import { describe, expect, it } from "bun:test";

import { buildInstallerCmdScript, resolveComSpec } from "../lib/commands/cli";

describe("resolveComSpec", () => {
  it("prefers %ComSpec%", () => {
    expect(resolveComSpec({ ComSpec: "D:\\Win\\System32\\cmd.exe" })).toBe(
      "D:\\Win\\System32\\cmd.exe",
    );
  });

  it("falls back to an absolute path under %SystemRoot%, never a bare name", () => {
    expect(resolveComSpec({ SystemRoot: "D:\\Win" })).toContain("cmd.exe");
    expect(resolveComSpec({})).toContain("cmd.exe");
    expect(resolveComSpec({})).not.toBe("cmd.exe");
  });
});

describe("buildInstallerCmdScript", () => {
  const script = buildInstallerCmdScript("launch-installer.ps1");

  it("invokes PowerShell by %SystemRoot% path, not through PATH", () => {
    expect(script).toContain(
      "set PS=%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
    expect(script).toContain(
      `"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-installer.ps1"`,
    );
    // no line starts a command with the bare name (the only mention is the fallback assignment)
    const invocations = script
      .split("\r\n")
      .filter((line) => line.trimStart().toLowerCase().startsWith("powershell"));
    expect(invocations).toEqual([]);
  });
});
