import { Command, Option } from "commander";
import chalk from "chalk";
import {
  readFile,
  writeFile,
  access,
  readdir,
  mkdir,
  cp,
  constants,
} from "fs/promises";
import { join, dirname, basename } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { select, confirm, input } from "@inquirer/prompts";
import { spawn } from "child_process";
import { embeddedFiles } from "bun";
import AdmZip from "adm-zip";
import {
  fetchOrgs,
  fetchApps,
  createApp,
  type Organization,
  type App,
} from "../api";
import { copyAgentsAndSkills } from "../copy-template";
import {
  type IdePreset,
  resolveIdePresets,
  setupIdeConfig,
  printIdeSetupResults,
} from "./steps/ide-setup";
import { createEnvFile, printCreateEnvResult } from "./steps/create-env";
import { checkAuthentication, runAuthFlow } from "./steps/auth-flow";
import {
  getEnv,
  getFusebaseHost,
  getFusebaseAppHost,
  hasFlag,
} from "../config";
import { MCP_SERVERS_CATALOG, type McpServerCatalogEntry } from "../../ide-configs/mcp-servers";
import { isMcpCatalogEntryActive } from "../mcp-catalog";
import {
  isManagedAppInCurrentProject,
  previewGitLabRepoName,
  runGitInitAndSync,
} from "../git-sync";

// @ts-ignore
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_DIR = join(homedir(), ".fusebase");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const FUSE_JSON = "fusebase.json";

interface Config {
  apiKey?: string;
}

interface FuseConfig {
  orgId?: string;
  appId?: string;
  env?: string;
  managed?: boolean;
}

async function loadConfig(): Promise<Config> {
  try {
    const data = await readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(data) as Config;
  } catch {
    return {};
  }
}

function collectPlaceholderKeys(value: unknown): Set<string> {
  const keys = new Set<string>();
  const visit = (v: any) => {
    if (typeof v === "string") {
      const matches = v.match(/\{\{([A-Z0-9_]+)\}\}/g);
      if (matches) {
        for (const m of matches) {
          const keyMatch = m.match(/\{\{([A-Z0-9_]+)\}\}/);
          const k = keyMatch?.[1];
          if (k) keys.add(k);
        }
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (v && typeof v === "object") {
      for (const x of Object.values(v)) visit(x);
    }
  };
  visit(value);
  return keys;
}

function parseEnvKeys(content: string): Set<string> {
  const keys = new Set<string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * Ensures `.env` contains env keys required by active `required: true` MCP servers
 * (flag gate first — inactive catalog entries are skipped).
 * If missing and TTY, prompts the user and appends them to `.env`.
 */
async function ensureRequiredMcpEnvKeys(options: { targetDir: string }): Promise<void> {
  const { targetDir } = options;
  const envPath = join(targetDir, ".env");

  let envContent = "";
  try {
    envContent = await readFile(envPath, "utf-8");
  } catch {
    envContent = "";
  }

  const requiredEnvKeys = new Set<string>();
  for (const entry of Object.values(MCP_SERVERS_CATALOG)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as McpServerCatalogEntry;
    if (!isMcpCatalogEntryActive(e, hasFlag)) continue;
    if (e.required !== true) continue;
    const { required: _required, flag: _flag, ...spec } = e;
    for (const k of collectPlaceholderKeys(spec)) requiredEnvKeys.add(k);
  }

  if (requiredEnvKeys.size === 0) return;

  const presentKeys = parseEnvKeys(envContent);
  const missing = Array.from(requiredEnvKeys).filter((k) => !presentKeys.has(k));
  if (missing.length === 0) return;

  if (!process.stdin.isTTY) {
    throw new Error(
      `Missing required MCP env vars in .env: ${missing.join(", ")}. Please provide them before running init.`,
    );
  }

  const updates: string[] = [];
  for (const key of missing) {
    const value = await input({
      message: `Enter value for ${key} (required MCP integration)`,
      validate: (v) => {
        if (!String(v ?? "").trim()) return `${key} is required`;
        return true;
      },
    });
    updates.push(`${key}=${String(value).trim()}`);
  }

  const suffix = envContent.trimEnd().length > 0 ? "\n" : "";
  const final = envContent + suffix + updates.join("\n") + "\n";
  await writeFile(envPath, final, "utf-8");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectoryEmpty(path: string): Promise<boolean> {
  try {
    const files = await readdir(path);
    // Ignore hidden files like .git, .DS_Store
    const visibleFiles = files.filter((f) => !f.startsWith("."));
    return visibleFiles.length === 0;
  } catch {
    return true;
  }
}

/** Read AGENTS.managed.md from managed-template/ (embedded in binary or from repo root). Not in project-template so it is not copied to users who init without --managed. */
async function getManagedAgentsContent(): Promise<string | null> {
  const embedded = embeddedFiles.find((f) =>
    (f as { name?: string }).name?.includes("AGENTS.managed"),
  );
  if (embedded) {
    const buf = await (
      embedded as { arrayBuffer(): Promise<ArrayBuffer> }
    ).arrayBuffer();
    return Buffer.from(buf).toString("utf-8");
  }
  const devPath = join(
    __dirname,
    "..",
    "..",
    "managed-template",
    "AGENTS.managed.md",
  );
  if (await fileExists(devPath)) {
    return readFile(devPath, "utf-8");
  }
  return null;
}

async function warnIfProductionNodeEnv(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    console.log();
    console.log(
      chalk.red('⚠️  NODE_ENV is set to "production". This may cause issues during'),
    );
    console.log(
      chalk.red("   initialization (e.g. devDependencies not being installed)."),
    );
    console.log();
    console.log("   To fix, remove NODE_ENV=production from your environment:");
    console.log();
    if (process.platform === "win32") {
      console.log("   1. Remove it from System Environment Variables:");
      console.log(
        '      Open Start → search "Environment Variables" → edit/delete NODE_ENV',
      );
      console.log("   2. Then restart your terminal");
    } else {
      console.log(
        "   1. Check your shell config files (~/.zshrc, ~/.bashrc, or ~/.profile)",
      );
      console.log(
        "      and remove any line like: export NODE_ENV=production",
      );
      console.log("   2. Then restart your terminal or run: source ~/.zshrc");
    }
    console.log();

    await select({
      message: "Press Enter to continue",
      choices: [{ name: "Continue", value: true }],
    });
  }
}

const ALL_SET_BOX_INNER_WIDTH = 65;

function stripAnsiForWidth(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Pads to fixed width using visible (ANSI-stripped) length so box borders align. */
function allSetBoxLine(content: string): string {
  const len = stripAnsiForWidth(content).length;
  if (len > ALL_SET_BOX_INNER_WIDTH) {
    return content;
  }
  return content + " ".repeat(ALL_SET_BOX_INNER_WIDTH - len);
}

async function maybeRunGitInitAndSync(options: {
  git?: boolean;
  cwd: string;
  gitTagManaged?: boolean;
  isManagedApp: boolean;
  appSubdomain?: string;
  appTitle?: string;
  explicitRepoName?: string;
}): Promise<void> {
  if (!options.git) return;
  await runGitInitAndSync({
    cwd: options.cwd,
    tagManaged: Boolean(options.gitTagManaged && options.isManagedApp),
    appSubdomain: options.appSubdomain,
    appTitle: options.appTitle,
    explicitRepoName: options.explicitRepoName,
    compactOutput: true,
  });
}

function printAllSetBanner(): void {
  const top = `┌${"─".repeat(ALL_SET_BOX_INNER_WIDTH)}┐`;
  const bottom = `└${"─".repeat(ALL_SET_BOX_INNER_WIDTH)}┘`;
  const row = (content: string) => console.log(`│${allSetBoxLine(content)}│`);

  console.log();
  console.log(top);
  row("");
  row("  🚀 You're all set!");
  row("");
  row("  Open this folder in Your IDE and ask it to create");
  row("  your first feature.");
  row("");
  row("  Guide:");
  row("  https://nimb.ws/kPYHg4y");
  row("");
  row(
    `  Config: ${chalk.bold("Claude Code, Cursor, VS Code, OpenCode, Codex")} — ready.`,
  );
  row("");
  row(
    `  ${chalk.bold.yellow("Important!")} If you are using Antigravity, make sure to`,
  );
  row("  configure MCP first. Here is the guide:");
  row("  https://nimb.ws/u7NbJOF");
  row("");
  row("  Email: contact@thefusebase.com");
  row("");
  console.log(bottom);
}

function sanitizePackageName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-_.]/g, "-")
      .replace(/^[^a-z]+/, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "app"
  );
}

async function copyProjectTemplate(
  targetDir: string,
  appName: string,
  orgId: string,
): Promise<void> {
  const templateDirName = "project-template";

  // Check if we're running from a compiled binary (embeddedFiles will have the template zip).
  // Bun appends a content hash to embedded filenames (e.g. "project-template-c7f917bq.zip"),
  // so we use includes() rather than endsWith() to match.
  const zipFile = embeddedFiles.find(
    (f) =>
      (f as any).name?.includes("project-template") &&
      !(f as any).name?.includes("fullstack"),
  );

  if (zipFile) {
    // Binary mode - extract from embedded zip
    const zipData = await zipFile.arrayBuffer();
    const zip = new AdmZip(Buffer.from(zipData));
    zip.extractAllTo(targetDir, true);
  } else {
    // Development mode - copy from template directory
    const templateDir = join(__dirname, "..", "..", templateDirName);
    await cp(templateDir, targetDir, { recursive: true });
  }

  // Replace placeholders in package.json
  const packageJsonPath = join(targetDir, "package.json");
  if (await fileExists(packageJsonPath)) {
    let packageJson = await readFile(packageJsonPath, "utf-8");
    const sanitizedName = sanitizePackageName(appName);
    packageJson = packageJson.replace(/\{\{APP_NAME\}\}/g, sanitizedName);
    await writeFile(packageJsonPath, packageJson, "utf-8");
  }

  // Create features folder
  const featuresDir = join(targetDir, "features");
  await mkdir(featuresDir, { recursive: true });

  await replaceFusebaseHostPlaceholder(targetDir);
}

/** Replaces placeholders and literal dev/prod host strings. host/appHost are without protocol (for subdomains). */
function applyFusebaseHostReplacements(
  content: string,
  host: string,
  appHost: string,
): string {
  const fullHost = "https://" + host;
  const fullAppHost = "https://" + appHost;
  return (
    content
      .replace(/\{FUSEBASE_HOST\}/g, host)
      .replace(/\{FUSEBASE_APP_HOST\}/g, appHost)
      .replace(/https:\/\/dev-thefusebase\.com/g, fullHost)
      .replace(/https:\/\/thefusebase\.com/g, fullHost)
      .replace(/https:\/\/dev-thefusebase-app\.com/g, fullAppHost)
      .replace(/https:\/\/thefusebase\.app/g, fullAppHost)
      .replace(/dev-thefusebase\.com/g, host)
      // Only replace bare thefusebase.com (not already part of {FUSEBASE_HOST}) to avoid dev-dev-...
      .replace(/(?<!dev-)thefusebase\.com/g, host)
      .replace(/dev-thefusebase-app\.com/g, appHost)
      .replace(/(?<!dev-)thefusebase-app\.com/g, appHost)
      .replace(/dev-thefusebase\.app/g, appHost)
      // Only replace bare thefusebase.app (not already part of dev-thefusebase.app) to avoid dev-dev-...
      .replace(/(?<!dev-)thefusebase\.app/g, appHost)
  );
}

/** Replaces {FUSEBASE_HOST}, {FUSEBASE_APP_HOST} and literal dev/prod URLs/domains in .md and .env under targetDir. */
export async function replaceFusebaseHostPlaceholder(
  targetDir: string,
): Promise<void> {
  const host = getFusebaseHost();
  const appHost = getFusebaseAppHost();
  async function replaceInDir(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      if (entry.isDirectory()) {
        await replaceInDir(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const isMd = entry.name.endsWith(".md");
      const isEnv = entry.name === ".env";
      if (!isMd && !isEnv) continue;
      try {
        const content = await readFile(fullPath, "utf-8");
        const replaced = applyFusebaseHostReplacements(content, host, appHost);
        if (replaced !== content) {
          await writeFile(fullPath, replaced, "utf-8");
        }
      } catch {
        // Skip files we can't read/write
      }
    }
  }
  await replaceInDir(targetDir);
}

async function runNpmInstall(cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log("\nInstalling dependencies...");
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    // --include=dev ensures devDependencies (vite, typescript, eslint, etc.) are installed
    // even when NODE_ENV=production (e.g. when run from VS Code / Claude Code extension host)
    const child = spawn(npmCmd, ["install", "--include=dev"], {
      cwd,
      stdio: "inherit",
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`npm install exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

async function promptSelect<T extends { id: string }>(
  message: string,
  items: T[],
  displayFn: (item: T) => string,
): Promise<T> {
  const result = await select({
    message,
    choices: items.map((item) => ({
      name: displayFn(item),
      value: item,
    })),
  });
  return result;
}

export const initCommand = new Command("init")
  .description("Initialize a Fusebase app in the current directory")
  .option("--name <name>", "App title/name")
  .option("--org <orgId>", "Organization ID (skips org selection)")
  .option(
    "--ide <preset>",
    "IDE preset: claude-code, cursor, vscode, opencode, codex, or other (single choice)",
  )
  .option("--force", "Overwrite existing IDE config files/folders", false)
  .addOption(
    new Option(
      "--managed",
      "Use managed app (aliases + resolveAliases)",
    ).hideHelp(),
  )
  .option(
    "--git",
    "After setup, initialize local Git and sync with configured GitLab remote",
    false,
  )
  .option(
    "--skip-git",
    "Skip local Git initialization and GitLab sync (overrides --git and git-init flag)",
    false,
  )
  .option(
    "--git-tag-managed",
    "When app is managed, add managed tag on the GitLab project during git sync",
    false,
  )
  .action(
    async (options: {
      name?: string;
      org?: string;
      ide?: string;
      force: boolean;
      managed?: boolean;
      git?: boolean;
      skipGit?: boolean;
      gitTagManaged?: boolean;
    }) => {
      await warnIfProductionNodeEnv();

      const cwd = process.cwd();
      const fuseJsonPath = join(cwd, FUSE_JSON);

      // Check if current directory is writable
      try {
        await access(cwd, constants.W_OK);
      } catch {
        console.error(
          "Current directory is not writable. Make sure you created a directory for your application and navigated to it.",
        );
        process.exit(1);
      }

      const shouldSetupGit = !options.skipGit && (options.git || hasFlag("git-init"));

      // Check if fusebase.json already exists
      if (await fileExists(fuseJsonPath)) {
        // Just update AGENTS.md and skills folder, then replace {FUSEBASE_HOST} and {FUSEBASE_APP_HOST}
        try {
          await copyAgentsAndSkills(cwd);
          await replaceFusebaseHostPlaceholder(cwd);
          //agent configs = skills, hooks, AGENTS.md, etc.
          console.log("✓ Updated app agent configs");
          printAllSetBanner();
          await maybeRunGitInitAndSync({
            git: shouldSetupGit,
            cwd,
            gitTagManaged: options.gitTagManaged,
            isManagedApp: options.managed === true || isManagedAppInCurrentProject(),
          });
          process.exit(0);
        } catch (error) {
          console.error("Error: Failed to update agent config:", error);
          process.exit(1);
        }
      }

      // Check authentication - run auth flow if not authenticated
      let apiKey = checkAuthentication();
      if (!apiKey) {
        console.log("Authentication required to continue.");
        try {
          const isDev = getEnv() === "dev";
          apiKey = await runAuthFlow(isDev);
          console.log(); // Empty line for better formatting
        } catch (error) {
          console.error(
            "Error: Authentication failed. Cannot proceed with initialization.",
          );
          process.exit(1);
        }
      }

      // Check if directory is empty and determine if we should proceed with the project initialization
      const dirEmpty = await isDirectoryEmpty(cwd);
      const needToCopyTemplate = dirEmpty;

      if (!dirEmpty) {
        console.log();
        console.log(
          "⚠️  Directory is not empty. We recommend using empty folders for new apps.",
        );
        console.log();
        const shouldContinue = await confirm({
          message: "Would you still like to continue in the current one?",
          default: false,
        });
        if (!shouldContinue) {
          console.log(
            "Initialization of the app has been stopped. Please create an empty folder and try again.",
          );
          return;
        }
      }

      // Determine IDE presets (only relevant when useTemplate is true)
      let idePresets: Set<IdePreset> = new Set<IdePreset>();
      const forceOverwrite = options.force;

      if (needToCopyTemplate) {
        if (options.ide) {
          // Non-interactive: use CLI flag
          idePresets = resolveIdePresets(options.ide);
        } else {
          // Default: set up MCP config for all supported IDEs.
          idePresets = new Set<IdePreset>(["claude-code", "cursor", "vscode", "opencode", "codex", "other"]);
        }
      }

      // Fetch organizations
      let orgs: Organization[];
      try {
        const orgsResponse = await fetchOrgs(apiKey);
        orgs = orgsResponse.organizations;
      } catch (error) {
        console.error("Error: Failed to fetch organizations.");
        process.exit(1);
      }

      if (orgs.length === 0) {
        console.error("Error: No organizations found.");
        process.exit(1);
      }

      // Select organization
      let selectedOrg: Organization;
      if (options.org) {
        // Use provided org ID
        const foundOrg = orgs.find((o) => o.id === options.org);
        if (!foundOrg) {
          console.error(
            `Error: Organization with ID "${options.org}" not found.`,
          );
          process.exit(1);
        }
        selectedOrg = foundOrg;
        console.log(`Using organization: ${selectedOrg.title}`);
      } else if (orgs.length === 1 && orgs[0]) {
        selectedOrg = orgs[0];
        console.log(`Using organization: ${selectedOrg.title}`);
      } else {
        selectedOrg = await promptSelect(
          "Select an organization:",
          orgs,
          (org) => org.title,
        );
      }

      // Always create a new app
      const appTitle =
        options.name ??
        (await input({
          message: "Enter a title for the new app:",
          validate: (value) => {
            if (!value.trim()) return "App title is required";
            return true;
          },
        }));

      let selectedApp: App;
      try {
        selectedApp = await createApp(apiKey, selectedOrg.id, appTitle.trim());
        console.log(`✓ Created app: ${selectedApp.title}`);
      } catch (error) {
        console.error(
          "Error: Failed to create app.",
          error instanceof Error ? error.message : "",
        );
        process.exit(1);
      }

      let explicitRepoName: string | undefined;
      if (shouldSetupGit && process.stdin.isTTY && !options.name) {
        const env = getEnv() === "dev" ? "dev" : "prod";
        const preview = previewGitLabRepoName({
          env,
          appSubdomain: selectedApp.sub,
          appTitle: selectedApp.title,
          fallbackName: basename(cwd),
        });
        explicitRepoName = await input({
          message: "GitLab repository name (you can edit):",
          default: preview,
          validate: (value) => {
            if (!String(value ?? "").trim()) {
              return "Repository name is required";
            }
            return true;
          },
        });
      }

      // Generate app name for package.json from the app title
      const appName = sanitizePackageName(appTitle);

      // Copy project template if needed (before creating fusebase.json)
      if (needToCopyTemplate) {
        try {
          await copyProjectTemplate(
            cwd,
            appName,
            selectedOrg.id,
          );
          console.log("✓ Project template copied");
        } catch (error) {
          console.error("Error: Failed to copy project template:", error);
          process.exit(1);
        }

        // Re-apply flag-gated skill filtering and template rendering.
        // copyProjectTemplate copies everything; copyAgentsAndSkills removes
        // skills that require flags.
        try {
          await copyAgentsAndSkills(cwd);
        } catch (error) {
          console.error("Warning: Failed to apply skill filtering:", error);
        }

        // Create .env first so IDE config copy can substitute token and URL
        try {
          const envResult = await createEnvFile({
            targetDir: cwd,
            apiKey: apiKey,
            orgId: selectedOrg.id,
            appId: selectedApp.id,
            force: forceOverwrite,
          });
          printCreateEnvResult(envResult);
        } catch (error) {
          console.error("Warning: Failed to create .env file:", error);
        }

        // Ensure `.env` contains all required MCP env vars for enabled required servers.
        // Example: `GATE_MCP_URL` / `GATE_MCP_TOKEN` when `fusebase-gate` is required.
        try {
          await ensureRequiredMcpEnvKeys({ targetDir: cwd });
        } catch (error) {
          console.error("Warning: Failed to ensure required MCP env vars:", error);
        }

        // After template copy, ensure scripts/ and IDE assets are properly set up.
        // MCP config files get URL and token substituted from .env.
        try {
          const result = await setupIdeConfig({
            targetDir: cwd,
            presets: idePresets,
            force: forceOverwrite,
          });
          printIdeSetupResults(result, idePresets);
        } catch (error) {
          console.error("Warning: Failed to copy some IDE assets:", error);
        }

        // If --managed: append AGENTS.managed.md content to AGENTS.md (content lives in CLI, not in template)
        if (options.managed) {
          const agentsPath = join(cwd, "AGENTS.md");
          try {
            const managedContent = await getManagedAgentsContent();
            if (managedContent) {
              const agentsContent = await readFile(agentsPath, "utf-8");
              const separator = "\n\n---\n\n";
              await writeFile(
                agentsPath,
                agentsContent + separator + managedContent.trim(),
                "utf-8",
              );
              console.log("✓ AGENTS.md updated with managed app instructions");
            }
          } catch (error) {
            console.error(
              "Warning: Failed to append managed instructions to AGENTS.md:",
              error,
            );
          }
        }
      }

      // Save fusebase.json (env so FUSEBASE_HOST / getEnv() are correct for this project)
      const fuseConfig: FuseConfig = {
        orgId: selectedOrg.id,
        appId: selectedApp.id,
        env: getEnv() ?? "dev",
        ...(options.managed && { managed: true }),
      };

      await writeFile(
        fuseJsonPath,
        JSON.stringify(fuseConfig, null, 2),
        "utf-8",
      );
      console.log("✓ App initialized successfully");
      console.log(`  Organization: ${selectedOrg.title}`);
      console.log(`  App: ${selectedApp.title}`);

      // Run npm install if template was used
      if (needToCopyTemplate) {
        try {
          await runNpmInstall(cwd);
          console.log("✓ Dependencies installed");
        } catch (error) {
          console.error(
            "Warning: Failed to install dependencies. Run 'npm install --include=dev' manually.",
          );
        }
      }

      // Print next steps
      printAllSetBanner();
      await maybeRunGitInitAndSync({
        git: shouldSetupGit,
        cwd,
        gitTagManaged: options.gitTagManaged,
        isManagedApp: options.managed === true || isManagedAppInCurrentProject(),
        appSubdomain: selectedApp.sub,
        appTitle: selectedApp.title,
        explicitRepoName,
      });
    },
  );
