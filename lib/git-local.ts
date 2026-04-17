import chalk from "chalk";
import { spawn } from "child_process";
import { readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { embeddedFiles } from "bun";

// @ts-ignore
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASELINE_GITIGNORE_TEMPLATE = `# Dependencies
node_modules/

# Build output
dist/
build/
out/

# Environment
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# OS
.DS_Store
Thumbs.db

# IDE
.idea/

# Coverage & caches
coverage/
.cache/
*.tsbuildinfo
.eslintcache

# Archives
*.tgz
`;

const BASELINE_GITIGNORE_TEMPLATE_PATH = "project-template/.gitignore";

function parseGitignorePatterns(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

async function loadBaselineGitignoreTemplate(): Promise<string> {
  const embedded = embeddedFiles.find((f) => {
    const name = ((f as { name?: string }).name ?? "").replace(/\\/g, "/");
    return name.includes(BASELINE_GITIGNORE_TEMPLATE_PATH);
  });
  if (embedded) {
    const buf = await (
      embedded as { arrayBuffer(): Promise<ArrayBuffer> }
    ).arrayBuffer();
    return Buffer.from(buf).toString("utf-8");
  }
  const devPath = join(__dirname, "..", BASELINE_GITIGNORE_TEMPLATE_PATH);
  try {
    return await readFile(devPath, "utf-8");
  } catch {
    return BASELINE_GITIGNORE_TEMPLATE;
  }
}

async function ensureBaselineGitignore(cwd: string): Promise<void> {
  const baselineTemplate = await loadBaselineGitignoreTemplate();
  const baselinePatterns = parseGitignorePatterns(baselineTemplate);
  const gitignorePath = join(cwd, ".gitignore");
  let projectContent = "";
  try {
    projectContent = await readFile(gitignorePath, "utf-8");
  } catch {
    // no .gitignore
  }

  const trimmed = projectContent.trim();
  if (!trimmed) {
    await writeFile(gitignorePath, baselineTemplate, "utf-8");
    console.log(
      chalk.green("✓") +
        " Created .gitignore (node_modules, dist, .env, logs, caches, …).",
    );
    return;
  }

  const missing = baselinePatterns.filter(
    (line) => !projectContent.includes(line),
  );
  if (missing.length === 0) {
    return;
  }

  const suffix =
    (projectContent.endsWith("\n") ? "" : "\n") +
    "\n" +
    missing.join("\n") +
    "\n";
  await writeFile(gitignorePath, projectContent.trimEnd() + suffix, "utf-8");
  console.log(
    chalk.green("✓") +
      " Updated .gitignore (added missing baseline ignore patterns).",
  );
}

const GIT_DOWNLOAD = "https://git-scm.com/downloads";

function gitInstallHint(): void {
  const platform = process.platform;
  let extra = "";
  if (platform === "darwin") {
    extra = `  macOS: ${chalk.cyan("https://git-scm.com/download/mac")} or install Xcode Command Line Tools (\`xcode-select --install\`).`;
  } else if (platform === "win32") {
    extra = `  Windows: ${chalk.cyan("https://git-scm.com/download/win")}`;
  } else {
    extra = `  Linux: ${chalk.cyan("https://git-scm.com/download/linux")} or your package manager (e.g. \`apt install git\`, \`dnf install git\`).`;
  }
  console.log();
  console.log(chalk.yellow("Git is not installed or not on PATH."));
  console.log("  Install Git from the official site:");
  console.log(`  ${chalk.cyan.bold(GIT_DOWNLOAD)}`);
  console.log(extra);
  console.log();
  console.log("  After installation, run:");
  console.log(`  ${chalk.bold("fusebase git")}`);
  console.log();
}

/** True if `cwd` is inside a Git working tree (including subdirs of a repo). */
export async function isInsideGitWorkTree(cwd: string): Promise<boolean> {
  const code = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"], {
    stdio: "ignore",
  });
  return code === 0;
}

export function runGit(
  cwd: string,
  args: string[],
  options: { stdio?: "pipe" | "inherit" | "ignore" } = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const git = "git";
    const child = spawn(git, args, {
      cwd,
      stdio: options.stdio ?? "inherit",
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        resolve(-1);
        return;
      }
      reject(err);
    });
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

/** Run git with stdout captured; code -1 means git binary missing (ENOENT). */
export function runGitCapture(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (d: Buffer) => out.push(d));
    child.stderr?.on("data", (d: Buffer) => err.push(d));
    child.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") {
        resolve({ code: -1, stdout: "", stderr: "" });
        return;
      }
      reject(e);
    });
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out).toString("utf-8"),
        stderr: Buffer.concat(err).toString("utf-8"),
      });
    });
  });
}

/** Returns -1 if git binary is missing (ENOENT). */
export async function checkGitAvailable(cwd: string): Promise<boolean> {
  const code = await runGit(cwd, ["--version"], { stdio: "ignore" });
  return code !== -1 && code === 0;
}

const GIT_BOX_WIDTH = 68;

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function gitBoxLine(content: string): string {
  const visible = stripAnsi(content).length;
  if (visible > GIT_BOX_WIDTH) return content;
  return content + " ".repeat(GIT_BOX_WIDTH - visible);
}

/**
 * Prints local vs remote explanation and a compact branch workflow diagram.
 */
export function printGitLocalGuide(): void {
  const top = `┌${"─".repeat(GIT_BOX_WIDTH)}┐`;
  const bottom = `└${"─".repeat(GIT_BOX_WIDTH)}┘`;
  const row = (s: string) => console.log(`│${gitBoxLine(s)}│`);

  console.log();
  console.log(chalk.dim("Local Git — what it is"));
  console.log(top);
  row("");
  row(
    `  ${chalk.bold("This is only local version control")} on your machine.`,
  );
  row("  Nothing is uploaded automatically. Branches and commits stay");
  row("  here until you add a remote and push.");
  row("");
  row(`  ${chalk.bold("Need Git in the cloud (GitHub, GitLab, etc.)?")}`);
  row("  1. Create an empty repo on the hosting site.");
  row("  2. In this project:");
  row(`     ${chalk.cyan("git remote add origin <repo-url>")}`);
  row(`     ${chalk.cyan("git branch -M main")}   ${chalk.dim("(if needed)")}`);
  row(`     ${chalk.cyan("git push -u origin main")}`);
  row("");
  console.log(bottom);
  console.log();
  console.log(chalk.dim("Handy branch workflow (local)"));
  console.log(top);
  row("");
  row(`  ${chalk.green("main")}  ─────●────────────●────────────►  stable line`);
  row(`            \\`);
  row(
    `             ${chalk.cyan("feature/x")}  ──●──●──►  ${chalk.dim("work, then merge back")}`,
  );
  row("");
  row(`  ${chalk.bold("Typical commands")}`);
  row(`  ${chalk.cyan("git checkout -b feature/my-change")}   new branch`);
  row(`  ${chalk.cyan("git add -A && git commit -m \"msg\"")}   save snapshot`);
  row(`  ${chalk.cyan("git checkout main && git merge feature/my-change")}`);
  row("");
  row(`  ${chalk.dim("IDE: use the Source Control / Git panel for the same flow.")}`);
  row("");
  console.log(bottom);
  console.log();
}

/**
 * Initializes a local Git repository when possible; prints hints if Git is missing
 * or the directory is already a repo.
 */
export async function runGitInitInDirectory(cwd: string): Promise<{
  ok: boolean;
  reason?: "no-git" | "already-repo" | "failed";
}> {
  const available = await checkGitAvailable(cwd);
  if (!available) {
    gitInstallHint();
    return { ok: false, reason: "no-git" };
  }

  if (await isInsideGitWorkTree(cwd)) {
    console.log(chalk.green("✓") + " Git repository already present in this tree.");
    await ensureBaselineGitignore(cwd);
    printGitLocalGuide();
    return { ok: true, reason: "already-repo" };
  }

  const code = await runGit(cwd, ["init"], { stdio: "inherit" });
  if (code !== 0) {
    console.error(chalk.red("Error: git init failed."));
    return { ok: false, reason: "failed" };
  }

  console.log(chalk.green("✓") + " Local Git repository initialized.");
  await ensureBaselineGitignore(cwd);
  printGitLocalGuide();
  return { ok: true };
}
