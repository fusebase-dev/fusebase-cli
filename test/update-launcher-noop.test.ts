import { describe, expect, it } from "bun:test";

import { getInstallerUrl, BASE_URL } from "../lib/remote-version";
import { LAUNCHER_UPDATE_NOOP_MESSAGE } from "../lib/commands/update";

describe("getInstallerUrl", () => {
  it("points at the versioned NSIS installer artifact", () => {
    expect(getInstallerUrl("0.25.6")).toBe(`${BASE_URL}/0.25.6/fusebase-installer-0.25.6.exe`);
  });
});

describe("update --launcher non-Windows", () => {
  it("has a clear Windows-only no-op message", () => {
    expect(LAUNCHER_UPDATE_NOOP_MESSAGE).toContain("Windows-only");
  });
});
