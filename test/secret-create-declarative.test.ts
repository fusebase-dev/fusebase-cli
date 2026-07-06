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

// NIM-secrets: the `declarative-manifest` flag gates `fusebase secret create`.
// Flag ON  → only edits fusebase.json `apps[].secrets` (no network) — proven
//            offline because HOME config has no apiKey yet the run succeeds.
// Flag OFF → legacy path registers on the platform immediately, so the same run
//            fails at the "No API key configured" guard (a network attempt).

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
  fuseJsonPath: string;
  cleanup: () => void;
}

function setupWorkspace(flags: string[]): Workspace {
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
      {
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

describe("fusebase secret create — declarative-manifest flag", () => {
  let ws: Workspace;
  afterEach(() => ws?.cleanup());

  describe("flag ON", () => {
    beforeEach(() => {
      ws = setupWorkspace(["declarative-manifest"]);
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

  describe("flag OFF (legacy)", () => {
    beforeEach(() => {
      ws = setupWorkspace([]);
    });

    it("takes the legacy backend path (fails at the apiKey guard, no manifest write)", async () => {
      const res = await runCli(CREATE_ARGS, { cwd: ws.cwd, home: ws.home });
      expect(res.exitCode).not.toBe(0);
      expect(`${res.stdout}${res.stderr}`).toContain("No API key configured");
      // Legacy never writes secrets into fusebase.json.
      const cfg = JSON.parse(readFileSync(ws.fuseJsonPath, "utf-8"));
      expect(cfg.apps[0].secrets).toBeUndefined();
    });
  });
});
