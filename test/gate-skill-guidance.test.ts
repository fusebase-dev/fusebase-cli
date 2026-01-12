import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const templateRoot = "/Users/di/Fusebase/apps-cli/project-template/.claude/skills/fusebase-gate";

function readTemplateFile(...parts: string[]): string {
  return readFileSync(join(templateRoot, ...parts), "utf8");
}

describe("fusebase-gate template guidance", () => {
  it("tells generated apps to gate membership through getMyOrgAccess", () => {
    const entry = readTemplateFile("SKILL.md");
    const membership = readTemplateFile("references", "membership.md");
    const sdk = readTemplateFile("references", "sdk.md");
    const users = readTemplateFile("references", "users.md");

    expect(entry).toContain("Do not invent readiness checks through custom `/api/account/me` endpoints unless they delegate to `getMyOrgAccess`.");
    expect(entry).toContain('Do not return `membership: "ready"` from custom auth routes unless the route actually verifies org access via `getMyOrgAccess`.');

    expect(membership).toContain("Never unlock org UI from addOrgUser success alone; confirm with getMyOrgAccess.");
    expect(membership).toContain("`result: \"invite\"` means an invite record exists, not that the current session already has org access.");

    expect(sdk).toContain("After sign-up, sign-in, or provisioning writes, re-check AccessApi.getMyOrgAccess before unlocking org content.");
    expect(sdk).toContain("Do not treat a custom `/me` or `/api/account/me` endpoint as the source of truth unless it delegates to getMyOrgAccess.");

    expect(users).toContain("A 201 from addOrgUser is not proof that the current session or target user already has org access.");
    expect(users).toContain("For access gating after provisioning, verify with getMyOrgAccess instead of inferring from addOrgUser success.");
  });
});
