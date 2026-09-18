import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

// NIM-44700: `fusebase dev start` must register declared-but-missing secret
// keys on the platform on EVERY run. It used to reconcile only when the app
// entry had no id yet, so a key added by `secret create` after the app existed
// never reached the platform — while `secret create` promised it would.
//
// Graded offline: the CLI runs against env "local" (localhost:3000, nothing
// listening) with an app that ALREADY carries an id and declares a secret.
// reconcileAppSecrets is best-effort, so its failure prints
// "failed to reconcile secrets" — a line that is only reachable if the call
// happens at all. Before the fix the run went straight to the secrets fetch.

const REPO_ROOT = resolve(import.meta.dir, "..");
const CLI_ENTRY = join(REPO_ROOT, "index.ts");

interface Workspace {
  cwd: string;
  home: string;
  cleanup: () => void;
}

function setupWorkspace(app: Record<string, unknown>): Workspace {
  const root = mkdtempSync(join(tmpdir(), "fusebase-dev-secrets-"));
  const cwd = join(root, "project");
  const home = join(root, "home");
  mkdirSync(join(cwd, "apps/my-app"), { recursive: true });
  const fusebaseConfigDir = join(home, ".fusebase");
  mkdirSync(fusebaseConfigDir, { recursive: true });
  writeFileSync(
    join(fusebaseConfigDir, "config.json"),
    JSON.stringify({ env: "local", apiKey: "test-key" }, null, 2),
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

/**
 * Run `fusebase dev start` until `marker` shows up, then kill it — the command
 * ends by spawning a long-lived dev server, so it never exits on its own.
 * Returns the output collected so far (marker absent on timeout).
 */
async function runDevStartUntil(
  ws: Workspace,
  marker: string,
  timeoutMs = 25000,
): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["bun", CLI_ENTRY, "dev", "start", "apps/my-app"],
    cwd: ws.cwd,
    env: {
      ...process.env,
      HOME: ws.home,
      USERPROFILE: ws.home,
      FUSEBASE_DISABLE_ANALYTICS: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  let output = "";
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      output += decoder.decode(chunk);
      if (output.includes(marker)) break;
    }
  };

  await Promise.race([
    Promise.all([collect(proc.stdout), collect(proc.stderr)]),
    Bun.sleep(timeoutMs),
  ]);
  proc.kill();
  await proc.exited;
  return output;
}

describe("fusebase dev start — secret reconcile", () => {
  let ws: Workspace;
  afterEach(() => ws?.cleanup());

  it("registers declared secrets for an app that already has a platform id", async () => {
    ws = setupWorkspace({
      id: "app-1",
      subdomain: "my-app",
      path: "apps/my-app",
      secrets: [{ key: "MY_SECRET", description: "declared after create" }],
    });

    const output = await runDevStartUntil(ws, "failed to reconcile secrets");

    expect(output).toContain("failed to reconcile secrets for apps/my-app");
  }, 30000);
});
