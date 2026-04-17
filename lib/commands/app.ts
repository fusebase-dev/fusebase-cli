import { Command } from "commander";
import { access, readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { spawn } from "child_process";
import chalk from "chalk";
import { createHash } from "crypto";
import { getConfig, loadFuseConfig } from "../config";
import { copyAgentsAndSkills } from "../copy-template";
import { isInsideGitWorkTree } from "../git-local";
import {
  createEnvFile,
  printCreateEnvResult,
  readEnvFileMap,
} from "./steps/create-env";
import { runPreUpdateCommit } from "./steps/pre-update-commit";
import { printIdeSetupResults, setupIdeConfig, type IdePreset } from "./steps/ide-setup";
import { syncManagedDependencies } from "./steps/update-managed-deps";
import {
  DASHBOARDS_MCP_POLICY_FP_KEY,
  GATE_MCP_POLICY_FP_KEY,
  getExpectedMcpPolicyFingerprints,
  matchesCurrentOrLegacyFallback,
} from "../mcp-token-policy";

const FUSE_JSON = "fusebase.json";
const ALL_IDE_PRESETS: IdePreset[] = [
  "claude-code",
  "cursor",
  "vscode",
  "opencode",
  "codex",
  "other",
];

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function collectFilesRecursively(root: string): Promise<string[]> {
  if (!(await fileExists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFilesRecursively(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

async function computeAgentAssetsDigest(cwd: string): Promise<string> {
  const targets = [
    join(cwd, "AGENTS.md"),
    join(cwd, ".claude", "settings.json"),
    join(cwd, ".claude", "skills"),
    join(cwd, ".claude", "agents"),
    join(cwd, ".claude", "hooks"),
  ];

  const hash = createHash("sha256");
  for (const target of targets) {
    const exists = await fileExists(target);
    hash.update(target.replace(cwd, "") + "|" + (exists ? "1" : "0"));
    if (!exists) continue;
    const s = await stat(target);
    if (s.isFile()) {
      const content = await readFile(target);
      hash.update(content);
      continue;
    }
    const files = (await collectFilesRecursively(target)).sort((a, b) =>
      a.localeCompare(b),
    );
    for (const file of files) {
      hash.update(file.replace(cwd, ""));
      hash.update(await readFile(file));
    }
  }
  return hash.digest("hex");
}

function runNpmInstall(cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["install"], {
      cwd,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function printUpdateSummary(summary: {
  preUpdateCommit: string;
  agentAssets: string;
  mcpDashboards: string;
  mcpGate: string;
  mcpIde: string;
  managedDeps: string;
  installs: string;
}, installTargets: string[]): void {
  const rows: Array<{ key: string; value: string; renderedValue: string }> = [
    {
      key: "pre-update commit",
      value: summary.preUpdateCommit,
      renderedValue: summary.preUpdateCommit.startsWith("created")
        ? chalk.green.bold(summary.preUpdateCommit)
        : summary.preUpdateCommit,
    },
    {
      key: "agent assets (skills)",
      value: summary.agentAssets,
      renderedValue: summary.agentAssets === "updated"
        ? chalk.green.bold(summary.agentAssets)
        : summary.agentAssets,
    },
    {
      key: "mcp dashboards",
      value: summary.mcpDashboards,
      renderedValue: summary.mcpDashboards.includes("updated")
        ? chalk.green.bold(summary.mcpDashboards)
        : summary.mcpDashboards,
    },
    {
      key: "mcp gate",
      value: summary.mcpGate,
      renderedValue: summary.mcpGate.includes("updated")
        ? chalk.green.bold(summary.mcpGate)
        : summary.mcpGate,
    },
    {
      key: "ide configs",
      value: summary.mcpIde,
      renderedValue: summary.mcpIde === "refreshed"
        ? chalk.green.bold(summary.mcpIde)
        : summary.mcpIde,
    },
    {
      key: "managed deps",
      value: summary.managedDeps,
      renderedValue: summary.managedDeps.includes("updated")
        ? chalk.green.bold(summary.managedDeps)
        : summary.managedDeps,
    },
    {
      key: "npm install",
      value: summary.installs,
      renderedValue: summary.installs.startsWith("completed")
        ? chalk.green.bold(summary.installs)
        : summary.installs,
    },
    ...(installTargets.length > 0
      ? [
          {
            key: "install targets",
            value: installTargets.map((t) => (t === "." ? "root" : t)).join(", "),
            renderedValue: chalk.cyan(
              installTargets.map((t) => (t === "." ? "root" : t)).join(", "),
            ),
          },
        ]
      : []),
  ];

  const keyWidth = Math.max(...rows.map((r) => r.key.length));
  const textRows = rows.map((r) => ({
    raw: `${r.key.padEnd(keyWidth)} ${r.value}`,
    rendered: `${r.key.padEnd(keyWidth)} ${r.renderedValue}`,
  }));

  const titleRaw = " Update summary ";
  const title = chalk.cyan.bold(titleRaw);
  const width = Math.max(titleRaw.length, ...textRows.map((r) => r.raw.length)) + 2;
  const top = `┌${title}${"─".repeat(Math.max(0, width - titleRaw.length))}┐`;
  const sep = `├${"─".repeat(width)}┤`;
  const bottom = `└${"─".repeat(width)}┘`;
  const line = (raw: string, rendered: string) =>
    `│ ${rendered}${" ".repeat(width - raw.length - 1)}│`;

  console.log(top);
  console.log(sep);
  for (const row of textRows) {
    console.log(line(row.raw, row.rendered));
  }
  console.log(bottom);
}

export const appCommand = new Command("app").description("App project maintenance");

export interface AppUpdateOptions {
  skills?: boolean;
  noSkills?: boolean;
  mcp?: boolean;
  noMcp?: boolean;
  forceMcp?: boolean;
  deps?: boolean;
  noDeps?: boolean;
  install?: boolean;
  noInstall?: boolean;
  commit?: boolean;
  noCommit?: boolean;
  dryRun?: boolean;
}

export async function runAppUpdate(opts: AppUpdateOptions): Promise<void> {
  const cwd = process.cwd();
  const dryRun = opts.dryRun === true;
  const doSkills = opts.noSkills !== true;
  const doMcp = opts.noMcp !== true;
  const forceMcp = opts.forceMcp === true;
  const doDeps = opts.noDeps !== true;
  const doInstall = opts.noInstall !== true && doDeps;
  const isTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  let doCommit = isTty;
  if (opts.noCommit === true) doCommit = false;
  if (opts.commit === true) doCommit = true;
  const summary: {
    preUpdateCommit: string;
    agentAssets: string;
    mcpDashboards: string;
    mcpGate: string;
    mcpIde: string;
    managedDeps: string;
    installs: string;
  } = {
    preUpdateCommit: doCommit ? "requested" : "skipped",
    agentAssets: doSkills ? "pending" : "skipped",
    mcpDashboards: doMcp ? "pending" : "skipped",
    mcpGate: doMcp ? "pending" : "skipped",
    mcpIde: doMcp ? "pending" : "skipped",
    managedDeps: doDeps ? "pending" : "skipped",
    installs: doInstall ? "pending" : "skipped",
  };

      const fuseConfig = loadFuseConfig();
      if (!fuseConfig?.orgId || !fuseConfig?.appId) {
        console.error("Error: fusebase.json must include orgId and appId.");
        process.exit(1);
      }

      const insideGit = await isInsideGitWorkTree(cwd);
      if (!insideGit) {
        console.log("");
        console.warn(
          "⚠ No Git repository in this directory. Without a commit, recovering from a failed or partial update may be harder.",
        );
        console.log("");
      }

      const pre = await runPreUpdateCommit({ cwd, commitEnabled: doCommit, dryRun });
      if (!pre.ok) {
        process.exit(1);
      }
      if (pre.skipped) {
        summary.preUpdateCommit = `skipped (${pre.reason ?? "n/a"})`;
      } else if (pre.sha) {
        summary.preUpdateCommit = pre.pushed
          ? `created + pushed (${pre.sha.slice(0, 7)})`
          : `created (${pre.sha.slice(0, 7)})`;
      } else {
        summary.preUpdateCommit = "created";
      }

      if (doSkills) {
        if (dryRun) {
          console.log("[dry-run] Would refresh AGENTS.md and .claude assets (skills update).");
          summary.agentAssets = "dry-run (would refresh)";
        } else {
          try {
            const beforeDigest = await computeAgentAssetsDigest(cwd);
            await copyAgentsAndSkills(cwd);
            const afterDigest = await computeAgentAssetsDigest(cwd);
            console.log(
              "✓ Updated AGENTS.md, .claude/skills, .claude/agents, .claude/hooks and .claude/settings.json",
            );
            summary.agentAssets = beforeDigest === afterDigest ? "no changes" : "updated";
          } catch (e) {
            console.error("Error: skills refresh failed:", e);
            process.exit(1);
          }
        }
      } else {
        console.log("(skipped) Agent assets refresh");
        summary.agentAssets = "skipped";
      }

      if (doMcp) {
        const envMap = await readEnvFileMap(cwd);
        const expected = getExpectedMcpPolicyFingerprints();
        const storedDashFp = envMap.get(DASHBOARDS_MCP_POLICY_FP_KEY)?.trim() ?? "";
        const storedGateFp = envMap.get(GATE_MCP_POLICY_FP_KEY)?.trim() ?? "";
        const hasDashToken =
          (envMap.get("DASHBOARDS_MCP_TOKEN")?.trim() ?? "") !== "";
        const hasGateToken = (envMap.get("GATE_MCP_TOKEN")?.trim() ?? "") !== "";
        const legacyAllOk = matchesCurrentOrLegacyFallback({
          dashboards: envMap.get(DASHBOARDS_MCP_POLICY_FP_KEY),
          gate: envMap.get(GATE_MCP_POLICY_FP_KEY),
        });
        const dashboardsNeedsRefresh =
          forceMcp ||
          !hasDashToken ||
          (!legacyAllOk && storedDashFp !== expected.dashboards);
        const gateNeedsRefresh =
          forceMcp ||
          !hasGateToken ||
          (!legacyAllOk && storedGateFp !== expected.gate);
        const runRefresh = dashboardsNeedsRefresh || gateNeedsRefresh;

        if (!runRefresh) {
          console.log(
            "(skipped) MCP tokens and IDE configs (.env DASHBOARDS_MCP_POLICY_FP / GATE_MCP_POLICY_FP match CLI)",
          );
          summary.mcpDashboards = "skipped (policy up to date)";
          summary.mcpGate = "skipped (policy up to date)";
          summary.mcpIde = "skipped (policy up to date)";
        } else if (dryRun) {
          console.log(
            `[dry-run] Would refresh MCP: dashboards=${dashboardsNeedsRefresh ? "yes" : "no"}, gate=${gateNeedsRefresh ? "yes" : "no"}, and refresh IDE MCP configs.`,
          );
          summary.mcpDashboards = dashboardsNeedsRefresh
            ? "dry-run (would update .env token)"
            : "skipped (policy up to date)";
          summary.mcpGate = gateNeedsRefresh
            ? "dry-run (would update .env token)"
            : "skipped (policy up to date)";
          summary.mcpIde = "dry-run (would refresh)";
        } else {
          const config = getConfig();
          if (!config.apiKey) {
            console.error("Error: No API key configured. Run 'fusebase auth' first (MCP stage).");
            process.exit(1);
          }

          const envResult = await createEnvFile({
            targetDir: cwd,
            apiKey: config.apiKey,
            orgId: fuseConfig.orgId,
            appId: fuseConfig.appId,
            force: true,
            refreshDashboardsToken: dashboardsNeedsRefresh,
            refreshGateToken: gateNeedsRefresh,
          });
          printCreateEnvResult(envResult);
          if (envResult.error) {
            process.exit(1);
          }

          const presets = new Set<IdePreset>(ALL_IDE_PRESETS);
          const ideResult = await setupIdeConfig({
            targetDir: cwd,
            presets,
            force: true,
          });
          printIdeSetupResults(ideResult, presets);
          summary.mcpDashboards = dashboardsNeedsRefresh
            ? "updated in .env and MCP config"
            : "skipped (policy up to date)";
          summary.mcpGate = gateNeedsRefresh
            ? "updated in .env and MCP config"
            : "skipped (policy up to date)";
          summary.mcpIde = "refreshed";
        }
      } else {
        console.log("(skipped) MCP token and IDE refresh");
        summary.mcpDashboards = "skipped";
        summary.mcpGate = "skipped";
        summary.mcpIde = "skipped";
      }

      let installRoots: string[] = [];
      if (doDeps) {
        const { changedPackageRoots } = await syncManagedDependencies({
          cwd,
          fuseConfig,
          dryRun,
        });
        installRoots = [...new Set(changedPackageRoots)];
        if (installRoots.length === 0) {
          console.log("(no changes) Managed SDK dependency versions already match template");
          summary.managedDeps = "no changes";
        } else {
          summary.managedDeps = `${installRoots.length} package.json updated`;
        }
      } else {
        console.log("(skipped) Managed dependency sync");
        summary.managedDeps = "skipped";
      }

      if (doInstall && installRoots.length > 0) {
        if (dryRun) {
          for (const r of installRoots) {
            console.log(`[dry-run] Would run npm install in ${r === "." ? cwd : join(cwd, r)}`);
          }
          summary.installs = `dry-run (${installRoots.length} directories)`;
        } else {
          let failed = false;
          let okCount = 0;
          for (const r of installRoots) {
            const dir = r === "." ? cwd : join(cwd, r);
            console.log(`Running npm install in ${dir} ...`);
            const code = await runNpmInstall(dir);
            if (code !== 0) {
              console.error(`Error: npm install failed in ${dir} (exit ${code})`);
              failed = true;
            } else {
              console.log(`✓ npm install completed in ${dir}`);
              okCount++;
            }
          }
          summary.installs = failed
            ? `completed with errors (${okCount}/${installRoots.length} succeeded)`
            : `completed (${okCount} directories)`;
          if (failed) {
            process.exit(1);
          }
        }
      } else if (doDeps && !doInstall) {
        console.log("(skipped) npm install (--no-install)");
        summary.installs = "skipped (--no-install)";
      } else if (doInstall && installRoots.length === 0) {
        summary.installs = "skipped (no dependency changes)";
      }

  console.log("");
  printUpdateSummary(summary, installRoots);
  console.log("");
  console.log("✓ fusebase app update finished");
}

appCommand
  .command("update")
  .description(
    "Refresh agent assets, MCP tokens/IDE configs, and managed @fusebase SDK versions (see README)",
  )
  .option("--no-skills", "Skip AGENTS.md and .claude assets refresh")
  .option("--no-mcp", "Skip MCP token and IDE config refresh")
  .option("--force-mcp", "Force MCP token and IDE refresh (ignore version marker)")
  .option("--no-deps", "Skip managed dependency version sync in package.json files")
  .option("--no-install", "Do not run npm install after dependency changes")
  .option("--no-commit", "Skip pre-update Git checkpoint")
  .option("--commit", "Run pre-update Git checkpoint in non-interactive mode (no prompt)")
  .option("--dry-run", "Print planned work without writing files or running installs", false)
  .action(runAppUpdate);
