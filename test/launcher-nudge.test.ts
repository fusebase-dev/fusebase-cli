import { describe, expect, it } from "bun:test";

import { shouldNudgeLauncherUpdate } from "../lib/commands/steps/update-check";

describe("shouldNudgeLauncherUpdate", () => {
  it("nudges when the manifest launcher is newer than the running launcher", () => {
    expect(shouldNudgeLauncherUpdate("2026.061600.0000", "2026.061508.1200")).toBe(true);
  });

  it("does not nudge when up to date or older", () => {
    expect(shouldNudgeLauncherUpdate("2026.061508.1200", "2026.061508.1200")).toBe(false);
    expect(shouldNudgeLauncherUpdate("2026.061500.0000", "2026.061508.1200")).toBe(false);
  });

  it("does not nudge when not launched by a launcher (env absent)", () => {
    expect(shouldNudgeLauncherUpdate("2026.061600.0000", undefined)).toBe(false);
  });

  it("does not nudge when the manifest has no launcherVersion", () => {
    expect(shouldNudgeLauncherUpdate(undefined, "2026.061508.1200")).toBe(false);
  });
});
