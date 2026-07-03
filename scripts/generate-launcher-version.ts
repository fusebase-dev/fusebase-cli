#!/usr/bin/env bun
/**
 * Generates `lib/launcher-version.ts` with the launcher version baked in as a
 * literal, derived from the launcher source set's last git change, in the same
 * `YYYY.mmddhh.mmss` UTC timestamp shape as `devVersion` (so `compareVersions`
 * orders it). Source-last-change (not build time) means a launcher *bugfix*
 * auto-bumps the nudge while an unchanged launcher does not.
 *
 * The value must be **written into the source file** (not read from env at
 * runtime): `bun --compile` does not bake build-time `process.env`, so a
 * compiled binary would otherwise always fall back to the default. The env
 * override is retained as a fallback for off-prod testing.
 *
 * Also prints the value to stdout so the build script can use it for the
 * artifact filename and `build/.launcher-version`.
 *
 * The source set is a documented heuristic — keep it in sync with the launcher's
 * real imports. An under-bump (a transitively-imported module changed but isn't
 * listed) leaves a stale-but-working launcher; an over-bump fires a redundant
 * nudge. Both are harmless, so a precise full-transitive hash isn't worth it.
 */
import { execFileSync } from "node:child_process";

const projectRoot = process.env.PROJECT_ROOT ?? process.cwd();

// Heuristic: the launcher entrypoint plus the two lib modules it shares with the
// CLI update path. Update this list if the launcher's imports grow.
const SOURCE_SET = ["launcher", "lib/win-cli-cache.ts", "lib/remote-version.ts"];

function formatTimestamp(date: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${date.getUTCFullYear()}.` +
    `${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}.` +
    `${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`
  );
}

let version = "";
try {
  version = execFileSync(
    "git",
    [
      "-C",
      projectRoot,
      "log",
      "-1",
      "--format=%cd",
      "--date=format-local:%Y.%m%d%H.%M%S",
      "--",
      ...SOURCE_SET,
    ],
    { encoding: "utf8", env: { ...process.env, TZ: "UTC" } },
  ).trim();
} catch {
  version = "";
}

// No committed history for the source set yet (e.g. local cross-build before
// commit): fall back to the current UTC time so the build still gets a valid,
// monotonically-increasing version.
if (!version) {
  version = formatTimestamp(new Date());
}

await Bun.write(
  `${projectRoot}/lib/launcher-version.ts`,
  `/** Generated from the launcher source's last git change in prebuild. Do not edit manually. */\n` +
    `export const LAUNCHER_VERSION = process.env.FUSEBASE_LAUNCHER_VERSION ?? "${version}";\n`,
);

console.log(version);
