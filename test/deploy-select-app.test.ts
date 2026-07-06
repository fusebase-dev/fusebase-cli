import { describe, expect, it } from "bun:test";
import { selectDeployableApps } from "../lib/commands/deploy";
import type { FeatureConfig } from "../lib/config";

// NIM-41998: `fusebase deploy --app <selector>` narrows the deploy to one app,
// matching on any stable user-facing key (subdomain/id/name/path).
describe("selectDeployableApps", () => {
  const apps: FeatureConfig[] = [
    { subdomain: "alpha", name: "Alpha", path: "apps/alpha" },
    { id: "real-1", subdomain: "beta", name: "Beta", path: "apps/beta" },
  ];

  it("matches by subdomain", () => {
    expect(selectDeployableApps(apps, "alpha")).toEqual([apps[0]]);
  });

  it("matches a legacy entry by id", () => {
    expect(selectDeployableApps(apps, "real-1")).toEqual([apps[1]]);
  });

  it("matches by name and by path", () => {
    expect(selectDeployableApps(apps, "Beta")).toEqual([apps[1]]);
    expect(selectDeployableApps(apps, "apps/alpha")).toEqual([apps[0]]);
  });

  it("returns empty for an unknown selector", () => {
    expect(selectDeployableApps(apps, "nope")).toEqual([]);
  });
});
