import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  provisionStoresForEnvironment,
  gateStoreAlias,
  classifyRls,
  StoreAliasCollisionError,
  type GateTransport,
  type ProvisionAppInput,
} from "../lib/provision-store.ts";
import type { GateServiceRequestOptions } from "../lib/gate-api.ts";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeProject(envName: string): { cwd: string; app: ProvisionAppInput } {
  const cwd = mkdtempSync(join(tmpdir(), "prov-store-"));
  tempDirs.push(cwd);
  mkdirSync(join(cwd, "environments"), { recursive: true });
  writeFileSync(
    join(cwd, "environments", `${envName}.json`),
    JSON.stringify({ backend: "dev", orgId: "org1", productId: "prod1", apps: {} }),
  );
  const migDir = join(cwd, "apps/probe/postgres/migrations");
  mkdirSync(migDir, { recursive: true });
  writeFileSync(join(migDir, "0001_init.sql"), "CREATE TABLE t (id int);");
  writeFileSync(
    join(migDir, "manifest.json"),
    JSON.stringify({ migrations: [{ version: 1, name: "0001_init", file: "0001_init.sql" }] }),
  );
  const app: ProvisionAppInput = {
    key: "probe",
    appConfig: {
      id: "app1",
      key: "probe",
      path: "apps/probe",
      isolatedStores: {
        sql: [{ alias: "todos", migrationsDir: "postgres/migrations", schemaName: "public" }],
      },
    } as ProvisionAppInput["appConfig"],
  };
  return { cwd, app };
}

interface GateCall {
  method: string;
  path: string;
  body?: unknown;
}

/** Fake Gate transport: records calls, answers by path suffix. */
function fakeGate(
  calls: GateCall[],
  overrides: { rls?: Record<string, unknown>; created?: boolean } = {},
): GateTransport {
  return (async <T>(options: GateServiceRequestOptions): Promise<T> => {
    calls.push({ method: options.method, path: options.path, body: options.body });
    if (options.path.endsWith("/get-or-create")) {
      return {
        created: overrides.created ?? true,
        cloned: false,
        store: { globalId: "store-xyz" },
        stageInstance: { status: "ready" },
      } as T;
    }
    if (options.path.endsWith("/migrations/apply")) {
      return { appliedCount: 1, appliedVersions: [1] } as T;
    }
    if (options.path.endsWith("/migrations/status")) {
      return { appliedCount: 1, pendingCount: 0, isDrifted: false } as T;
    }
    if (options.path.endsWith("/rls/status")) {
      return {
        tableCount: 2,
        rlsEnabledCount: 0,
        bypassRls: false,
        superuser: false,
        currentUser: "isolated_pg_runtime",
        ...overrides.rls,
      } as T;
    }
    throw new Error(`unexpected gate path ${options.path}`);
  }) as GateTransport;
}

describe("gateStoreAlias", () => {
  it("suffixes with the environment name", () => {
    expect(gateStoreAlias("todos", "dev-bravo")).toBe("todos-dev-bravo");
  });
  it("honors an explicit override suffix", () => {
    expect(gateStoreAlias("todos", "dev-bravo", "custom")).toBe("todos-custom");
  });
});

describe("classifyRls", () => {
  it("flags bypassRls/superuser as unenforced", () => {
    expect(classifyRls({ tableCount: 2, bypassRls: true }).verdict).toBe("unenforced");
    expect(classifyRls({ tableCount: 2, superuser: true }).verdict).toBe("unenforced");
  });
  it("flags data tables with no policy", () => {
    const r = classifyRls({ tableCount: 2, rlsEnabledCount: 0 });
    expect(r.verdict).toBe("no-policy");
    expect(r.dataTables).toBe(1); // journal table excluded
  });
  it("reports ok when a data table is protected", () => {
    expect(classifyRls({ tableCount: 2, rlsEnabledCount: 1 }).verdict).toBe("ok");
  });
  it("is unknown when only the journal table exists", () => {
    expect(classifyRls({ tableCount: 1, rlsEnabledCount: 0 }).verdict).toBe("unknown");
  });
});

describe("provisionStoresForEnvironment", () => {
  it("dry-run plans without calling Gate or touching the lockfile", async () => {
    const { cwd, app } = makeProject("dev");
    const calls: GateCall[] = [];
    const results = await provisionStoresForEnvironment({
      cwd,
      envName: "dev",
      backend: "dev",
      orgId: "org1",
      productId: "prod1",
      apps: [app],
      gate: fakeGate(calls),
      dryRun: true,
    });
    expect(calls).toHaveLength(0);
    expect(results[0]?.planned).toBe(true);
    expect(results[0]?.gateAlias).toBe("todos-dev");
    const lock = JSON.parse(readFileSync(join(cwd, "environments/dev.json"), "utf-8"));
    expect(lock.apps.probe?.stores).toBeUndefined();
  });

  it("creates, applies, verifies, and records the storeId under the logical alias", async () => {
    const { cwd, app } = makeProject("dev");
    const calls: GateCall[] = [];
    const results = await provisionStoresForEnvironment({
      cwd,
      envName: "dev",
      backend: "dev",
      orgId: "org1",
      productId: "prod1",
      apps: [app],
      gate: fakeGate(calls),
    });

    // ordered Gate calls
    expect(calls.map((c) => c.path.split("/").pop())).toEqual([
      "get-or-create",
      "apply",
      "status",
      "status", // rls/status also ends in "status"
    ]);
    // create uses env-suffixed alias + productId as client
    const create = calls[0]!;
    expect((create.body as { alias: string }).alias).toBe("todos-dev");
    expect((create.body as { clientId: string }).clientId).toBe("prod1");

    // result summary
    expect(results[0]?.storeId).toBe("store-xyz");
    expect(results[0]?.created).toBe(true);
    expect(results[0]?.applied).toBe(1);
    expect(results[0]?.pending).toBe(0);
    expect(results[0]?.rls).toBe("no-policy");

    // lockfile records storeId under the LOGICAL alias, not the Gate alias
    const lock = JSON.parse(readFileSync(join(cwd, "environments/dev.json"), "utf-8"));
    expect(lock.apps.probe.stores.todos).toBe("store-xyz");
    expect(lock.apps.probe.stores["todos-dev"]).toBeUndefined();
  });

  it("applies an explicit alias-suffix override to the Gate alias", async () => {
    const { cwd, app } = makeProject("dev");
    const calls: GateCall[] = [];
    await provisionStoresForEnvironment({
      cwd,
      envName: "dev",
      backend: "dev",
      orgId: "org1",
      productId: "prod1",
      apps: [app],
      gate: fakeGate(calls),
      aliasSuffix: "shared",
    });
    expect((calls[0]!.body as { alias: string }).alias).toBe("todos-shared");
  });

  it("maps an org alias collision to StoreAliasCollisionError", async () => {
    const { cwd, app } = makeProject("dev");
    const collidingGate: GateTransport = (async () => {
      throw new Error(
        'Gate service request failed: 400\n{"message":"Managed store alias \'todos-dev\' already exists in org \'org1\'"}',
      );
    }) as GateTransport;
    await expect(
      provisionStoresForEnvironment({
        cwd,
        envName: "dev",
        backend: "dev",
        orgId: "org1",
        productId: "prod1",
        apps: [app],
        gate: collidingGate,
      }),
    ).rejects.toBeInstanceOf(StoreAliasCollisionError);
  });

  it("resolves an EXPLICIT migrationsDir from the repo root when the app has none", async () => {
    const { cwd, app } = makeProject("dev");
    // Shared, repo-level migrations folder — the case repo-relative resolution
    // exists for. The app-relative folder must not shadow it.
    const shared = join(cwd, "shared/postgres/migrations");
    mkdirSync(shared, { recursive: true });
    writeFileSync(join(shared, "0001_shared.sql"), "CREATE TABLE s (id int);");
    writeFileSync(
      join(shared, "manifest.json"),
      JSON.stringify({
        migrations: [{ version: 1, name: "0001_shared", file: "0001_shared.sql" }],
      }),
    );
    app.appConfig.isolatedStores!.sql![0]!.migrationsDir = "shared/postgres/migrations";

    const calls: GateCall[] = [];
    await provisionStoresForEnvironment({
      cwd,
      envName: "dev",
      backend: "dev",
      orgId: "org1",
      productId: "prod1",
      apps: [app],
      gate: fakeGate(calls),
    });

    const applied = calls.find((c) => c.path.endsWith("/migrations/apply"));
    const bundle = (applied!.body as { bundle: { migrations: Array<{ name: string }> } })
      .bundle;
    expect(bundle.migrations).toHaveLength(1);
    expect(bundle.migrations[0]!.name).toBe("0001_shared");
  });

  it("rejects a local backend", async () => {
    const { cwd, app } = makeProject("dev");
    await expect(
      provisionStoresForEnvironment({
        cwd,
        envName: "dev",
        backend: "local",
        orgId: "org1",
        productId: "prod1",
        apps: [app],
        gate: fakeGate([]),
      }),
    ).rejects.toThrow(/dev or prod backend/);
  });
});
