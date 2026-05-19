/**
 * Per NIM-40978 / NIM-40980, the legacy `fusebase feature *` commands remain
 * as deprecated aliases for `fusebase app *`. Removing them is a separate
 * follow-up; until then we assert the alias surface still exists so a future
 * regression doesn't silently strip user-facing backwards compatibility.
 */
import { describe, expect, it } from "bun:test";
import { featureCommand } from "../lib/commands/feature";

describe("fusebase feature (deprecated alias)", () => {
  it("registers the top-level `feature` command", () => {
    expect(featureCommand.name()).toBe("feature");
    expect(featureCommand.description()).toMatch(/deprecated/i);
  });

  it("exposes list/create/update/get subcommands", () => {
    const names = featureCommand.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["create", "get", "list", "update"]);
  });

  it("each subcommand is marked deprecated in its description", () => {
    for (const sub of featureCommand.commands) {
      expect(sub.description()).toMatch(/deprecated/i);
    }
  });
});
