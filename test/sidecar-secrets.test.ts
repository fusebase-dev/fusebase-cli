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

import { toDeploySidecars } from "../lib/commands/deploy";
import type { SidecarConfig } from "../lib/config";

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

function setupWorkspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), "fusebase-sidecar-secrets-"));
  const cwd = join(root, "project");
  const home = join(root, "home");
  mkdirSync(cwd, { recursive: true });
  const fusebaseConfigDir = join(home, ".fusebase");
  mkdirSync(fusebaseConfigDir, { recursive: true });

  // job-sidecars flag enabled so we can also exercise --job for secrets.
  writeFileSync(
    join(fusebaseConfigDir, "config.json"),
    JSON.stringify({ env: "dev", flags: ["job-sidecars"] }, null, 2),
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

interface FuseJsonShape {
  features: Array<{
    id: string;
    backend?: {
      sidecars?: SidecarConfig[];
      jobs?: Array<{ name: string; sidecars?: SidecarConfig[] }>;
    };
  }>;
}

function readFuseJson(ws: Workspace): FuseJsonShape {
  return JSON.parse(readFileSync(ws.fuseJsonPath, "utf-8"));
}

describe("fusebase sidecar --secret", () => {
  let ws: Workspace;

  beforeEach(() => {
    ws = setupWorkspace();
  });

  afterEach(() => {
    ws?.cleanup();
  });

  describe("add parsing", () => {
    it("--secret KEY produces a string entry", async () => {
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
          "--secret",
          "DB_PASSWORD",
        ],
        ws,
      );
      expect(res.exitCode).toBe(0);
      const cfg = readFuseJson(ws);
      const sc = cfg.features[0]!.backend!.sidecars![0]!;
      expect(sc.secrets).toEqual(["DB_PASSWORD"]);
    });

    it("--secret KEY:ALIAS produces a {from, as} object entry", async () => {
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
          "--secret",
          "DB_PASSWORD:REDIS_PASSWORD",
        ],
        ws,
      );
      expect(res.exitCode).toBe(0);
      const cfg = readFuseJson(ws);
      const sc = cfg.features[0]!.backend!.sidecars![0]!;
      expect(sc.secrets).toEqual([
        { from: "DB_PASSWORD", as: "REDIS_PASSWORD" },
      ]);
    });

    it("multiple --secret flags accumulate in order, mixing string and rename forms", async () => {
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
          "--secret",
          "API_KEY",
          "--secret",
          "DB_PASSWORD:REDIS_PASSWORD",
          "--secret",
          "TOKEN",
        ],
        ws,
      );
      expect(res.exitCode).toBe(0);
      const cfg = readFuseJson(ws);
      const sc = cfg.features[0]!.backend!.sidecars![0]!;
      expect(sc.secrets).toEqual([
        "API_KEY",
        { from: "DB_PASSWORD", as: "REDIS_PASSWORD" },
        "TOKEN",
      ]);
    });

    it("rejects two --secret entries that resolve to the same target name (KEY duplicate)", async () => {
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
          "--secret",
          "DB_PASSWORD",
          "--secret",
          "DB_PASSWORD",
        ],
        ws,
      );
      expect(res.exitCode).not.toBe(0);
      expect(res.stderr).toMatch(/Duplicate secret target name/i);
      // File must not have been written.
      const cfg = readFuseJson(ws);
      expect(cfg.features[0]!.backend!.sidecars).toBeUndefined();
    });

    it("rejects --secret X paired with --secret Y:X (alias collides with prior key)", async () => {
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
          "--secret",
          "DB_PASSWORD",
          "--secret",
          "OTHER:DB_PASSWORD",
        ],
        ws,
      );
      expect(res.exitCode).not.toBe(0);
      expect(res.stderr).toMatch(/Duplicate secret target name/i);
      const cfg = readFuseJson(ws);
      expect(cfg.features[0]!.backend!.sidecars).toBeUndefined();
    });

    it("rejects --secret with empty KEY (':FOO')", async () => {
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
          "--secret",
          ":FOO",
        ],
        ws,
      );
      expect(res.exitCode).not.toBe(0);
      expect(res.stderr).toMatch(/Both KEY and ALIAS must be non-empty/);
      const cfg = readFuseJson(ws);
      expect(cfg.features[0]!.backend!.sidecars).toBeUndefined();
    });

    it("rejects --secret with empty ALIAS ('FOO:')", async () => {
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
          "--secret",
          "FOO:",
        ],
        ws,
      );
      expect(res.exitCode).not.toBe(0);
      expect(res.stderr).toMatch(/Both KEY and ALIAS must be non-empty/);
      const cfg = readFuseJson(ws);
      expect(cfg.features[0]!.backend!.sidecars).toBeUndefined();
    });

    it("allows the same name in --env and --secret (env-override is server-side)", async () => {
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
          "--env",
          "DB_PASSWORD=hardcoded",
          "--secret",
          "DB_PASSWORD",
        ],
        ws,
      );
      expect(res.exitCode).toBe(0);
      const cfg = readFuseJson(ws);
      const sc = cfg.features[0]!.backend!.sidecars![0]!;
      expect(sc.env).toEqual({ DB_PASSWORD: "hardcoded" });
      expect(sc.secrets).toEqual(["DB_PASSWORD"]);
    });

    it("--secret works with --job: secrets land on the job's sidecar entry", async () => {
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
          "--secret",
          "API_KEY",
          "--secret",
          "DB_PASSWORD:JOB_DB_PASSWORD",
        ],
        ws,
      );
      expect(res.exitCode).toBe(0);
      const cfg = readFuseJson(ws);
      // Backend-level sidecars must remain untouched.
      expect(cfg.features[0]!.backend!.sidecars).toBeUndefined();
      const job = cfg.features[0]!.backend!.jobs!.find(
        (j) => j.name === "screenshot",
      )!;
      expect(job.sidecars![0]!.secrets).toEqual([
        "API_KEY",
        { from: "DB_PASSWORD", as: "JOB_DB_PASSWORD" },
      ]);
    });
  });

  describe("list rendering", () => {
    it("renders Secrets line with KEY and KEY -> ALIAS forms", async () => {
      await runCli(
        [
          "sidecar",
          "add",
          "--feature",
          "feature-1",
          "--name",
          "redis",
          "--image",
          "redis:7",
          "--secret",
          "API_KEY",
          "--secret",
          "DB_PASSWORD:REDIS_PASSWORD",
        ],
        ws,
      );
      const listRes = await runCli(
        ["sidecar", "list", "--feature", "feature-1"],
        ws,
      );
      expect(listRes.exitCode).toBe(0);
      expect(listRes.stdout).toContain(
        "Secrets: API_KEY, DB_PASSWORD -> REDIS_PASSWORD",
      );
    });

    it("omits the Secrets line when no secrets configured", async () => {
      await runCli(
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
      const listRes = await runCli(
        ["sidecar", "list", "--feature", "feature-1"],
        ws,
      );
      expect(listRes.exitCode).toBe(0);
      expect(listRes.stdout).not.toContain("Secrets:");
    });
  });
});

describe("toDeploySidecars (deploy serialization)", () => {
  it("normalizes string entries to {from: K, as: K} on the wire", () => {
    const result = toDeploySidecars([
      {
        name: "redis",
        image: "redis:7",
        secrets: ["DB_PASSWORD", "API_KEY"],
      },
    ]);
    expect(result).toEqual([
      {
        name: "redis",
        image: "redis:7",
        secrets: [
          { from: "DB_PASSWORD", as: "DB_PASSWORD" },
          { from: "API_KEY", as: "API_KEY" },
        ],
      },
    ]);
  });

  it("passes object entries through verbatim and preserves order with mixed forms", () => {
    const result = toDeploySidecars([
      {
        name: "redis",
        image: "redis:7",
        secrets: [
          "API_KEY",
          { from: "DB_PASSWORD", as: "REDIS_PASSWORD" },
          "TOKEN",
        ],
      },
    ]);
    expect(result?.[0]?.secrets).toEqual([
      { from: "API_KEY", as: "API_KEY" },
      { from: "DB_PASSWORD", as: "REDIS_PASSWORD" },
      { from: "TOKEN", as: "TOKEN" },
    ]);
  });

  it("omits the secrets field when undefined", () => {
    const result = toDeploySidecars([
      { name: "redis", image: "redis:7" },
    ]);
    expect(result?.[0]).toEqual({ name: "redis", image: "redis:7" });
    expect(result?.[0]).not.toHaveProperty("secrets");
  });

  it("omits the secrets field when the array is empty", () => {
    const result = toDeploySidecars([
      { name: "redis", image: "redis:7", secrets: [] },
    ]);
    expect(result?.[0]).toEqual({ name: "redis", image: "redis:7" });
    expect(result?.[0]).not.toHaveProperty("secrets");
  });

  it("returns undefined when given undefined (no sidecars configured)", () => {
    expect(toDeploySidecars(undefined)).toBeUndefined();
  });

  it("preserves env/port/tier alongside secrets in the same payload entry", () => {
    const result = toDeploySidecars([
      {
        name: "redis",
        image: "redis:7",
        port: 6379,
        tier: "small",
        env: { DB_PASSWORD: "hardcoded" },
        secrets: ["DB_PASSWORD"],
      },
    ]);
    expect(result).toEqual([
      {
        name: "redis",
        image: "redis:7",
        port: 6379,
        tier: "small",
        env: [{ key: "DB_PASSWORD", value: "hardcoded" }],
        secrets: [{ from: "DB_PASSWORD", as: "DB_PASSWORD" }],
      },
    ]);
  });

  it("works the same way for job sidecars (mapper is scope-agnostic)", () => {
    const jobSidecars: SidecarConfig[] = [
      {
        name: "chromium",
        image: "browserless/chrome:latest",
        secrets: [
          "API_KEY",
          { from: "DB_PASSWORD", as: "JOB_DB_PASSWORD" },
        ],
      },
    ];
    const result = toDeploySidecars(jobSidecars);
    expect(result?.[0]?.secrets).toEqual([
      { from: "API_KEY", as: "API_KEY" },
      { from: "DB_PASSWORD", as: "JOB_DB_PASSWORD" },
    ]);
  });
});
