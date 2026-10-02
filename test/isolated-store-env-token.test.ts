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

// Gate calls from `isolated-store sql bundle` must use the token of the
// environment that supplied org/app/store — not GATE_MCP_TOKEN from the root
// `.env` (the last materialized active environment).

const REPO_ROOT = resolve(import.meta.dir, "..");
const CLI_ENTRY = join(REPO_ROOT, "index.ts");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  capture: string | null;
}

async function runCli(
  args: string[],
  opts: { cwd: string; home: string; fuseEnv?: string },
): Promise<RunResult> {
  const capturePath = join(opts.cwd, "gate-capture.json");
  const env: Record<string, string> = {
    ...process.env,
    HOME: opts.home,
    USERPROFILE: opts.home,
    FUSEBASE_DISABLE_ANALYTICS: "1",
    GATE_CAPTURE_PATH: capturePath,
  };
  delete env.FUSEBASE_ENV;
  if (opts.fuseEnv !== undefined) {
    env.FUSEBASE_ENV = opts.fuseEnv;
  }
  const proc = Bun.spawn({
    cmd: ["bun", "--preload", join(opts.cwd, "gate-preload.ts"), CLI_ENTRY, ...args],
    cwd: opts.cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  let capture: string | null = null;
  try {
    capture = readFileSync(capturePath, "utf-8");
  } catch {
    capture = null;
  }
  return { stdout, stderr, exitCode: await proc.exited, capture };
}

interface Workspace {
  cwd: string;
  home: string;
  cleanup: () => void;
}

function setupWorkspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), "fusebase-iso-env-token-"));
  const cwd = join(root, "project");
  const home = join(root, "home");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(join(home, ".fusebase"), { recursive: true });
  writeFileSync(
    join(home, ".fusebase", "config.json"),
    JSON.stringify({ env: "dev", flags: [] }, null, 2),
    "utf-8",
  );

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
      {
        orgId: "org-from-fusebase-json",
        productId: "product-1",
        apps: [
          {
            id: "app-from-fusebase-json",
            subdomain: "my-app",
            path: "apps/my-app",
            isolatedStores: {
              sql: [
                {
                  alias: "my-app",
                  storeId: "store-from-fusebase-json",
                  schemaName: "public",
                },
              ],
            },
          },
        ],
      },
      null,
      2,
    ),
    "utf-8",
  );

  mkdirSync(join(cwd, "environments"), { recursive: true });
  writeFileSync(
    join(cwd, "environments", "beta.json"),
    JSON.stringify(
      {
        backend: "dev",
        orgId: "org-beta",
        productId: "product-beta",
        apps: { "my-app": { id: "app-beta", stores: { "my-app": "store-beta" } } },
      },
      null,
      2,
    ),
    "utf-8",
  );
  writeFileSync(
    join(cwd, "environments", "prod.json"),
    JSON.stringify(
      {
        backend: "prod",
        orgId: "org-prod",
        productId: "product-prod",
        apps: { "my-app": { id: "app-prod", stores: { "my-app": "store-prod" } } },
      },
      null,
      2,
    ),
    "utf-8",
  );

  mkdirSync(join(cwd, ".fusebase"), { recursive: true });
  writeFileSync(
    join(cwd, ".fusebase", "state.json"),
    JSON.stringify({ activeEnvironment: "beta" }, null, 2),
    "utf-8",
  );

  writeFileSync(join(cwd, ".env"), "GATE_MCP_TOKEN=token-root\n", "utf-8");
  writeFileSync(join(cwd, ".env.beta"), "GATE_MCP_TOKEN=token-beta\n", "utf-8");
  writeFileSync(join(cwd, ".env.prod"), "GATE_MCP_TOKEN=token-prod\n", "utf-8");

  writeFileSync(
    join(cwd, "gate-preload.ts"),
    `
const chunks: string[] = [];
const orig = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
  chunks.push(String(chunk));
  return orig(chunk as never, ...(args as never[]));
}) as typeof process.stdout.write;

globalThis.fetch = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
  const url = String(input);
  if (!url.includes("gate-service")) {
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }
  const printed = chunks.join("");
  const fs = await import("node:fs");
  fs.writeFileSync(
    process.env.GATE_CAPTURE_PATH!,
    JSON.stringify({
      url,
      token: init?.headers?.["x-gate-token"] ?? null,
      printedBefore: printed,
    }),
  );
  return new Response(JSON.stringify({ pendingCount: 0, appliedCount: 0 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;
`,
    "utf-8",
  );

  return {
    cwd,
    home,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("isolated-store sql bundle environment token", () => {
  let ws: Workspace;
  afterEach(() => ws?.cleanup());

  it("--env prod sends .env.prod and the prod lockfile org/store", async () => {
    ws = setupWorkspace();
    const res = await runCli(
      [
        "isolated-store",
        "sql",
        "bundle",
        "--app",
        "apps/my-app",
        "--status",
        "--env",
        "prod",
      ],
      { cwd: ws.cwd, home: ws.home },
    );
    expect(res.exitCode).toBe(0);
    expect(res.capture).not.toBeNull();
    const captured = JSON.parse(res.capture!) as {
      url: string;
      token: string;
      printedBefore: string;
    };
    expect(captured.token).toBe("token-prod");
    expect(captured.url).toContain("/org-prod/isolated-stores/store-prod/");
    expect(captured.url).not.toContain("org-beta");
    expect(captured.url).not.toContain("store-from-fusebase-json");
    expect(captured.printedBefore).toContain(
      "Environment: prod (backend: prod, org: org-prod, app: app-prod, store: store-prod, stage: prod)",
    );
    expect(res.stdout).toContain("Environment: prod");
  });

  it("with no --env uses the active environment token and prints its name first", async () => {
    ws = setupWorkspace();
    const res = await runCli(
      ["isolated-store", "sql", "bundle", "--app", "apps/my-app", "--status"],
      { cwd: ws.cwd, home: ws.home },
    );
    expect(res.exitCode).toBe(0);
    const captured = JSON.parse(res.capture!) as {
      url: string;
      token: string;
      printedBefore: string;
    };
    expect(captured.token).toBe("token-beta");
    expect(captured.token).not.toBe("token-root");
    expect(captured.url).toContain("/org-beta/isolated-stores/store-beta/");
    expect(captured.printedBefore).toContain(
      "Environment: beta (backend: dev, org: org-beta, app: app-beta, store: store-beta, stage: dev)",
    );
  });

  it("--apply without --env or FUSEBASE_ENV refuses when several environments exist", async () => {
    ws = setupWorkspace();
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
    expect(`${res.stdout}${res.stderr}`).toContain("requires --env <name> or FUSEBASE_ENV");
    expect(res.capture).toBeNull();
  });
});
