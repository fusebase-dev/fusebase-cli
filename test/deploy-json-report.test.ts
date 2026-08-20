import { describe, expect, it } from "bun:test";
import { buildDeployReport } from "../lib/commands/deploy";

// NIM-43466: `fusebase deploy --json` must give CI and agents a parseable
// payload instead of regex over the human log, so the shape is pinned here.
describe("buildDeployReport", () => {
  const base = {
    orgId: "org-1",
    productId: "prod-1",
    environment: "staging",
  };

  it("reports ok with the app coordinates a caller needs", () => {
    const report = buildDeployReport({
      ...base,
      results: [
        {
          appId: "app-1",
          versionId: "ver-1",
          url: "https://alpha.example.com",
          subdomain: "alpha",
          deployId: "dep-1",
          success: true,
        },
      ],
    });

    expect(report).toEqual({
      ok: true,
      orgId: "org-1",
      productId: "prod-1",
      environment: "staging",
      apps: [
        {
          appId: "app-1",
          subdomain: "alpha",
          url: "https://alpha.example.com",
          versionId: "ver-1",
          deployId: "dep-1",
          status: "deployed",
          error: undefined,
        },
      ],
      error: undefined,
    });
  });

  it("marks an unchanged app skipped, not deployed", () => {
    const report = buildDeployReport({
      ...base,
      results: [
        {
          appId: "app-1",
          versionId: "ver-1",
          url: "https://alpha.example.com",
          success: true,
          skipped: true,
        },
      ],
    });

    expect(report.ok).toBe(true);
    expect(report.apps[0]!.status).toBe("skipped");
  });

  it("is not ok when any app failed, and keeps the per-app error", () => {
    const report = buildDeployReport({
      ...base,
      results: [
        {
          appId: "app-1",
          versionId: "ver-1",
          url: "https://alpha.example.com",
          success: true,
        },
        {
          appId: "app-2",
          versionId: "",
          url: "",
          success: false,
          error: "build failed",
        },
      ],
    });

    expect(report.ok).toBe(false);
    expect(report.error).toEqual({
      kind: "deploy",
      message: "1 app(s) failed to deploy",
    });
    expect(report.apps[1]).toMatchObject({
      appId: "app-2",
      status: "failed",
      error: "build failed",
    });
    // Empty strings from the failed entry must not surface as empty values.
    expect(report.apps[1]!.url).toBeUndefined();
    expect(report.apps[1]!.versionId).toBeUndefined();
  });

  it("survives JSON round-trip, dropping only the undefined keys", () => {
    const report = buildDeployReport({
      ...base,
      results: [
        { appId: "app-1", versionId: "ver-1", url: "u", success: true },
      ],
    });
    const parsed = JSON.parse(JSON.stringify(report));

    expect(parsed.ok).toBe(true);
    expect(parsed.error).toBeUndefined();
    expect(parsed.apps[0].status).toBe("deployed");
  });
});
