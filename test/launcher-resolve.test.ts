import { describe, expect, it } from "bun:test";

import {
  PREVIOUS_VERSION_FLAG,
  isLauncherAwareCliVersion,
  isLauncherUpdateCommand,
  isUpdateCommand,
  selectFallbackVersion,
  selectLauncherAwareFallback,
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

describe("isUpdateCommand", () => {
  it("detects ordinary update commands", () => {
    expect(isUpdateCommand(["update"])).toBe(true);
    expect(isUpdateCommand(["update", "--skip-product"])).toBe(true);
    expect(isUpdateCommand(["app", "list"])).toBe(false);
  });
});

describe("isLauncherUpdateCommand", () => {
  it("detects only the explicit launcher refresh command", () => {
    expect(isLauncherUpdateCommand(["update", "--launcher"])).toBe(true);
    expect(isLauncherUpdateCommand(["update"])).toBe(false);
    expect(isLauncherUpdateCommand(["app", "list", "--launcher"])).toBe(false);
  });
});

describe("isLauncherAwareCliVersion", () => {
  it("classifies the legacy prod boundary", () => {
    expect(isLauncherAwareCliVersion("0.25.7")).toBe(false);
    expect(isLauncherAwareCliVersion("0.25.8")).toBe(true);
  });

  it("classifies the first launcher-aware dev build boundary", () => {
    expect(isLauncherAwareCliVersion("2026.062310.0435")).toBe(false);
    expect(isLauncherAwareCliVersion("2026.062310.0436")).toBe(true);
    expect(isLauncherAwareCliVersion("2026.062311.0000")).toBe(true);
  });
});

describe("selectLauncherAwareFallback", () => {
  it("returns the newest launcher-aware cached version that is not active", () => {
    expect(
      selectLauncherAwareFallback(["2026.062310.0436", "0.25.7"], "0.25.7"),
    ).toBe("2026.062310.0436");
  });

  it("skips legacy versions and the active version", () => {
    expect(
      selectLauncherAwareFallback(
        ["2026.062311.0000", "2026.062310.0436", "0.25.7"],
        "2026.062311.0000",
      ),
    ).toBe("2026.062310.0436");
  });

  it("returns null when no launcher-aware fallback exists", () => {
    expect(selectLauncherAwareFallback(["0.25.7", "0.25.6"], "0.25.7")).toBeNull();
  });
});
