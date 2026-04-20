#!/usr/bin/env node
// Root typecheck: for each feature (from fusebase.json or features/), run TypeScript
// the same way deploy would surface errors — without running Vite.
// - Prefer package.json "typecheck" script when present.
// - Else if tsconfig.json has project references → npx tsc -b --noEmit
// - Else if tsconfig.json exists → npx tsc --noEmit -p tsconfig.json
// - Else if only tsconfig.app.json → npx tsc --noEmit -p tsconfig.app.json
// - Otherwise skip (no TS project in that feature).

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function loadFeatureDirs() {
  const fusebasePath = path.join(projectDir, "fusebase.json");
  if (fs.existsSync(fusebasePath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(fusebasePath, "utf8"));
      const paths = (cfg.features || []).map((f) => f.path).filter(Boolean);
      if (paths.length > 0) {
        return paths.map((p) => path.join(projectDir, p));
      }
    } catch {
      // fall through to scan
    }
  }
  const featuresDir = path.join(projectDir, "features");
  if (!fs.existsSync(featuresDir)) return [];
  return fs
    .readdirSync(featuresDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(featuresDir, d.name));
}

function decideCommand(featureDir) {
  const pkgPath = path.join(featureDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (pkg.scripts?.typecheck) {
        return { command: npmCommand(), args: ["run", "typecheck"], label: "typecheck script" };
      }
    } catch {
      // ignore
    }
  }
  const tsRoot = path.join(featureDir, "tsconfig.json");
  if (fs.existsSync(tsRoot)) {
    try {
      const ts = JSON.parse(fs.readFileSync(tsRoot, "utf8"));
      if (Array.isArray(ts.references) && ts.references.length > 0) {
        return {
          command: npxCommand(),
          args: ["tsc", "-b", "--noEmit"],
          label: "tsc -b",
        };
      }
    } catch {
      // ignore
    }
    return {
      command: npxCommand(),
      args: ["tsc", "--noEmit", "-p", "tsconfig.json"],
      label: "tsc",
    };
  }
  const tsApp = path.join(featureDir, "tsconfig.app.json");
  if (fs.existsSync(tsApp)) {
    return {
      command: npxCommand(),
      args: ["tsc", "--noEmit", "-p", "tsconfig.app.json"],
      label: "tsc app",
    };
  }
  return null;
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function main() {
  const dirs = loadFeatureDirs();
  if (dirs.length === 0) {
    process.exit(0);
  }

  const failures = [];
  for (const featureDir of dirs) {
    if (!fs.existsSync(featureDir)) continue;
    const decision = decideCommand(featureDir);
    if (!decision) continue;

    const rel = path.relative(projectDir, featureDir);
    const result = spawnSync(decision.command, decision.args, {
      cwd: featureDir,
      encoding: "utf-8",
    });
    const code = result.status ?? 1;
    if (code !== 0) {
      const errorLine = result.error ? `${result.error.message}\n` : "";
      const out = [errorLine, result.stdout, result.stderr].filter(Boolean).join("");
      failures.push(
        `Feature "${rel}" (${decision.label}):\n${out || "(no output)"}`,
      );
    }
  }

  if (failures.length === 0) {
    process.exit(0);
  }
  console.error(failures.join("\n\n"));
  process.exit(1);
}

main();
