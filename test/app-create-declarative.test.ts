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

// NIM-41989: `fusebase app create` only writes the fusebase.json entry — it
// does NOT create the app on the platform (the real app is created later by
// `fusebase deploy` reconcile).
// The proof here is offline: HOME config has no apiKey, so a successful run
// means no backend call was made.

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
  const root = mkdtempSync(join(tmpdir(), "fusebase-app-create-decl-"));
  const cwd = join(root, "project");
  const home = join(root, "home");
  mkdirSync(cwd, { recursive: true });
  const fusebaseConfigDir = join(home, ".fusebase");
  mkdirSync(fusebaseConfigDir, { recursive: true });
  // No apiKey on purpose: a passing declarative create proves no network call.
  writeFileSync(
    join(fusebaseConfigDir, "config.json"),
    JSON.stringify({ env: "dev", flags }, null, 2),
    "utf-8",
  );

  const fuseJsonPath = join(cwd, "fusebase.json");
  writeFileSync(
    fuseJsonPath,
    JSON.stringify({ orgId: "org-1", productId: "prod-1", apps: [] }, null, 2),
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
  "app",
  "create",
  "--name",
  "My App",
  "--subdomain",
  "my-app",
  "--path",
  "apps/my-app",
  "--dev-command",
  "npm run dev",
  "--build-command",
  "npm run build",
  "--output-dir",
  "dist",
];

describe("fusebase app create — declarative manifest", () => {
  let ws: Workspace;
  afterEach(() => ws?.cleanup());

  it("writes an id-less fusebase.json entry and makes no backend call", async () => {
    ws = setupWorkspace([]);
    const res = await runCli(CREATE_ARGS, ws);

    expect(res.exitCode, res.stderr).toBe(0);
    const config = JSON.parse(readFileSync(ws.fuseJsonPath, "utf-8"));
    expect(config.apps).toHaveLength(1);
    const app = config.apps[0];
    expect(app.id).toBeUndefined();
    expect(app.subdomain).toBe("my-app");
    expect(app.name).toBe("My App");
    expect(app.path).toBe("apps/my-app");
    expect(app.build).toEqual({ command: "npm run build", outputDir: "dist" });
  });

  it("persists --coding-agent/--model so deploy/dev-start can send them later (NIM-41997)", async () => {
    ws = setupWorkspace([]);
    const res = await runCli(
      [...CREATE_ARGS, "--coding-agent", "claude_code", "--model", "claude-opus-4-8"],
      ws,
    );

    expect(res.exitCode, res.stderr).toBe(0);
    const config = JSON.parse(readFileSync(ws.fuseJsonPath, "utf-8"));
    expect(config.apps[0].codingAgent).toBe("claude_code");
    expect(config.apps[0].model).toBe("claude-opus-4-8");
  });

  it("preserves an existing platform id when re-running create for the same subdomain", async () => {
    ws = setupWorkspace([]);
    // Simulate an entry that already got a written-back id from a prior deploy.
    writeFileSync(
      ws.fuseJsonPath,
      JSON.stringify({
        orgId: "org-1",
        productId: "prod-1",
        apps: [{ id: "app-123", subdomain: "my-app", path: "apps/my-app" }],
      }),
      "utf-8",
    );
    const res = await runCli(CREATE_ARGS, ws);

    expect(res.exitCode, res.stderr).toBe(0);
    const config = JSON.parse(readFileSync(ws.fuseJsonPath, "utf-8"));
    expect(config.apps).toHaveLength(1);
    expect(config.apps[0].id).toBe("app-123");
  });
});
