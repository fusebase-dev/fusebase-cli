import { Command } from "commander";
import { chmod, mkdir, rename, stat, unlink, writeFile, realpath } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { spawn } from "child_process";
import { VERSION } from "../version";
import { getUpdateChannel } from "../config";
import {
  fetchManifest,
  getBinaryUrl,
  getInstallerUrl,
  compareVersions,
  isDevVersion,
  resolveLatestVersion,
  type Manifest,
} from "../remote-version";
import {
  getCacheRoot,
  pruneToTwo,
  stageAndInstallBinary,
  writeCurrentAtomic,
  SUPPORTED_SCHEMA,
  type BinarySource,
} from "../win-cli-cache";
import { downloadToBytes } from "../download-progress";

async function cleanupTmp(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // ignore
  }
}

function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      child.off("spawn", onSpawn);
      child.off("error", onError);
    };
    const onSpawn = () => {
      cleanup();
      child.unref();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    timeout = setTimeout(() => {
      cleanup();
      child.unref();
      resolve();
    }, 5000);
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

function escapePowerShellString(value: string): string {
  return value.replace(/'/g, "''");
}

async function writeWindowsInstallerLaunchers(installerPath: string): Promise<string> {
  const launcherDir = join(tmpdir(), "fusebase-update");
  const powershellLauncherFile = "launch-installer.ps1";
  const powershellLauncherPath = join(launcherDir, powershellLauncherFile);
  const cmdLauncherPath = join(launcherDir, "launch-installer.cmd");
  const escapedInstallerPath = escapePowerShellString(installerPath);
  const powershellScript = [
    "$ErrorActionPreference = 'Continue'",
    "$logDir = Join-Path $env:TEMP 'fusebase-update'",
    "New-Item -ItemType Directory -Force -Path $logDir | Out-Null",
    "$log = Join-Path $logDir 'installer-launch.log'",
    `"[$(Get-Date -Format o)] Launcher script started." | Add-Content -Path $log`,
    `$currentPid = ${process.pid}`,
    `"[$(Get-Date -Format o)] Waiting for fusebase pid $currentPid to exit." | Add-Content -Path $log`,
    "try { Wait-Process -Id $currentPid -Timeout 120 -ErrorAction SilentlyContinue } catch { $_ | Out-String | Add-Content -Path $log }",
    "$running = Get-Process -Name 'fusebase' -ErrorAction SilentlyContinue",
    `"[$(Get-Date -Format o)] Remaining fusebase process count: $(($running | Measure-Object).Count)." | Add-Content -Path $log`,
    "if ($running) { $running | Stop-Process -Force -ErrorAction SilentlyContinue }",
    `$installerPath = '${escapedInstallerPath}'`,
    `"[$(Get-Date -Format o)] Starting installer: $installerPath" | Add-Content -Path $log`,
    "try {",
    "  Start-Process -FilePath $installerPath -Verb RunAs",
    `  "[$(Get-Date -Format o)] Start-Process completed." | Add-Content -Path $log`,
    "} catch {",
    "  $_ | Out-String | Add-Content -Path $log",
    "}",
    "",
  ].join("\r\n");
  const cmdScript = [
    "@echo off",
    "set LOG=%TEMP%\\fusebase-update\\installer-launch.log",
    "if not exist \"%TEMP%\\fusebase-update\" mkdir \"%TEMP%\\fusebase-update\"",
    "echo [%DATE% %TIME%] CMD launcher started.>> \"%LOG%\"",
    "echo [%DATE% %TIME%] Running PowerShell launcher.>> \"%LOG%\"",
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0${powershellLauncherFile}" >> "%LOG%" 2>&1`,
    "echo [%DATE% %TIME%] CMD launcher finished.>> \"%LOG%\"",
    "exit /b 0",
    "",
  ].join("\r\n");

  await writeFile(powershellLauncherPath, powershellScript, "utf-8");
  await writeFile(cmdLauncherPath, cmdScript, "utf-8");
  return cmdLauncherPath;
}

async function launchWindowsInstaller(installerPath: string): Promise<void> {
  const launcherPath = await writeWindowsInstallerLaunchers(installerPath);
  await spawnDetached("explorer.exe", [launcherPath]);
}

/**
 * `fusebase update --launcher`: refreshes the on-PATH launcher (`fusebase.exe`
 * in Program Files) via the elevated installer. This is the only path that
 * elevates. The detached helper waits for this CLI child to exit, then stops the
 * launcher process (`-Name 'fusebase'` matches only `fusebase.exe`, not the
 * `fusebase-cli.exe` child) so the locked file can be replaced, then launches
 * the installer with `-RunAs`. Exits with the installer-handoff message.
 */
export async function refreshWindowsLauncher(): Promise<void> {
  console.log("Checking for launcher updates...");

  let manifest: Manifest;
  try {
    manifest = await fetchManifest();
  } catch (err) {
    throw new Error(`Could not reach update server: ${String(err)}`);
  }

  const channel = getUpdateChannel();
  const latestVersion = resolveLatestVersion(manifest, channel);
  const installerUrl = getInstallerUrl(latestVersion);
  console.log(`Downloading launcher installer ${installerUrl} ...`);

  let data: Uint8Array;
  try {
    data = await downloadToBytes(installerUrl);
  } catch (err) {
    throw new Error(`Download failed: ${String(err)}`);
  }

  const installerDir = join(tmpdir(), "fusebase-update");
  const installerPath = join(installerDir, `fusebase-installer-${latestVersion}.exe`);
  const launcherLogPath = join(installerDir, "installer-launch.log");

  try {
    await mkdir(installerDir, { recursive: true });
    await writeFile(installerPath, Buffer.from(data));
  } catch (err) {
    throw new Error(`Failed to save installer: ${String(err)}`);
  }

  console.log(`✓ Installer saved to: ${installerPath}`);
  try {
    await launchWindowsInstaller(installerPath);
  } catch (err) {
    console.log(
      "  Installer could not be started automatically. Run it manually from this path.",
    );
    throw new Error(`Failed to start Windows installer: ${String(err)}`);
  }
  console.log(
    "  Installer launch requested. If it is not visible, run it manually from this path.",
  );
  console.log(`  Launcher log: ${launcherLogPath}`);
  console.log("  Complete the installer to finish refreshing the launcher (fusebase.exe).");
  process.exit(0);
}

export async function detectLinkedOrLocalCli(): Promise<{
  linked: boolean;
  reason?: "argv-script" | "exec-is-bun";
  scriptPath?: string;
}> {
  const argv1 = process.argv[1] ? await realpath(process.argv[1]).catch(() => process.argv[1]) : "";
  const argv1Lower = String(argv1).toLowerCase();
  const execBase = process.execPath.split("/").pop()?.toLowerCase() ?? "";

  // Running via bun/node script (e.g. bun link or direct local run), not compiled standalone binary.
  if (execBase === "bun" || execBase === "bunx" || execBase === "node") {
    return { linked: true, reason: "exec-is-bun", scriptPath: argv1 };
  }

  // Extra guard: script path clearly points to source repo.
  if (
    argv1Lower.endsWith("/index.ts") ||
    argv1Lower.endsWith("/index.js") ||
    argv1Lower.includes("/apps-cli/")
  ) {
    return { linked: true, reason: "argv-script", scriptPath: argv1 };
  }

  return { linked: false };
}

export interface CliSelfUpdateResult {
  status: "local-linked" | "already-up-to-date" | "updated";
  latestVersion?: string;
}

const UPDATE_LOCK_STALE_MS = 5 * 60 * 1000;

/** Best-effort lock around the Windows download+flip; steals a stale lock. */
async function withUpdateLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true });
  const lockPath = join(root, "update.lock");
  let acquired = false;
  try {
    await writeFile(lockPath, String(process.pid), { flag: "wx" });
    acquired = true;
  } catch {
    const age = await stat(lockPath)
      .then((s) => Date.now() - s.mtimeMs)
      .catch(() => Number.POSITIVE_INFINITY);
    if (age < UPDATE_LOCK_STALE_MS) {
      throw new Error(
        "Another `fusebase update` appears to be in progress. Try again shortly.",
      );
    }
    await writeFile(lockPath, String(process.pid));
    acquired = true;
  }
  try {
    return await fn();
  } finally {
    if (acquired) await unlink(lockPath).catch(() => {});
  }
}

/** Posix update apply: today's `writeFile → chmod → rename` over the running exe. */
async function applyPosixUpdate(version: string, data: ArrayBuffer): Promise<void> {
  const currentPath = process.execPath;
  const tmpPath = join(tmpdir(), `fusebase-update-${Date.now()}.bin`);
  try {
    await writeFile(tmpPath, Buffer.from(data));
    await chmod(tmpPath, 0o755);
    await rename(tmpPath, currentPath);
    console.log(`✓ Updated to ${version}. Path ${currentPath}`);
  } catch (err) {
    await cleanupTmp(tmpPath);
    throw new Error(`Failed to replace binary: ${String(err)}`);
  }
}

/**
 * Core Windows cache swap (injectable for tests): stage the new bin into
 * `versions\<new>\`, atomically flip `current.json`, prune to two. Never touches
 * the running binary; the new version takes effect on the next invocation.
 */
export async function runWindowsCacheSwap(
  root: string,
  newVersion: string,
  oldVersion: string,
  source: BinarySource,
): Promise<void> {
  await stageAndInstallBinary(root, newVersion, source);
  await writeCurrentAtomic(root, {
    schemaVersion: SUPPORTED_SCHEMA,
    version: newVersion,
    updatedAt: new Date().toISOString(),
  });
  await pruneToTwo(root, newVersion);
  console.log(`✓ FuseBase CLI updated from ${oldVersion} to ${newVersion}.`);
}

/**
 * Windows update apply: cache swap, wrapped in a best-effort update lock and
 * downloading the CLI bin via `getBinaryUrl`. No elevation, no installer, no
 * process restart.
 */
async function applyWindowsUpdate(
  newVersion: string,
  oldVersion: string,
): Promise<void> {
  const root = getCacheRoot();
  await withUpdateLock(root, () =>
    runWindowsCacheSwap(root, newVersion, oldVersion, () => {
      const url = getBinaryUrl(newVersion);
      console.log(`Downloading ${url} ...`);
      return downloadToBytes(url);
    }),
  );
}

export async function runCliSelfUpdate(): Promise<CliSelfUpdateResult> {
  const localMode = await detectLinkedOrLocalCli();
  if (localMode.linked) {
    const where = localMode.scriptPath
      ? ` (${localMode.scriptPath})`
      : "";
    console.log(
      "✓ Local linked CLI detected. `fusebase cli update` is not required for local source mode" +
        where +
        ".",
    );
    console.log("  Update by pulling latest code in your local apps-cli repo.");
    return { status: "local-linked" };
  }

  console.log("Checking for updates...");

  let manifest: Manifest;
  try {
    manifest = await fetchManifest();
  } catch (err) {
    throw new Error(`Could not reach update server: ${String(err)}`);
  }

  const channel = getUpdateChannel();
  const latestVersion = resolveLatestVersion(manifest, channel);
  console.log(`Current version : ${VERSION}`);
  console.log(`Update channel  : ${channel}`);
  console.log(`Latest version  : ${latestVersion}`);

  // If on prod channel but running a dev build, force-downgrade to latest prod.
  const forceProd = channel === "prod" && isDevVersion(VERSION);
  if (!forceProd && compareVersions(latestVersion, VERSION) <= 0) {
    console.log("✓ Already up to date.");
    return { status: "already-up-to-date", latestVersion };
  }

  // Windows: cache swap (no installer, no elevation, no restart). The download
  // happens inside the staged install so a failure never touches the active
  // version. Posix: download then replace the running binary in place.
  if (process.platform === "win32") {
    await applyWindowsUpdate(latestVersion, VERSION);
    return { status: "updated", latestVersion };
  }

  const binaryUrl = getBinaryUrl(latestVersion);
  console.log(`Downloading ${binaryUrl} ...`);

  let data: ArrayBuffer;
  try {
    const res = await fetch(binaryUrl);
    if (!res.ok) {
      throw new Error(`Failed to download binary (HTTP ${res.status})`);
    }
    data = await res.arrayBuffer();
  } catch (err) {
    throw new Error(`Download failed: ${String(err)}`);
  }

  await applyPosixUpdate(latestVersion, data);
  return { status: "updated", latestVersion };
}

export const cliCommand = new Command("cli")
  .description("Fusebase CLI maintenance");

cliCommand
  .command("update")
  .description("Update the CLI binary to the latest version")
  .action(async () => {
    try {
      await runCliSelfUpdate();
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
