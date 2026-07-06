import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

// `fusebase isolated-store sql bundle --apply` ensures the app exists on the
// platform first: under declarative-manifest an app is authored with only a
// `path` and may not be deployed yet, so apply reconciles it (bind/create) to
// resolve the real app id. Read-only paths (e.g. `--status`) must NOT reconcile,
// since creating/mutating the app would be an unexpected side effect.
//   - `--apply`, id-less entry, no apiKey → fails at the reconcile apiKey guard,
//     proving apply takes the reconcile network path before the build.
//   - `--status`, id-less entry → fails at `requireAppId` (no reconcile), proving
//     read-only paths don't create the app.
//   - Entry that already carries an id → builds offline (no reconcile, proven by
//     succeeding with no apiKey).

const REPO_ROOT = resolve(import.meta.dir, "..");
const CLI_ENTRY = join(REPO_ROOT, "index.ts");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(
  args: string[],
  opts: { cwd: string; home: string },
): Promise<RunResult> {
  const proc = Bun.spawn({
    cmd: ["bun", CLI_ENTRY, ...args],
    cwd: opts.cwd,
    env: {
      ...process.env,
      HOME: opts.home,
      USERPROFILE: opts.home,
      FUSEBASE_DISABLE_ANALYTICS: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout, stderr, exitCode: await proc.exited };
}

interface Workspace {
  cwd: string;
  home: string;
  cleanup: () => void;
}

function setupWorkspace(
  flags: string[],
  app: Record<string, unknown>,
): Workspace {
  const root = mkdtempSync(join(tmpdir(), "fusebase-iso-bundle-"));
  const cwd = join(root, "project");
  const home = join(root, "home");
  mkdirSync(cwd, { recursive: true });
  const fusebaseConfigDir = join(home, ".fusebase");
  mkdirSync(fusebaseConfigDir, { recursive: true });
  // No apiKey on purpose: a passing run proves no reconcile network call.
  writeFileSync(
    join(fusebaseConfigDir, "config.json"),
    JSON.stringify({ env: "dev", flags }, null, 2),
    "utf-8",
  );

  // App files + a minimal SQL migration bundle so the offline build succeeds.
  const migrationsDir = join(cwd, "apps/my-app", "postgres", "migrations");
  mkdirSync(migrationsDir, { recursive: true });
  writeFileSync(join(migrationsDir, "0001_init.sql"), "SELECT 1;\n", "utf-8");
  writeFileSync(
    join(migrationsDir, "manifest.json"),
    JSON.stringify(
      { migrations: [{ version: 1, file: "0001_init.sql", name: "init" }] },
      null,
      2,
    ),
    "utf-8",
  );

  writeFileSync(
    join(cwd, "fusebase.json"),
    JSON.stringify(
      { orgId: "org-1", productId: "prod-1", apps: [app] },
      null,
      2,
    ),
    "utf-8",
  );

  return {
    cwd,
    home,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const STORE = {
  isolatedStores: {
    sql: [{ alias: "my-app", storeId: "store-1", schemaName: "public" }],
  },
};

describe("fusebase isolated-store sql bundle — app reconcile", () => {
  let ws: Workspace;
  afterEach(() => ws?.cleanup());

  it("--apply reconciles an id-less declarative app before building (fails at apiKey guard)", async () => {
    ws = setupWorkspace(["declarative-manifest"], {
      subdomain: "my-app",
      path: "apps/my-app",
      ...STORE,
    });
    const res = await runCli(
      [
        "isolated-store",
        "sql",
        "bundle",
        "--app",
        "apps/my-app",
        "--apply",
        "--yes",
      ],
      { cwd: ws.cwd, home: ws.home },
    );
    expect(res.exitCode).not.toBe(0);
    expect(`${res.stdout}${res.stderr}`).toContain("No API key configured");
  });

  it("--status returns a predefined 'not deployed' status for an id-less entry (no reconcile, no network)", async () => {
    ws = setupWorkspace(["declarative-manifest"], {
      subdomain: "my-app",
      path: "apps/my-app",
      ...STORE,
    });
    const res = await runCli(
      ["isolated-store", "sql", "bundle", "--app", "apps/my-app", "--status"],
      { cwd: ws.cwd, home: ws.home },
    );
    expect(res.exitCode).toBe(0);
    const status = JSON.parse(res.stdout);
    expect(status.appExists).toBe(false);
    expect(status.app).toBe("apps/my-app");
    expect(status.migrations).toEqual({ applied: [], pending: [] });
    // No reconcile / Gate call happened (proven offline with no apiKey/token).
    const out = `${res.stdout}${res.stderr}`;
    expect(out).not.toContain("No API key configured");
  });

  it("builds offline when the entry already carries a real id (no reconcile)", async () => {
    ws = setupWorkspace(["declarative-manifest"], {
      id: "app-123",
      subdomain: "my-app",
      path: "apps/my-app",
      ...STORE,
    });
    const res = await runCli(
      ["isolated-store", "sql", "bundle", "--app", "apps/my-app", "--json"],
      { cwd: ws.cwd, home: ws.home },
    );
    expect(res.exitCode).toBe(0);
    const body = JSON.parse(res.stdout);
    expect(body.bundle.migrations).toHaveLength(1);
    expect(body.schemaName).toBe("public");
  });
});
