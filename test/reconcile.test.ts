import { describe, expect, it } from "bun:test";
import {
  reconcileApps,
  type CreateAppFn,
  type AppPlatformState,
  reconcileAppsEnsureAppsExist,
} from "../lib/reconcile";
import type { FeatureConfig } from "../lib/config";

// NIM-41746: pure, network-free reconcile — `createFn` is injected, no real API.
// Match order is path → id → create; subdomain is never used to match or changed.
describe("reconcileApps", () => {
  const noCreate: CreateAppFn = async () => {
    throw new Error("createFn should not be called");
  };

  it("binds an id-less entry to an existing platform app by path", async () => {
    const decls: FeatureConfig[] = [{ subdomain: "my-app", path: "apps/a" }];
    const platform: AppPlatformState[] = [
      { id: "real-1", sub: "other", path: "apps/other", title: "test" },
      { id: "real-2", sub: "my-app", path: "apps/a", title: "test" },
    ];
    const res = await reconcileAppsEnsureAppsExist(decls, platform, noCreate);
    expect(res).toEqual([
      { appConfig: decls[0]!, appId: "real-2", action: "bound", platformApp: platform[1]! },
    ]);
  });

  it("creates a missing app, passing title/subdomain/path to createFn", async () => {
    const decls: FeatureConfig[] = [
      { subdomain: "fresh", name: "Fresh App", path: "apps/fresh" },
    ];
    const calls: Array<[string, string, string]> = [];
    const createFn: CreateAppFn = async (title, subdomain, path) => {
      calls.push([title, subdomain, path]);
      return { id: "new-1" };
    };
    const res = await reconcileAppsEnsureAppsExist(decls, [], createFn);
    expect(calls).toEqual([["Fresh App", "fresh", "apps/fresh"]]);
    expect(res).toEqual([
      { appConfig: decls[0]!, appId: "new-1", action: "created", platformApp: { id: "new-1", sub: "fresh", path: "apps/fresh", title: "Fresh App" } },
    ]);
  });

  it("falls back to subdomain as the create title when name is absent", async () => {
    const decls: FeatureConfig[] = [{ subdomain: "no-name", path: "apps/n" }];
    let usedTitle = "";
    const res = await reconcileAppsEnsureAppsExist(decls, [], async (title) => {
      usedTitle = title;
      return { id: "new-2" };
    });
    expect(usedTitle).toBe("no-name");
    expect(res[0]!.action).toBe("created");
  });

  it("falls back to id when no platform app matches the path", async () => {
    // Existing app created before path was tracked: empty platform path, so the
    // stored id is the only way to bind it — never re-created.
    const decls: FeatureConfig[] = [
      { id: "legacy-1", subdomain: "my-app", path: "apps/l" },
    ];
    const platform: AppPlatformState[] = [
      { id: "legacy-1", sub: "my-app", path: "", title: "test" },
    ];
    const res = await reconcileAppsEnsureAppsExist(decls, platform, noCreate);
    expect(res).toEqual([
      { appConfig: decls[0]!, appId: "legacy-1", action: "bound", platformApp: platform[0]! },
    ]);
  });

  it("prefers a path match over a stored id", async () => {
    const decls: FeatureConfig[] = [
      { id: "stored-old", subdomain: "my-app", path: "apps/x" },
    ];
    const platform: AppPlatformState[] = [
      { id: "stored-old", sub: "my-app", path: "apps/other", title: "test" },
      { id: "real-new", sub: "my-app", path: "apps/x", title: "test" },
    ];
    const res = await reconcileAppsEnsureAppsExist(decls, platform, noCreate);
    expect(res[0]!.appId).toBe("real-new");
    expect(res[0]!.action).toBe("bound");
  });

  it("resolves a mix of id-bound, path-bound and created entries", async () => {
    const decls: FeatureConfig[] = [
      { id: "legacy-1", subdomain: "leg", path: "apps/l" },
      { subdomain: "exists", path: "apps/e" },
      { subdomain: "missing", path: "apps/m" },
    ];
    const platform: AppPlatformState[] = [
      { id: "legacy-1", sub: "leg", path: "", title: "test" },
      { id: "real-e", sub: "exists", path: "apps/e", title: "test" },
    ];
    const res = await reconcileAppsEnsureAppsExist(decls, platform, async () => ({
      id: "real-m",
    }));
    expect(res.map((r) => [r.appId, r.action])).toEqual([
      ["legacy-1", "bound"],
      ["real-e", "bound"],
      ["real-m", "created"],
    ]);
  });

  it("throws for a declaration with neither id nor subdomain", async () => {
    await expect(
      reconcileAppsEnsureAppsExist([{ path: "apps/x" }], [], noCreate),
    ).rejects.toThrow(/either an "id".*or a.*"subdomain"/s);
  });

  it("throws on a duplicate path across declarations", async () => {
    const decls: FeatureConfig[] = [
      { subdomain: "a", path: "apps/dup" },
      { subdomain: "b", path: "apps/dup" },
    ];
    await expect(reconcileAppsEnsureAppsExist(decls, [], noCreate)).rejects.toThrow(
      /duplicate app path "apps\/dup"/,
    );
  });
});
