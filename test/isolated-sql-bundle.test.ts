import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { FeatureConfig } from "../lib/config";
import {
  buildSqlMigrationBundleArtifact,
  calculateSqlMigrationChecksum,
  canonicalizeSqlForGate,
  resolveSqlStoreConfig,
} from "../lib/isolated-sql-bundle";

let dir: string;
const REPO_ROOT = resolve(import.meta.dir, "..");
const CLI_ENTRY = join(REPO_ROOT, "index.ts");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fusebase-sql-bundle-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("isolated SQL bundle helpers", () => {
  it("canonicalizes SQL like Gate checksum validation", () => {
    expect(canonicalizeSqlForGate("SELECT 1;\r\n\n\t")).toBe("SELECT 1;");
  });

  it("builds a bundle and reads rls-manifest.json", () => {
    const migrationsDir = join(dir, "postgres", "migrations");
    mkdirSync(migrationsDir, { recursive: true });
    const sql = "CREATE TABLE public.tasks (id uuid primary key);\n";
    const checksum = calculateSqlMigrationChecksum(sql);
    writeFileSync(join(migrationsDir, "0001_init.sql"), sql);
    writeFileSync(
      join(migrationsDir, "manifest.json"),
      JSON.stringify({
        bundleVersion: 1,
        migrations: [
          {
            version: "0001",
            name: "init",
            file: "0001_init.sql",
            checksum,
          },
        ],
      }),
    );
    writeFileSync(
      join(migrationsDir, "rls-manifest.json"),
      JSON.stringify({
        tables: {
          tasks: {
            classification: "tenant",
            orgColumn: "org_id",
            userColumn: "user_id",
          },
        },
      }),
    );

    const appConfig: FeatureConfig = {
      id: "app-1",
      path: "apps/app-1",
      isolatedStores: {
        sql: [{ alias: "tasks", schemaName: "public" }],
      },
    };
    const store = resolveSqlStoreConfig(appConfig);
    expect(store?.alias).toBe("tasks");

    const artifact = buildSqlMigrationBundleArtifact({
      appConfig,
      appBasePath: dir,
      store: store!,
    });
    expect(artifact.bundle.migrations).toHaveLength(1);
    expect(artifact.bundle.migrations[0]!.version).toBe(1);
    expect(artifact.bundle.migrations[0]!.checksum).toBe(checksum);
    expect(artifact.rlsManifest?.tables.tasks?.classification).toBe("tenant");
    expect(artifact.warnings).toEqual([]);
  });

  it("warns when manifest checksum differs from file checksum", () => {
    const migrationsDir = join(dir, "postgres", "migrations");
    mkdirSync(migrationsDir, { recursive: true });
    writeFileSync(join(migrationsDir, "V001__init.sql"), "SELECT 1;\n");
    writeFileSync(
      join(migrationsDir, "manifest.json"),
      JSON.stringify({
        migrations: [
          {
            version: 1,
            file: "V001__init.sql",
            checksum: "bad",
          },
        ],
      }),
    );

    const appConfig: FeatureConfig = {
      id: "app-1",
      path: "apps/app-1",
      isolatedStores: {
        sql: [{ alias: "tasks" }],
      },
    };
    const artifact = buildSqlMigrationBundleArtifact({
      appConfig,
      appBasePath: dir,
      store: appConfig.isolatedStores!.sql![0]!,
    });
    expect(artifact.bundle.migrations[0]!.name).toBe("init");
    expect(artifact.warnings[0]).toContain("manifest checksum bad differs");
  });
});

describe("isolated SQL bundle CLI flag", () => {
  async function runCli(args: string[], cwd: string, home: string) {
    const proc = Bun.spawn({
      cmd: ["bun", CLI_ENTRY, ...args],
      cwd,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        FUSEBASE_DISABLE_ANALYTICS: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  }

  function writeCliWorkspace(flags: string[] = []) {
    const projectDir = join(dir, "project");
    const homeDir = join(dir, "home");
    const configDir = join(homeDir, ".fusebase");
    const appDir = join(projectDir, "apps", "app-1");
    const migrationsDir = join(appDir, "postgres", "migrations");
    mkdirSync(configDir, { recursive: true });
    mkdirSync(migrationsDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        env: "dev",
        ...(flags.length > 0 ? { flags } : {}),
      }),
    );
    writeFileSync(
      join(projectDir, "fusebase.json"),
      JSON.stringify({
        orgId: "org-1",
        productId: "app-1",
        apps: [
          {
            id: "app-1",
            path: "apps/app-1",
            isolatedStores: {
              sql: [
                {
                  alias: "tasks",
                  storeId: "00000000-0000-0000-0000-000000000000",
                  migrationsDir: "postgres/migrations",
                  schemaName: "public",
                },
              ],
            },
          },
        ],
      }),
    );
    writeFileSync(join(migrationsDir, "0001_init.sql"), "SELECT 1;\n");
    writeFileSync(
      join(migrationsDir, "rls-manifest.json"),
      JSON.stringify({
        tables: {
          tasks: {
            classification: "tenant",
            orgColumn: "org_id",
          },
        },
      }),
    );
    writeFileSync(
      join(migrationsDir, "manifest.json"),
      JSON.stringify({
        bundleVersion: 1,
        migrations: [{ version: 1, name: "init", file: "0001_init.sql" }],
      }),
    );
    return { projectDir, homeDir };
  }

  it("builds JSON without requiring the legacy isolated-stores flag", async () => {
    const ws = writeCliWorkspace();
    const result = await runCli(
      ["isolated-store", "sql", "bundle", "--app", "app-1", "--json"],
      ws.projectDir,
      ws.homeDir,
    );

    expect(result.exitCode).toBe(0);
    const body = JSON.parse(result.stdout) as {
      bundle: { migrations: Array<{ version: number; name: string }> };
      rlsManifest?: unknown;
      schemaName: string;
    };
    expect(body.schemaName).toBe("public");
    expect(body.bundle.migrations).toEqual([
      expect.objectContaining({ version: 1, name: "init" }),
    ]);
    expect(body.rlsManifest).toBeUndefined();
  });

  it("warns when an RLS manifest is present but postgres-rls flag is disabled", async () => {
    const ws = writeCliWorkspace();
    const result = await runCli(
      ["isolated-store", "sql", "bundle", "--app", "app-1"],
      ws.projectDir,
      ws.homeDir,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("RLS manifest: present but not sent");
    expect(result.stderr).toContain(
      "Gate will not validate the declared RLS baseline",
    );
  });

  it("attaches RLS manifest only when postgres-rls flag is enabled", async () => {
    const ws = writeCliWorkspace(["postgres-rls"]);
    const result = await runCli(
      ["isolated-store", "sql", "bundle", "--app", "app-1", "--json"],
      ws.projectDir,
      ws.homeDir,
    );

    expect(result.exitCode).toBe(0);
    const body = JSON.parse(result.stdout) as {
      bundle: { migrations: Array<{ version: number; name: string }> };
      rlsManifest?: { tables?: Record<string, unknown> };
      schemaName: string;
    };
    expect(body.schemaName).toBe("public");
    expect(body.bundle.migrations).toEqual([
      expect.objectContaining({ version: 1, name: "init" }),
    ]);
    expect(body.rlsManifest?.tables?.tasks).toEqual(
      expect.objectContaining({ classification: "tenant" }),
    );
  });
});
