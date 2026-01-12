#!/usr/bin/env bun
/**
 * Validates all skills in project-template/.claude/skills using the official
 * skills-ref CLI: https://github.com/agentskills/agentskills/tree/main/skills-ref
 *
 * Requires `skills-ref` on PATH (install from the repo with pip or uv).
 * Usage: bun scripts/validate-skills.ts [path]
 *   path  Optional; default: project-template/.claude/skills (relative to repo root)
 */

import { readdir } from "fs/promises";
import { join } from "path";
import { resolve } from "path";

const DEFAULT_SKILLS_ROOT = "project-template/.claude/skills";

function repoRoot(): string {
  const fromScript = resolve(import.meta.dir, "..");
  return fromScript;
}

async function main(): Promise<void> {
  const root = repoRoot();
  const skillsRootArg = process.argv[2];
  const skillsRoot = skillsRootArg
    ? resolve(process.cwd(), skillsRootArg)
    : join(root, DEFAULT_SKILLS_ROOT);

  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true });
  } catch (e) {
    console.error(
      "Error: Cannot read skills root:",
      skillsRoot,
      (e as Error).message
    );
    process.exit(1);
  }

  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => join(skillsRoot, e.name))
    .sort();

  if (dirs.length === 0) {
    console.log("No skill directories found at", skillsRoot);
    return;
  }

  let hasError = false;
  let skillsRefMissing = false;

  for (const dir of dirs) {
    const name = dir.split(/[/\\]/).pop() ?? dir;
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn(["skills-ref", "validate", dir], {
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (e) {
      if (
        (e as NodeJS.ErrnoException).code === "ENOENT" ||
        String((e as Error).message).toLowerCase().includes("not found")
      ) {
        skillsRefMissing = true;
        break;
      }
      throw e;
    }

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    if (exitCode === 127 || (exitCode !== 0 && stderr.includes("not found"))) {
      skillsRefMissing = true;
      break;
    }

    if (exitCode !== 0) {
      hasError = true;
      console.error(`${name}:`);
      const out = (stdout || stderr).trim();
      if (out) {
        for (const line of out.split("\n")) {
          console.error("  ", line);
        }
      } else {
        console.error("  validation failed (exit", exitCode, ")");
      }
    } else {
      console.log("✓", name);
    }
  }

  if (skillsRefMissing) {
    console.error(`
'skills-ref' is not installed or not on PATH.

Install once (macOS/Homebrew Python needs a venv or pipx):

  # Option 1: pipx (adds skills-ref to PATH for good)
  brew install pipx && pipx ensurepath
  pipx install -e /tmp/agentskills/skills-ref
  # Restart the terminal or: source ~/.zshrc

  # Option 2: venv (activate before npm run skills:validate)
  cd /tmp/agentskills/skills-ref
  python3 -m venv .venv && source .venv/bin/activate
  pip install -e .
  # Then run from apps-cli: source /tmp/agentskills/skills-ref/.venv/bin/activate && npm run skills:validate

  # Option 3: uv (install from https://docs.astral.sh/uv/)
  cd /tmp/agentskills/skills-ref && uv sync && source .venv/bin/activate

Then run: npm run skills:validate

Note: skills-ref expects a skill directory (e.g. .claude/skills/file-upload), not the SKILL.md file path.
See: https://github.com/agentskills/agentskills/tree/main/skills-ref
`);
    process.exit(1);
  }

  if (hasError) {
    process.exit(1);
  }

  console.log("\n✓ All", dirs.length, "skill(s) valid.");
}

main();
