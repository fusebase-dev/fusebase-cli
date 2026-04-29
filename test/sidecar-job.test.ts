import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

const REPO_ROOT = resolve(import.meta.dir, "..");
const CLI_ENTRY = join(REPO_ROOT, "index.ts");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface RunOptions {
  cwd: string;
  home: string;
}

async function runCli(args: string[], opts: RunOptions): Promise<RunResult> {
  const proc = Bun.spawn({
    cmd: ["bun", CLI_ENTRY, ...args],
    cwd: opts.cwd,
    env: {
      ...process.env,
      HOME: opts.home,
      USERPROFILE: opts.home,
      // Suppress prompts and analytics by isolating to the temp HOME.
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

interface Workspace {
  cwd: string;
  home: string;
  fuseJsonPath: string;
  cleanup: () => void;
}

function setupWorkspace(opts: { withFlag: boolean }): Workspace {
  const root = mkdtempSync(join(tmpdir(), "fusebase-sidecar-job-"));
  const cwd = join(root, "project");
  const home = join(root, "home");
  mkdirSync(cwd, { recursive: true });
  const fusebaseConfigDir = join(home, ".fusebase");
  mkdirSync(fusebaseConfigDir, { recursive: true });

  const cliConfig: Record<string, unknown> = { env: "dev" };
  if (opts.withFlag) {
    cliConfig.flags = ["job-sidecars"];
  }
  writeFileSync(
    join(fusebaseConfigDir, "config.json"),
    JSON.stringify(cliConfig, null, 2),
    "utf-8",
  );

  const fuseJsonPath = join(cwd, "fusebase.json");
  writeFileSync(
    fuseJsonPath,
    JSON.stringify(
      {
        orgId: "org-1",
        appId: "app-1",
        features: [
          {
            id: "feature-1",
            path: "features/feature-1",
            backend: {
              start: { command: "node server.js" },
              jobs: [
                {
                  name: "expire-listings",
                  type: "cron",
                  cron: "0 8 * * *",
                  command: "npm run cron:expire-listings",
                },
                {
                  name: "screenshot",
                  type: "cron",
                  cron: "* * * * *",
                  command: "npm run cron:screenshot",
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

  return {
    cwd,
    home,
    fuseJsonPath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function readFuseJson(ws: Workspace): {
  features: Array<{
    id: string;
    backend?: {
      sidecars?: Array<{ name: string; image: string }>;
      jobs?: Array<{
        name: string;
        sidecars?: Array<{ name: string; image: string }>;
      }>;
    };
  }>;
} {
  return JSON.parse(readFileSync(ws.fuseJsonPath, "utf-8"));
}

describe("fusebase sidecar --job", () => {
  let ws: Workspace;

  afterEach(() => {
    ws?.cleanup();
  });

  describe("with job-sidecars flag enabled", () => {
    beforeEach(() => {
      ws = setupWorkspace({ withFlag: true });
    });

    it("add --job writes sidecar under jobs[].sidecars", async () => {
      const res = await runCli(
        [
          "sidecar",
          "add",
          "--feature",
          "feature-1",
          "--job",
          "screenshot",
          "--name",
          "chromium",
          "--image",
          "browserless/chrome:latest",
          "--port",
          "9222",
        ],
        ws,
      );
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain(
        'Added sidecar "chromium" to job "screenshot"',
      );

      const cfg = readFuseJson(ws);
      const job = cfg.features[0]!.backend!.jobs!.find(
        (j) => j.name === "screenshot",
      )!;
      expect(job.sidecars).toEqual([
        {
          name: "chromium",
          image: "browserless/chrome:latest",
          port: 9222,
        },
      ]);
      // Backend-level sidecars must remain untouched.
      expect(cfg.features[0]!.backend!.sidecars).toBeUndefined();
    });

    it("add --job rejects unknown job", async () => {
      const res = await runCli(
        [
          "sidecar",
          "add",
          "--feature",
          "feature-1",
          "--job",
          "missing",
          "--name",
          "chromium",
          "--image",
          "browserless/chrome:latest",
        ],
        ws,
      );
      expect(res.exitCode).not.toBe(0);
      expect(res.stderr).toContain('Job "missing" not found');
    });

    it("add --job rejects exceeding the 3-sidecar cap", async () => {
      // Pre-populate the job with 3 sidecars.
      const cfg = readFuseJson(ws);
      const job = cfg.features[0]!.backend!.jobs!.find(
        (j) => j.name === "screenshot",
      )!;
      job.sidecars = [
        { name: "a", image: "img" },
        { name: "b", image: "img" },
        { name: "c", image: "img" },
      ];
      writeFileSync(ws.fuseJsonPath, JSON.stringify(cfg, null, 2), "utf-8");

      const res = await runCli(
        [
          "sidecar",
          "add",
          "--feature",
          "feature-1",
          "--job",
          "screenshot",
          "--name",
          "d",
          "--image",
          "img",
        ],
        ws,
      );
      expect(res.exitCode).not.toBe(0);
      expect(res.stderr).toMatch(/already has 3 sidecars/);
    });

    it("add --job rejects duplicate sidecar name within the same job", async () => {
      await runCli(
        [
          "sidecar",
          "add",
          "--feature",
          "feature-1",
          "--job",
          "screenshot",
          "--name",
          "chromium",
          "--image",
          "img",
        ],
        ws,
      );
      const res = await runCli(
        [
          "sidecar",
          "add",
          "--feature",
          "feature-1",
          "--job",
          "screenshot",
          "--name",
          "chromium",
          "--image",
          "img2",
        ],
        ws,
      );
      expect(res.exitCode).not.toBe(0);
      expect(res.stderr).toContain('already exists for job "screenshot"');
    });

    it("allows the same sidecar name on backend and on a job (cross-scope collision OK)", async () => {
      // Backend sidecar.
      const backendRes = await runCli(
        [
          "sidecar",
          "add",
          "--feature",
          "feature-1",
          "--name",
          "chromium",
          "--image",
          "browserless/chrome:latest",
        ],
        ws,
      );
      expect(backendRes.exitCode).toBe(0);

      // Same name, but on a job.
      const jobRes = await runCli(
        [
          "sidecar",
          "add",
          "--feature",
          "feature-1",
          "--job",
          "screenshot",
          "--name",
          "chromium",
          "--image",
          "browserless/chrome:latest",
        ],
        ws,
      );
      expect(jobRes.exitCode).toBe(0);

      const cfg = readFuseJson(ws);
      expect(cfg.features[0]!.backend!.sidecars).toEqual([
        { name: "chromium", image: "browserless/chrome:latest" },
      ]);
      const job = cfg.features[0]!.backend!.jobs!.find(
        (j) => j.name === "screenshot",
      )!;
      expect(job.sidecars).toEqual([
        { name: "chromium", image: "browserless/chrome:latest" },
      ]);
    });

    it("remove --job removes only the targeted sidecar", async () => {
      await runCli(
        [
          "sidecar",
          "add",
          "--feature",
          "feature-1",
          "--job",
          "screenshot",
          "--name",
          "chromium",
          "--image",
          "img",
        ],
        ws,
      );
      await runCli(
        [
          "sidecar",
          "add",
          "--feature",
          "feature-1",
          "--job",
          "screenshot",
          "--name",
          "redis",
          "--image",
          "redis:7",
        ],
        ws,
      );

      const removeRes = await runCli(
        [
          "sidecar",
          "remove",
          "--feature",
          "feature-1",
          "--job",
          "screenshot",
          "--name",
          "chromium",
        ],
        ws,
      );
      expect(removeRes.exitCode).toBe(0);

      const cfg = readFuseJson(ws);
      const job = cfg.features[0]!.backend!.jobs!.find(
        (j) => j.name === "screenshot",
      )!;
      expect(job.sidecars).toEqual([{ name: "redis", image: "redis:7" }]);
    });

    it("remove --job deletes empty sidecars array", async () => {
      await runCli(
        [
          "sidecar",
          "add",
          "--feature",
          "feature-1",
          "--job",
          "screenshot",
          "--name",
          "chromium",
          "--image",
          "img",
        ],
        ws,
      );
      await runCli(
        [
          "sidecar",
          "remove",
          "--feature",
          "feature-1",
          "--job",
          "screenshot",
          "--name",
          "chromium",
        ],
        ws,
      );
      const cfg = readFuseJson(ws);
      const job = cfg.features[0]!.backend!.jobs!.find(
        (j) => j.name === "screenshot",
      )!;
      expect(job.sidecars).toBeUndefined();
    });

    it("list --job shows only sidecars for that job", async () => {
      await runCli(
        [
          "sidecar",
          "add",
          "--feature",
          "feature-1",
          "--name",
          "backend-redis",
          "--image",
          "redis:7",
        ],
        ws,
      );
      await runCli(
        [
          "sidecar",
          "add",
          "--feature",
          "feature-1",
          "--job",
          "screenshot",
          "--name",
          "chromium",
          "--image",
          "browserless/chrome:latest",
        ],
        ws,
      );

      const listRes = await runCli(
        ["sidecar", "list", "--feature", "feature-1", "--job", "screenshot"],
        ws,
      );
      expect(listRes.exitCode).toBe(0);
      expect(listRes.stdout).toContain('Sidecars for job "screenshot"');
      expect(listRes.stdout).toContain("chromium");
      expect(listRes.stdout).not.toContain("backend-redis");
    });

    it("list (without --job) still shows backend sidecars only", async () => {
      await runCli(
        [
          "sidecar",
          "add",
          "--feature",
          "feature-1",
          "--name",
          "backend-redis",
          "--image",
          "redis:7",
        ],
        ws,
      );
      await runCli(
        [
          "sidecar",
          "add",
          "--feature",
          "feature-1",
          "--job",
          "screenshot",
          "--name",
          "chromium",
          "--image",
          "browserless/chrome:latest",
        ],
        ws,
      );

      const listRes = await runCli(
        ["sidecar", "list", "--feature", "feature-1"],
        ws,
      );
      expect(listRes.exitCode).toBe(0);
      expect(listRes.stdout).toContain('Sidecars for feature "feature-1"');
      expect(listRes.stdout).toContain("backend-redis");
      expect(listRes.stdout).not.toContain("chromium");
    });
  });

  describe("with job-sidecars flag disabled", () => {
    beforeEach(() => {
      ws = setupWorkspace({ withFlag: false });
    });

    it("add --job is rejected with a flag-required error", async () => {
      const res = await runCli(
        [
          "sidecar",
          "add",
          "--feature",
          "feature-1",
          "--job",
          "screenshot",
          "--name",
          "chromium",
          "--image",
          "img",
        ],
        ws,
      );
      expect(res.exitCode).not.toBe(0);
      expect(res.stderr).toContain("requires the 'job-sidecars' flag");
    });

    it("remove --job is rejected with a flag-required error", async () => {
      const res = await runCli(
        [
          "sidecar",
          "remove",
          "--feature",
          "feature-1",
          "--job",
          "screenshot",
          "--name",
          "chromium",
        ],
        ws,
      );
      expect(res.exitCode).not.toBe(0);
      expect(res.stderr).toContain("requires the 'job-sidecars' flag");
    });

    it("list --job is rejected with a flag-required error", async () => {
      const res = await runCli(
        ["sidecar", "list", "--feature", "feature-1", "--job", "screenshot"],
        ws,
      );
      expect(res.exitCode).not.toBe(0);
      expect(res.stderr).toContain("requires the 'job-sidecars' flag");
    });

    it("backend sidecar add still works (byte-identical behavior preserved)", async () => {
      const res = await runCli(
        [
          "sidecar",
          "add",
          "--feature",
          "feature-1",
          "--name",
          "redis",
          "--image",
          "redis:7",
        ],
        ws,
      );
      expect(res.exitCode).toBe(0);
      const cfg = readFuseJson(ws);
      expect(cfg.features[0]!.backend!.sidecars).toEqual([
        { name: "redis", image: "redis:7" },
      ]);
    });
  });
});
