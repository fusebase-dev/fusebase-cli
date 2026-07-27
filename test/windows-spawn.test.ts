import { describe, expect, it } from "bun:test";

import { resolveComSpec } from "../lib/commands/cli";

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
