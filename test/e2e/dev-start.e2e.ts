/**
 * E2E test for `fusebase dev start` running two features in parallel.
 *
 * Spawns two CLI processes (one per feature) and asserts that both feature
 * dev servers come up on their advertised ports. Fully local — no Azure or
 * public-api calls are exercised by this test (the fake `apiKey` in the
 * seeded `~/.fusebase/config.json` only satisfies `dev start`'s minimum
 * "are you authed?" guard; the public-api `secrets` lookup that follows is
 * non-fatal and the CLI continues without secrets when it fails).
 *
 * Per JIRA NIM-40902, the CLI starts a single feature per invocation, so
 * "two features in parallel" means two `fusebase dev start <featureId>`
 * processes running concurrently.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { createCliWorkspace, type CliStreamHandle, runCliStreaming } from "./helpers";

const POLL_TIMEOUT_MS = 60_000;

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function findFreePort(start: number, end: number): Promise<number> {
  for (let port = start; port <= end; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port available in [${start}, ${end}]`);
}

function writeTrivialDevServer(featureDir: string, port: number): void {
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(
    join(featureDir, "server.js"),
    `const http = require("http");
const port = ${port};
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK from dev server on port " + port);
});
server.listen(port, "127.0.0.1", () => {
  console.log("Local dev server ready on port " + port);
});
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
`,
    "utf-8",
  );
}

async function pollUntil200(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.status === 200) {
        await res.text();
        return;
      }
      lastErr = new Error(`status ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await Bun.sleep(500);
  }
  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`Dev server at ${url} did not return 200 within ${timeoutMs}ms (last: ${reason})`);
}

describe("fusebase dev start — two features in parallel", () => {
  let workspace: ReturnType<typeof createCliWorkspace>;
  let portA = 0;
  let portB = 0;
  const handles: CliStreamHandle[] = [];

  beforeAll(async () => {
    portA = await findFreePort(3091, 3500);
    portB = await findFreePort(portA + 1, 3500);

    workspace = createCliWorkspace({
      env: "dev",
      apiKey: "e2e-fake-test-key",
    });

    writeTrivialDevServer(join(workspace.cwd, "features", "feat-a"), portA);
    writeTrivialDevServer(join(workspace.cwd, "features", "feat-b"), portB);

    writeFileSync(
      join(workspace.cwd, "fusebase.json"),
      JSON.stringify(
        {
          env: "dev",
          orgId: "e2e-test-org",
          appId: "e2e-test-app",
          features: [
            {
              id: "feat-a",
              path: "features/feat-a",
              dev: { command: "node server.js" },
              devUrl: `http://127.0.0.1:${portA}`,
            },
            {
              id: "feat-b",
              path: "features/feat-b",
              dev: { command: "node server.js" },
              devUrl: `http://127.0.0.1:${portB}`,
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );
  });

  afterAll(async () => {
    await Promise.allSettled(handles.map((h) => h.kill()));
    workspace?.cleanup();
  });

  it(
    "loads two features in parallel via their advertised ports",
    async () => {
      const handleA = runCliStreaming(["dev", "start", "feat-a"], {
        cwd: workspace.cwd,
        home: workspace.home,
      });
      handles.push(handleA);

      const handleB = runCliStreaming(["dev", "start", "feat-b"], {
        cwd: workspace.cwd,
        home: workspace.home,
      });
      handles.push(handleB);

      await Promise.all([
        pollUntil200(`http://127.0.0.1:${portA}`, POLL_TIMEOUT_MS),
        pollUntil200(`http://127.0.0.1:${portB}`, POLL_TIMEOUT_MS),
      ]);

      const codes = await Promise.all([handleA.kill(), handleB.kill()]);
      // SIGTERM triggers the CLI's `cleanup` which calls `process.exit(0)`.
      // If the cleanup path stalls, `kill()` escalates to SIGKILL after 5s
      // (exit code -1 / null). We accept either as a clean shutdown for the
      // purposes of "no leaked child process".
      for (const code of codes) {
        expect([0, null, -1]).toContain(code);
      }
    },
    POLL_TIMEOUT_MS + 30_000,
  );
});
