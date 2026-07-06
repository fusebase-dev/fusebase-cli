import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  invalidateFuseConfigCache,
  writeResolvedAppIdToFusebaseJson,
} from "../lib/config";

// NIM-41875: after deploy, persist the reconcile-resolved id back into the
// declarative apps[] entry matched by subdomain.
describe("writeResolvedAppIdToFusebaseJson", () => {
  let dir: string;

  const write = (config: unknown) =>
    writeFileSync(join(dir, "fusebase.json"), JSON.stringify(config, null, 2));
  const readApps = () =>
    JSON.parse(readFileSync(join(dir, "fusebase.json"), "utf-8")).apps;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "write-app-id-"));
    invalidateFuseConfigCache();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    invalidateFuseConfigCache();
  });

  it("writes the id into the matching id-less entry (id first)", () => {
    write({
      orgId: "o",
      productId: "p",
      apps: [{ subdomain: "my-app", name: "My App", path: "apps/my-app" }],
    });
    expect(writeResolvedAppIdToFusebaseJson(dir, "my-app", "app-123")).toBe(true);
    const apps = readApps();
    expect(apps[0].id).toBe("app-123");
    expect(Object.keys(apps[0])[0]).toBe("id");
    // other fields preserved
    expect(apps[0].subdomain).toBe("my-app");
    expect(apps[0].path).toBe("apps/my-app");
  });

  it("only touches the entry with the matching subdomain", () => {
    write({
      orgId: "o",
      productId: "p",
      apps: [
        { subdomain: "a", path: "apps/a" },
        { subdomain: "b", path: "apps/b" },
      ],
    });
    writeResolvedAppIdToFusebaseJson(dir, "b", "app-b");
    const apps = readApps();
    expect(apps[0].id).toBeUndefined();
    expect(apps[1].id).toBe("app-b");
  });

  it("is a no-op when the entry already has an id (legacy)", () => {
    write({
      orgId: "o",
      productId: "p",
      apps: [{ id: "real-id", subdomain: "my-app", path: "apps/my-app" }],
    });
    expect(writeResolvedAppIdToFusebaseJson(dir, "my-app", "other")).toBe(false);
    expect(readApps()[0].id).toBe("real-id");
  });

  it("returns false when no entry matches the subdomain", () => {
    write({ orgId: "o", productId: "p", apps: [{ subdomain: "a" }] });
    expect(writeResolvedAppIdToFusebaseJson(dir, "missing", "x")).toBe(false);
  });

  it("returns false when fusebase.json is absent", () => {
    expect(writeResolvedAppIdToFusebaseJson(dir, "a", "x")).toBe(false);
  });
});
