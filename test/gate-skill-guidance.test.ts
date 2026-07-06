import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const templateRoot = resolve(
  import.meta.dir,
  "..",
  "project-template/.claude/skills/fusebase-gate",
);

function readTemplateFile(...parts: string[]): string {
  return readFileSync(join(templateRoot, ...parts), "utf8");
}

describe("fusebase-gate template guidance", () => {
  it("tells generated apps to gate membership through getMyOrgAccess", () => {
    // The getMyOrgAccess verification guidance lives in the topic reference files
    // (membership/sdk/users). The generated SKILL.md entrypoint is a link index
    // and no longer duplicates it, so this test guards the references directly.
    const membership = readTemplateFile("references", "membership.md");
    const sdk = readTemplateFile("references", "sdk.md");
    const users = readTemplateFile("references", "users.md");

    expect(membership).toContain("Never unlock org UI from addOrgUser success alone; confirm with getMyOrgAccess.");
    expect(membership).toContain("`result: \"invite\"` means an invite record exists, not that the current session already has org access.");

    expect(sdk).toContain("After sign-up, sign-in, or provisioning writes, re-check AccessApi.getMyOrgAccess before unlocking org content.");
    // Assert the durable safety clause rather than the full sentence — these
    // references are synced from upstream MCP prompts and get reworded (the
    // `/me` phrasing has already drifted once).
    expect(sdk).toContain("as the source of truth unless it delegates to getMyOrgAccess.");

    expect(users).toContain("A 201 from addOrgUser is not proof that the current session or target user already has org access.");
    expect(users).toContain("For access gating after provisioning, verify with getMyOrgAccess instead of inferring from addOrgUser success.");
  });
});
