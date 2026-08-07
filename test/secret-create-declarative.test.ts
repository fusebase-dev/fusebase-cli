import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

// NIM-secrets: `fusebase secret create` only edits fusebase.json `apps[].secrets`
// (no network) — proven offline because HOME config has no apiKey yet the run
// succeeds.

const REPO_ROOT = resolve(import.meta.dir, "..");
const CLI_ENTRY = join(REPO_ROOT, "index.ts");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(
  args: string[],
  opts: { cwd: string; home: string; env?: string },
): Promise<RunResult> {
  const proc = Bun.spawn({
    cmd: ["bun", CLI_ENTRY, ...args],
    cwd: opts.cwd,
    env: {
      ...process.env,
      HOME: opts.home,
      USERPROFILE: opts.home,
      FUSEBASE_DISABLE_ANALYTICS: "1",
      ...(opts.env ? { FUSEBASE_ENV: opts.env } : {}),
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
  fuseJsonPath: string;
  cleanup: () => void;
}

function setupWorkspace(
  flags: string[],
  fuseJson?: Record<string, unknown>,
): Workspace {
  const root = mkdtempSync(join(tmpdir(), "fusebase-secret-create-"));
  const cwd = join(root, "project");
  const home = join(root, "home");
  mkdirSync(cwd, { recursive: true });
  const fusebaseConfigDir = join(home, ".fusebase");
  mkdirSync(fusebaseConfigDir, { recursive: true });
  // No apiKey on purpose: a passing declarative run proves no network call.
  writeFileSync(
    join(fusebaseConfigDir, "config.json"),
    JSON.stringify({ env: "dev", flags }, null, 2),
    "utf-8",
  );

  const fuseJsonPath = join(cwd, "fusebase.json");
  writeFileSync(
    fuseJsonPath,
    JSON.stringify(
      fuseJson ?? {
        orgId: "org-1",
        productId: "prod-1",
        apps: [{ subdomain: "my-app", path: "apps/my-app" }],
      },
      null,
      2,
    ),
    "utf-8",
  );

  return {
    cwd,
    home,
    fuseJsonPath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const CREATE_ARGS = [
  "secret",
  "create",
  "--app",
  "apps/my-app",
  "--secret",
  "STRIPE_KEY:Stripe secret",
];

describe("fusebase secret create", () => {
  let ws: Workspace;
  afterEach(() => ws?.cleanup());

  beforeEach(() => {
    ws = setupWorkspace([]);
  });

  it("writes the key to apps[].secrets in fusebase.json with no network", async () => {
    const res = await runCli(CREATE_ARGS, { cwd: ws.cwd, home: ws.home });
    expect(res.exitCode).toBe(0);
    const cfg = JSON.parse(readFileSync(ws.fuseJsonPath, "utf-8"));
    expect(cfg.apps[0].secrets).toEqual([
      { key: "STRIPE_KEY", description: "Stripe secret" },
    ]);
  });
});

// NIM-43138: with named environments the loaded config is env-overlaid; the
// write must stay on the raw env-neutral file.
describe("fusebase secret create with a stripped manifest + active env", () => {
  let ws: Workspace;
  afterEach(() => ws?.cleanup());

  beforeEach(() => {
    ws = setupWorkspace(["environments"], {
      apps: [{ subdomain: "my-app", name: "My App", path: "apps/my-app" }],
    });
    mkdirSync(join(ws.cwd, "environments"), { recursive: true });
    writeFileSync(
      join(ws.cwd, "environments", "beta.json"),
      JSON.stringify(
        {
          backend: "prod",
          orgId: "org-beta",
          productId: "prod-beta",
          subdomainSuffix: "-beta",
          apps: { "my-app": { id: "app-beta-1", subdomain: "my-app-beta" } },
        },
        null,
        2,
      ),
      "utf-8",
    );
  });

  it("adds only secrets[] and leaves the manifest env-neutral", async () => {
    const res = await runCli(CREATE_ARGS, {
      cwd: ws.cwd,
      home: ws.home,
      env: "beta",
    });
    expect(res.exitCode).toBe(0);

    const cfg = JSON.parse(readFileSync(ws.fuseJsonPath, "utf-8"));
    expect(cfg.apps[0].secrets).toEqual([
      { key: "STRIPE_KEY", description: "Stripe secret" },
    ]);
    expect(cfg.orgId).toBeUndefined();
    expect(cfg.productId).toBeUndefined();
    expect(cfg.env).toBeUndefined();
    expect(cfg.apps[0].id).toBeUndefined();
    expect(cfg.apps[0].subdomain).toBe("my-app");
  });
});
