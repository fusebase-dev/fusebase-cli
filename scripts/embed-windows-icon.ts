#!/usr/bin/env bun
// Embeds the FuseBase icon and version metadata into the bun-compiled Windows
// .exe via rcedit. We run this after `bun build --compile --target=bun-windows-x64`
// because bun's `--windows-icon` flag only works when compiling on Windows; on
// Linux CI we fall back to rcedit (rcedit-x64.exe under Wine).

import path from "node:path";
import { existsSync } from "node:fs";
import { rcedit } from "rcedit";

const [, , exePath, version] = process.argv;

if (!exePath) {
  console.error("Usage: bun scripts/embed-windows-icon.ts <exe> [version]");
  process.exit(1);
}

if (!existsSync(exePath)) {
  console.error(`Error: ${exePath} not found`);
  process.exit(1);
}

// Modern Wine packages on Debian/Ubuntu (>=9.0) ship only `wine` (the 64-bit
// binary) — the `wine64` symlink is gone. The `cross-spawn-windows-exe` helper
// inside `rcedit` defaults to `wine64` on x86_64 and does not fall back, so we
// pin WINE_BINARY=wine when neither WINE_BINARY nor `wine64` is on PATH.
if (!process.env.WINE_BINARY) {
  process.env.WINE_BINARY = "wine";
}
// Suppress noisy "fixme:" stderr messages from Wine.
if (!process.env.WINEDEBUG) {
  process.env.WINEDEBUG = "-all";
}

const projectRoot = path.resolve(import.meta.dirname, "..");
const iconPath = path.join(projectRoot, "assets", "cli-icon.ico");

if (!existsSync(iconPath)) {
  console.error(`Error: icon not found at ${iconPath}`);
  process.exit(1);
}

// rcedit's --set-file-version / --set-product-version require strict n.n.n.n
// (each part a 16-bit unsigned int). Our timestamp dev versions
// (YYYY.mmddhh.mmss) overflow 65535 in the second component, and prod semvers
// only have 3 parts. Coerce to a safe 4-tuple by truncating each numeric
// component to 65535 and padding with zeros.
function toWindowsVersion(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const parts = input
    .split(/[.\-+]/)
    .map((p) => parseInt(p, 10))
    .filter((n) => !Number.isNaN(n))
    .map((n) => Math.min(Math.max(n, 0), 65535));
  while (parts.length < 4) parts.push(0);
  return parts.slice(0, 4).join(".");
}

const winVersion = toWindowsVersion(version);

console.log(`Embedding icon into ${exePath}`);
console.log(`  icon: ${iconPath}`);
if (winVersion) console.log(`  version: ${winVersion}`);

await rcedit(exePath, {
  icon: iconPath,
  "version-string": {
    ProductName: "FuseBase CLI",
    FileDescription: "FuseBase Apps CLI",
    CompanyName: "FuseBase",
    OriginalFilename: path.basename(exePath),
  },
  ...(winVersion
    ? { "file-version": winVersion, "product-version": winVersion }
    : {}),
});

console.log("Icon embedded successfully");

// rcedit leaves bun's residual `IDI_MYICON` RT_GROUP_ICON behind. Its
// metadata still claims it's a 256x256 / 270600-byte icon but now points at
// our 16x16 BMP — Windows resolves IDI_MYICON for some renders and ends up
// scaling 16x16 → 256x256, which is the blurry-icon QA reported on
// NIM-40683 even after we shipped a real 256x256 entry. Patch that entry in
// place to point at our real 256x256 PNG.
const fixIdiScript = path.join(projectRoot, "scripts", "fix-windows-idi-myicon.py");
console.log(`Patching residual IDI_MYICON in ${exePath}`);
const proc = Bun.spawn(["python3", fixIdiScript, exePath], {
  stdout: "inherit",
  stderr: "inherit",
});
const fixCode = await proc.exited;
if (fixCode !== 0) {
  throw new Error(`fix-windows-idi-myicon.py exited with code ${fixCode}`);
}
