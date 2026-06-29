import { Command } from "commander";
import { chmod, mkdir, rename, unlink, writeFile, realpath } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { spawn } from "child_process";
import { VERSION } from "../version";
import { getUpdateChannel } from "../config";
import {
  fetchManifest,
  getBinaryUrl,
  compareVersions,
  isDevVersion,
  type Manifest,
} from "../remote-version";

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

async function detectLinkedOrLocalCli(): Promise<{
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
  const latestVersion =
    channel === "dev" && manifest.devVersion
      ? manifest.devVersion
      : manifest.version;
  console.log(`Current version : ${VERSION}`);
  console.log(`Update channel  : ${channel}`);
  console.log(`Latest version  : ${latestVersion}`);

  // If on prod channel but running a dev build, force-downgrade to latest prod.
  const forceProd = channel === "prod" && isDevVersion(VERSION);
  if (!forceProd && compareVersions(latestVersion, VERSION) <= 0) {
    console.log("✓ Already up to date.");
    return { status: "already-up-to-date", latestVersion };
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

  if (process.platform === "win32") {
    const installerDir = join(tmpdir(), "fusebase-update");
    const installerPath = join(
      installerDir,
      `fusebase-installer-${latestVersion}.exe`,
    );
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
    console.log("  Exiting now so the installer can replace fusebase.exe.");
    process.exit(0);
    return { status: "updated", latestVersion };
  }

  const currentPath = process.execPath;
  const tmpPath = join(tmpdir(), `fusebase-update-${Date.now()}.bin`);

  try {
    await writeFile(tmpPath, Buffer.from(data));
    await chmod(tmpPath, 0o755);
    await rename(tmpPath, currentPath);
    console.log(`✓ Updated to ${latestVersion}. Path ${currentPath}`);
    return { status: "updated", latestVersion };
  } catch (err) {
    await cleanupTmp(tmpPath);
    throw new Error(`Failed to replace binary: ${String(err)}`);
  }
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
