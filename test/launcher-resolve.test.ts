import { describe, expect, it } from "bun:test";

import {
  PREVIOUS_VERSION_FLAG,
  selectFallbackVersion,
  stripLauncherFlags,
  wantsPreviousVersion,
} from "../launcher/launcher-core";

describe("wantsPreviousVersion", () => {
  it("detects the --previous-version flag anywhere in argv", () => {
    expect(wantsPreviousVersion(["app", "list"])).toBe(false);
    expect(wantsPreviousVersion([PREVIOUS_VERSION_FLAG])).toBe(true);
    expect(wantsPreviousVersion(["deploy", PREVIOUS_VERSION_FLAG])).toBe(true);
  });
});

describe("stripLauncherFlags", () => {
  it("removes only launcher-only flags, forwarding the rest unchanged", () => {
    expect(stripLauncherFlags([PREVIOUS_VERSION_FLAG, "app", "list"])).toEqual(["app", "list"]);
    expect(stripLauncherFlags(["app", "list", "--json"])).toEqual(["app", "list", "--json"]);
  });
});

describe("selectFallbackVersion", () => {
  it("returns the newest cached version that isn't active", () => {
    expect(selectFallbackVersion(["0.25.6", "0.25.5", "0.25.4"], "0.25.6")).toBe("0.25.5");
  });

  it("returns null when the only cached version is the active one", () => {
    expect(selectFallbackVersion(["0.25.6"], "0.25.6")).toBeNull();
  });

  it("returns null when nothing is cached", () => {
    expect(selectFallbackVersion([], "0.25.6")).toBeNull();
  });
});
