import { Command } from "commander";
import { chmod, mkdir, rename, unlink, writeFile } from "fs/promises";
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

export const cliCommand = new Command("cli")
  .description("Fusebase CLI maintenance");

cliCommand
  .command("update")
  .description("Update the CLI binary to the latest version")
  .action(async () => {
    console.log("Checking for updates...");

    let manifest: Manifest;
    try {
      manifest = await fetchManifest();
    } catch (err) {
      console.error("Error: Could not reach update server:", err);
      process.exit(1);
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
      return;
    }

    const binaryUrl = getBinaryUrl(latestVersion);
    console.log(`Downloading ${binaryUrl} ...`);

    let data: ArrayBuffer;
    try {
      const res = await fetch(binaryUrl);
      if (!res.ok) {
        console.error(`Error: Failed to download binary (HTTP ${res.status})`);
        process.exit(1);
      }
      data = await res.arrayBuffer();
    } catch (err) {
      console.error("Error: Download failed:", err);
      process.exit(1);
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
        console.error("Error: Failed to save installer:", err);
        process.exit(1);
      }

      spawn("explorer.exe", [installerDir], {
        detached: true,
        stdio: "ignore",
      }).unref();

      console.log(`✓ Installer saved to: ${installerPath}`);
      console.log("  The folder has been opened in Explorer.");
      console.log("  Double-click the installer to complete the update.");
      return;
    }

    const currentPath = process.execPath;
    const tmpPath = join(tmpdir(), `fusebase-update-${Date.now()}.bin`);

    try {
      await writeFile(tmpPath, Buffer.from(data));
      await chmod(tmpPath, 0o755);
      await rename(tmpPath, currentPath);
      console.log(`✓ Updated to ${latestVersion}. Path ${currentPath}`);
    } catch (err) {
      await cleanupTmp(tmpPath);
      console.error("Error: Failed to replace binary:", err);
      process.exit(1);
    }
  });

