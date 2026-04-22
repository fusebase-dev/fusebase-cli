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

    try {
      await mkdir(installerDir, { recursive: true });
      await writeFile(installerPath, Buffer.from(data));
    } catch (err) {
      throw new Error(`Failed to save installer: ${String(err)}`);
    }

    spawn("explorer.exe", [installerDir], {
      detached: true,
      stdio: "ignore",
    }).unref();

    console.log(`✓ Installer saved to: ${installerPath}`);
    console.log("  The folder has been opened in Explorer.");
    console.log("  Double-click the installer to complete the update.");
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

