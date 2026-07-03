/**
 * FuseBase CLI launcher (`fusebase.exe`).
 *
 * Stable, rarely-changing wrapper on PATH (Program Files). On every invocation
 * it resolves the active CLI binary from the user-writable cache
 * (`%LOCALAPPDATA%\FuseBase\CLI\`) and execs it, forwarding args/stdio/exit
 * code. First run bootstraps the cache; a missing/broken active binary falls
 * back to the retained previous version. Bun-compiled from this repo so it
 * imports `lib/win-cli-cache` and the URL/manifest logic directly.
 */
import { spawn } from "child_process";
import { appendFile } from "fs/promises";
import { join } from "path";

import { getUpdateChannel } from "../lib/config";
import { downloadToBytes } from "../lib/download-progress";
import {
  fetchManifest,
  getBinaryUrl,
  resolveLatestVersion,
} from "../lib/remote-version";
import { LAUNCHER_VERSION } from "../lib/launcher-version";
import {
  SUPPORTED_SCHEMA,
  binPathForVersion,
  enumerateVersions,
  findPreviousVersion,
  getCacheRoot,
  readCurrent,
  resolveActiveVersion,
  stageAndInstallBinary,
  writeCurrentAtomic,
} from "../lib/win-cli-cache";
import {
  isLauncherAwareCliVersion,
  isLauncherUpdateCommand,
  isUpdateCommand,
  selectFallbackVersion,
  selectLauncherAwareFallback,
  stripLauncherFlags,
  wantsPreviousVersion,
} from "./launcher-core";

async function log(root: string, message: string): Promise<void> {
  try {
    await appendFile(
      join(root, "launcher.log"),
      `[${new Date().toISOString()}] ${message}\n`,
    );
  } catch {
    // Diagnostics only — never fail a run because the log is unwritable.
  }
}

/** Spawns the cached CLI, inheriting stdio/cwd and injecting the launcher version. */
function runCli(binPath: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, args, {
      stdio: "inherit",
      env: { ...process.env, FUSEBASE_LAUNCHER_VERSION: LAUNCHER_VERSION },
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function bootstrap(root: string): Promise<string> {
  const channel = getUpdateChannel();
  // First run is otherwise silent while the CLI downloads — tell the user.
  // stderr so piped stdout stays clean.
  process.stderr.write("FuseBase: completing installation (one-time)...\n");
  try {
    const manifest = await fetchManifest();
    const version = resolveLatestVersion(manifest, channel);
    const url = getBinaryUrl(version);
    await stageAndInstallBinary(root, version, () => downloadToBytes(url));
    await writeCurrentAtomic(root, {
      schemaVersion: SUPPORTED_SCHEMA,
      version,
      updatedAt: new Date().toISOString(),
    });
    process.stderr.write(`FuseBase CLI ${version} installed.\n`);
    await log(root, `bootstrap: installed ${version} (channel ${channel})`);
    return version;
  } catch (err) {
    await log(root, `bootstrap failed: ${String(err)}`);
    console.error(
      "Cannot bootstrap the FuseBase CLI offline. Connect to the internet and try again.",
    );
    process.exit(1);
  }
}

/** Runs the retained previous version (`--previous-version` escape hatch). */
async function runPreviousVersion(root: string, args: string[]): Promise<never> {
  const current = await readCurrent(root);
  const active = current?.version ?? (await enumerateVersions(root))[0];
  const previous = active ? await findPreviousVersion(root, active) : null;
  if (!previous) {
    console.error("No previous version available.");
    process.exit(1);
  }
  await log(root, `--previous-version: running ${previous}`);
  process.exit(await runCli(binPathForVersion(root, previous), args));
}

async function main(): Promise<never> {
  const root = getCacheRoot();
  const rawArgs = process.argv.slice(2);
  const args = stripLauncherFlags(rawArgs);

  if (wantsPreviousVersion(rawArgs)) {
    return runPreviousVersion(root, args);
  }

  const resolved = await resolveActiveVersion(root);
  let version: string;
  if (resolved.kind === "bootstrap") {
    version = await bootstrap(root);
  } else if (resolved.kind === "recovered" || resolved.kind === "migrated") {
    version = resolved.version;
    await writeCurrentAtomic(root, {
      schemaVersion: SUPPORTED_SCHEMA,
      version,
      updatedAt: new Date().toISOString(),
    });
    await log(
      root,
      resolved.kind === "migrated"
        ? `migrated current.json to schema ${SUPPORTED_SCHEMA} (version ${version})`
        : `recovered pointer to ${version}`,
    );
  } else {
    version = resolved.version;
  }

  let legacyUpdateRedirected = false;
  if (
    !isLauncherAwareCliVersion(version) &&
    isUpdateCommand(args) &&
    !isLauncherUpdateCommand(args)
  ) {
    const fallback = selectLauncherAwareFallback(await enumerateVersions(root), version);
    if (!fallback) {
      console.error(
        "The active cached CLI is a legacy Windows CLI and cannot safely run `fusebase update` under the launcher/cache model.",
      );
      console.error(
        "No launcher-aware cached CLI is available to perform the update. Switch to or install a launcher-aware channel, then try again.",
      );
      process.exit(1);
    }
    await log(root, `legacy update redirect: ${version} -> ${fallback}`);
    version = fallback;
    legacyUpdateRedirected = true;
  }

  try {
    process.exit(await runCli(binPathForVersion(root, version), args));
  } catch {
    if (legacyUpdateRedirected) {
      const fallback = selectLauncherAwareFallback(await enumerateVersions(root), version);
      if (!fallback) {
        console.error(
          "The launcher-aware CLI selected to recover `fusebase update` failed to start, and no other launcher-aware cached CLI is available.",
        );
        process.exit(1);
      }
      await log(
        root,
        `legacy update redirect fallback: ${version} failed to start, running ${fallback}`,
      );
      process.exit(await runCli(binPathForVersion(root, fallback), args));
    }

    // Active binary missing or won't start → fall back to the previous version.
    const fallback = selectFallbackVersion(await enumerateVersions(root), version);
    if (!fallback) {
      console.error(
        "The active CLI binary is unavailable and no previous version is cached.",
      );
      process.exit(1);
    }
    await log(root, `fallback: ${version} failed to start, running ${fallback}`);
    process.exit(await runCli(binPathForVersion(root, fallback), args));
  }
}

void main();
