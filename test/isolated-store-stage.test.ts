import { describe, it, expect } from "bun:test";
import { resolveStage } from "../lib/commands/isolated-store.ts";

describe("resolveStage", () => {
  it("follows the environment backend when --stage is omitted", () => {
    // Regression guard: a hardcoded "dev" default pointed FUSEBASE_ENV=prod runs
    // at the dev stage. On a store carrying both stages that asserts the wrong
    // data and reports a false OK; on a prod-only store it 404s.
    expect(resolveStage(undefined, "prod")).toBe("prod");
    expect(resolveStage(undefined, "dev")).toBe("dev");
  });

  it("lets an explicit --stage win over the environment", () => {
    expect(resolveStage("dev", "prod")).toBe("dev");
    expect(resolveStage("prod", "dev")).toBe("prod");
  });

  it("falls back to dev for an unknown or missing backend", () => {
    expect(resolveStage(undefined, undefined)).toBe("dev");
    expect(resolveStage("nonsense", "prod")).toBe("prod");
  });
});
