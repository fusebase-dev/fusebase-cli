#!/usr/bin/env node
// Claude Code Stop hook:
// 1. Ensure no feature has a non-"/" `base` in vite config.
// 2. Ensure all feature directories are registered in fusebase.json.

const fs = require("fs");
const path = require("path");

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const featuresDir = path.join(projectDir, "features");

if (!fs.existsSync(featuresDir)) {
  process.exit(0);
}

const featureNames = fs
  .readdirSync(featuresDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

if (featureNames.length === 0) {
  process.exit(0);
}

const errors = [];

// --- Check 1: Vite base config ---
for (const name of featureNames) {
  const fullPath = path.join(featuresDir, name);
  let viteConfigPath = null;

  if (fs.existsSync(path.join(fullPath, "vite.config.ts"))) {
    viteConfigPath = path.join(fullPath, "vite.config.ts");
  } else if (fs.existsSync(path.join(fullPath, "vite.config.js"))) {
    viteConfigPath = path.join(fullPath, "vite.config.js");
  } else {
    continue;
  }

  const content = fs.readFileSync(viteConfigPath, "utf-8");

  // Match base: "/value" or base: '/value' (with optional trailing comma)
  const match = content.match(/^\s*base\s*:\s*(['"])([^'"]*)\1/m);

  if (!match) {
    // base is not set — that's fine
    continue;
  }

  const baseValue = match[2];
  if (baseValue !== "/") {
    errors.push(
      `Feature "${name}": vite config base is set to "${baseValue}" — this is not allowed. base must be "/" or not set at all.`
    );
  }
}

// --- Check 2: Features must be registered in fusebase.json ---
const fusebasePath = path.join(projectDir, "fusebase.json");
if (fs.existsSync(fusebasePath)) {
  try {
    const fusebaseConfig = JSON.parse(fs.readFileSync(fusebasePath, "utf-8"));
    const registeredPaths = (fusebaseConfig.features || []).map((f) => f.path);

    const unregistered = featureNames.filter((name) => {
      const featurePath = `features/${name}`;
      return !registeredPaths.includes(featurePath);
    });

    if (unregistered.length > 0) {
      errors.push(
        `The following feature directories are not registered in fusebase.json:\n` +
          unregistered.map((n) => `  - features/${n}`).join("\n") +
          `\n\nEach feature must be created using "fusebase feature create" so it is properly registered.`
      );
    }
  } catch {
    // fusebase.json is malformed — skip this check
  }
}

if (errors.length > 0) {
  const output = {
    decision: "block",
    reason: errors.join("\n\n"),
  };
  console.log(JSON.stringify(output));
}

process.exit(0);
