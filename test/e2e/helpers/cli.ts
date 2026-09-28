/**
 * Spawns the CLI under test with isolated `HOME` and a configured env so each
 * E2E test starts from a clean slate.
 *
 * Two shapes are exposed:
 * - `runCli` — one-shot exec, returns stdout/stderr/exitCode.
 * - `runCliStreaming` — long-running (used by `dev start` tests); returns the
 *   process handle plus a `waitForReady` helper that resolves when stdout/err
 *   matches a caller-supplied pattern.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { FusebaseEnv } from "./env";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
const CLI_ENTRY = join(REPO_ROOT, "index.ts");

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CliWorkspace {
  /** Working directory passed as `cwd` to the CLI. */
  cwd: string;
  /** Isolated `HOME` directory; contains `.fusebase/config.json`. */
  home: string;
  /** Removes the workspace tree. Idempotent. */
  cleanup: () => void;
}

export interface CreateWorkspaceOptions {
  /** Name prefix for `mkdtemp` (default: `fusebase-e2e-`). */
  prefix?: string;
  /** Fusebase env to write into `~/.fusebase/config.json`. */
  env: FusebaseEnv;
  /** API key written into `~/.fusebase/config.json`. */
  apiKey: string;
  /** Optional extra keys to merge into the config file. */
  extraConfig?: Record<string, unknown>;
}

/** Creates an isolated CLI workspace (cwd + HOME) seeded with auth config. */
export function createCliWorkspace(opts: CreateWorkspaceOptions): CliWorkspace {
  const root = mkdtempSync(join(tmpdir(), opts.prefix ?? "fusebase-e2e-"));
  const cwd = join(root, "project");
  const home = join(root, "home");
  mkdirSync(cwd, { recursive: true });
  const fusebaseConfigDir = join(home, ".fusebase");
  mkdirSync(fusebaseConfigDir, { recursive: true });

  writeFileSync(
    join(fusebaseConfigDir, "config.json"),
    JSON.stringify(
      { apiKey: opts.apiKey, env: opts.env, ...opts.extraConfig },
      null,
      2,
    ),
    "utf-8",
  );

  return {
    cwd,
    home,
    cleanup: () => {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    },
  };
}

export interface RunCliOptions {
  cwd: string;
  home: string;
  /** Extra env vars to merge in (overrides process.env entries). */
  env?: Record<string, string>;
}

/** Runs the CLI to completion and captures stdout/stderr/exit-code. */
export async function runCli(
  args: string[],
  opts: RunCliOptions,
): Promise<RunResult> {
  const proc = Bun.spawn({
    cmd: ["bun", CLI_ENTRY, ...args],
    cwd: opts.cwd,
    env: {
      ...process.env,
      HOME: opts.home,
      USERPROFILE: opts.home,
      FUSEBASE_DISABLE_ANALYTICS: "1",
      ...(opts.env ?? {}),
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

export interface CliStreamHandle {
  /** Underlying Bun subprocess. */
  proc: ReturnType<typeof Bun.spawn>;
  /**
   * Buffers all stdout text seen so far. Mutated as the process emits output.
   */
  stdout: () => string;
  /** Buffers all stderr text seen so far. */
  stderr: () => string;
  /**
   * Resolves once `predicate(combinedOutput)` is true. Rejects if the process
   * exits before the predicate is satisfied or the timeout elapses.
   */
  waitForReady: (
    predicate: RegExp | ((output: string) => boolean),
    timeoutMs?: number,
  ) => Promise<void>;
  /** Sends SIGTERM (then SIGKILL after 5s) and awaits exit. Idempotent. */
  kill: () => Promise<number>;
}

/**
 * Spawns the CLI in streaming mode (e.g. `dev start`). The caller is
 * responsible for calling `kill()` (typically in `afterAll`/`afterEach`).
 */
export function runCliStreaming(
  args: string[],
  opts: RunCliOptions,
): CliStreamHandle {
  const proc = Bun.spawn({
    cmd: ["bun", CLI_ENTRY, ...args],
    cwd: opts.cwd,
    env: {
      ...process.env,
      HOME: opts.home,
      USERPROFILE: opts.home,
      FUSEBASE_DISABLE_ANALYTICS: "1",
      ...(opts.env ?? {}),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  let stdoutBuf = "";
  let stderrBuf = "";
  const stdoutDone = pumpStream(proc.stdout, (chunk) => {
    stdoutBuf += chunk;
  });
  const stderrDone = pumpStream(proc.stderr, (chunk) => {
    stderrBuf += chunk;
  });

  let killed = false;

  async function kill(): Promise<number> {
    if (proc.exitCode != null) return proc.exitCode;
    if (!killed) {
      killed = true;
      proc.kill("SIGTERM");
      const fallback = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // already exited
        }
      }, 5000);
      await proc.exited.finally(() => clearTimeout(fallback));
      await Promise.allSettled([stdoutDone, stderrDone]);
    }
    return proc.exitCode ?? -1;
  }

  function waitForReady(
    predicate: RegExp | ((output: string) => boolean),
    timeoutMs = 60_000,
  ): Promise<void> {
    const matches =
      predicate instanceof RegExp
        ? (s: string) => predicate.test(s)
        : predicate;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const tick = setInterval(() => {
        if (settled) return;
        if (matches(stdoutBuf + stderrBuf)) {
          settled = true;
          clearInterval(tick);
          clearTimeout(timer);
          resolve();
        } else if (proc.exitCode != null) {
          settled = true;
          clearInterval(tick);
          clearTimeout(timer);
          reject(
            new Error(
              `CLI exited (code ${proc.exitCode}) before becoming ready.\nstdout:\n${stdoutBuf}\nstderr:\n${stderrBuf}`,
            ),
          );
        }
      }, 100);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearInterval(tick);
        reject(
          new Error(
            `CLI did not become ready within ${timeoutMs}ms.\nstdout:\n${stdoutBuf}\nstderr:\n${stderrBuf}`,
          ),
        );
      }, timeoutMs);
    });
  }

  return {
    proc,
    stdout: () => stdoutBuf,
    stderr: () => stderrBuf,
    waitForReady,
    kill,
  };
}

function environmentLockPaths(cwd: string): string[] {
  const dir = join(cwd, "environments");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(dir, name));
}

/** Resolved platform app id: env lockfile when `init` created one, else fusebase.json. */
export function readResolvedAppId(cwd: string): string | undefined {
  for (const path of environmentLockPaths(cwd)) {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as {
      apps?: Record<string, { id?: string }>;
    };
    for (const entry of Object.values(raw.apps ?? {})) {
      if (entry?.id) return entry.id;
    }
  }
  const fuse = JSON.parse(readFileSync(join(cwd, "fusebase.json"), "utf-8")) as {
    apps?: Array<{ id?: string }>;
  };
  return fuse.apps?.[0]?.id;
}

/** Drop a reconcile-written app id so the next deploy takes the id-less bind path. */
export function clearResolvedAppId(cwd: string): void {
  const fusePath = join(cwd, "fusebase.json");
  const fuse = JSON.parse(readFileSync(fusePath, "utf-8")) as {
    apps?: Array<{ id?: string }>;
  };
  if (fuse.apps?.[0]) delete fuse.apps[0].id;
  writeFileSync(fusePath, JSON.stringify(fuse, null, 2) + "\n", "utf-8");
  for (const path of environmentLockPaths(cwd)) {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as {
      apps?: Record<string, { id?: string }>;
    };
    for (const entry of Object.values(raw.apps ?? {})) {
      if (entry) delete entry.id;
    }
    writeFileSync(path, JSON.stringify(raw, null, 2) + "\n", "utf-8");
  }
}

/** Put the resolved id where deploy reads it (env lockfile, and fusebase.json in legacy mode). */
export function setResolvedAppId(cwd: string, appId: string): void {
  const locks = environmentLockPaths(cwd);
  if (locks.length === 0) {
    const fusePath = join(cwd, "fusebase.json");
    const fuse = JSON.parse(readFileSync(fusePath, "utf-8")) as {
      apps?: Array<{ id?: string }>;
    };
    if (fuse.apps?.[0]) fuse.apps[0].id = appId;
    writeFileSync(fusePath, JSON.stringify(fuse, null, 2) + "\n", "utf-8");
    return;
  }
  for (const path of locks) {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as {
      apps?: Record<string, { id?: string }>;
    };
    const apps = raw.apps ?? {};
    const keys = Object.keys(apps);
    if (keys.length === 0) continue;
    apps[keys[0]!] = { ...apps[keys[0]!], id: appId };
    raw.apps = apps;
    writeFileSync(path, JSON.stringify(raw, null, 2) + "\n", "utf-8");
  }
}

async function pumpStream(
  stream: ReadableStream<Uint8Array> | undefined | null,
  onChunk: (chunk: string) => void,
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) onChunk(decoder.decode(value, { stream: true }));
    }
    const tail = decoder.decode();
    if (tail) onChunk(tail);
  } finally {
    reader.releaseLock();
  }
}
