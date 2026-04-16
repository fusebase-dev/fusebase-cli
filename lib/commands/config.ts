import { Command } from "commander";
import {
  getConfig,
  setConfig,
  getFlags,
  addFlag,
  removeFlag,
  KNOWN_FLAGS,
  KNOWN_FLAG_DESCRIPTIONS,
  ALWAYS_ON_FLAGS,
} from "../config";
import { checkbox, input, password } from "@inquirer/prompts";
import chalk from "chalk";
import {
  resolveIdePresets,
  setupIdeConfig,
  printIdeSetupResults,
  type IdePreset,
} from "./steps/ide-setup";

const updateChannelCommand = new Command("update-channel")
  .description("Get or set the update channel")
  .argument("[channel]", "Channel to switch to: prod or dev")
  .action((channel?: string) => {
    if (!channel) {
      const current = getConfig().updateChannel ?? "prod";
      console.log(`Current update channel: ${current}`);
      return;
    }
    if (channel !== "prod" && channel !== "dev") {
      console.error(`Error: unknown channel "${channel}". Valid values: prod, dev`);
      process.exit(1);
    }
    setConfig({ updateChannel: channel });
    console.log(`Update channel set to: ${channel}`);
  });

const setFlagCommand = new Command("set-flag")
  .description("Enable an experimental flag")
  .argument("<flag>", `Flag to enable (known flags: ${KNOWN_FLAGS.join(", ")})`)
  .action((flag: string) => {
    if (!(KNOWN_FLAGS as readonly string[]).includes(flag)) {
      console.warn(`⚠️  Warning: "${flag}" is not a known flag. Known flags: ${KNOWN_FLAGS.join(", ")}`);
    }
    addFlag(flag);
    console.log(`✓ Flag "${flag}" enabled`);
    console.log(`  Active flags: ${getFlags().join(", ") || "(none)"}`);
    console.log("");
    console.log("\x1b[1mRun 'fusebase skills update' to regenerate project files.\x1b[0m");
  });

const removeFlagCommand = new Command("remove-flag")
  .description("Disable an experimental flag")
  .argument("<flag>", "Flag to disable")
  .action((flag: string) => {
    const flags = getFlags();
    if (!flags.includes(flag)) {
      console.log(`Flag "${flag}" is not currently enabled.`);
      console.log(`  Active flags: ${flags.join(", ") || "(none)"}`);
      return;
    }
    removeFlag(flag);
    console.log(`✓ Flag "${flag}" disabled`);
    console.log(`  Active flags: ${getFlags().join(", ") || "(none)"}`);
    console.log("");
    console.log("\x1b[1mRun 'fusebase skills update' to regenerate project files.\x1b[0m");
  });

function printFlagsSummary(flags: string[]): void {
  const knownFlags = [...KNOWN_FLAGS];
  const alwaysOn = ALWAYS_ON_FLAGS.filter((f) => (knownFlags as string[]).includes(f));
  const notActiveFlags = knownFlags.filter(
    (flag) => !flags.includes(flag) && !(ALWAYS_ON_FLAGS as readonly string[]).includes(flag),
  );

  console.log(`Known flags: ${knownFlags.join(", ")}`);
  if (alwaysOn.length > 0) {
    console.log(`Always on:   ${alwaysOn.join(", ")}`);
  }
  console.log("");
  console.log(`Not active flags: ${notActiveFlags.join(", ") || "(none)"}`);
  console.log("");
  console.log(`Active flags: ${flags.join(", ") || "(none)"}`);
}

async function runInteractiveFlagsSelection(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log("Interactive mode requires a TTY. Falling back to list output.");
    printFlagsSummary(getFlags());
    return;
  }

  const currentFlags = getFlags();
  const knownFlags = KNOWN_FLAGS as readonly string[];
  const unknownActiveFlags = currentFlags.filter((flag) => !knownFlags.includes(flag));

  try {
    const selectedFlags = await checkbox<string>({
      message: "Select experimental flags to enable",
      choices: knownFlags.map((flag) => {
        const isAlwaysOn = (ALWAYS_ON_FLAGS as readonly string[]).includes(flag);
        return {
          name: isAlwaysOn
            ? `${chalk.bold(flag)} ${chalk.dim(`- ${KNOWN_FLAG_DESCRIPTIONS[flag as keyof typeof KNOWN_FLAG_DESCRIPTIONS]}`)} ${chalk.green("(always on)")}`
            : `${chalk.bold(flag)} ${chalk.dim(`- ${KNOWN_FLAG_DESCRIPTIONS[flag as keyof typeof KNOWN_FLAG_DESCRIPTIONS]}`)}`,
          value: flag,
          checked: currentFlags.includes(flag) || isAlwaysOn,
          disabled: isAlwaysOn ? "always on" : false,
        };
      }),
    });

    const nextFlags = [...selectedFlags, ...unknownActiveFlags];
    setConfig({ flags: nextFlags.length > 0 ? nextFlags : undefined });

    console.log("✓ Updated active flags");
    printFlagsSummary(getFlags());
    if (unknownActiveFlags.length > 0) {
      console.log(
        `  Preserved unknown active flags: ${unknownActiveFlags.join(", ")}`,
      );
    }
    console.log("");
    console.log("\x1b[1mRun 'fusebase skills update' to regenerate project files.\x1b[0m");
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "ExitPromptError" || name === "AbortPromptError") {
      console.log("Flag selection cancelled.");
      return;
    }
    throw error;
  }
}

const listFlagsCommand = new Command("flags")
  .description("Manage experimental flags (interactive in TTY)")
  .option("--list", "Show flags without interactive prompt")
  .option("-i, --interactive", "Force interactive selection prompt")
  .action(async (options: { list?: boolean; interactive?: boolean }) => {
    const shouldUseInteractive =
      !options.list && (options.interactive || (process.stdin.isTTY && process.stdout.isTTY));

    if (shouldUseInteractive) {
      await runInteractiveFlagsSelection();
      return;
    }

    printFlagsSummary(getFlags());
  });

const VALID_IDE_PRESETS: IdePreset[] = ["claude-code", "cursor", "vscode", "opencode", "codex", "other"];

const ideCommand = new Command("ide")
  .description("Recreate IDE config")
  .option(
    "--ide <preset>",
    `IDE preset: ${VALID_IDE_PRESETS.join(", ")}`
  )
  .option("--force", "Overwrite existing MCP config files")
  .action(async (options: { ide?: string; force?: boolean }) => {
    const cwd = process.cwd();
    const ALL_IDE_PRESETS: IdePreset[] = ["claude-code", "cursor", "vscode", "opencode", "codex", "other"];
    const presets = options.ide ? resolveIdePresets(options.ide) : new Set<IdePreset>(ALL_IDE_PRESETS);
    if (presets.size === 0) {
      console.log("No IDE preset selected. Run with --ide <preset>.");
      return;
    }
    const result = await setupIdeConfig({
      targetDir: cwd,
      presets,
      force: options.force ?? false,
    });
    printIdeSetupResults(result, presets);
  });

function maskToken(value?: string): string {
  const v = String(value ?? "").trim();
  if (!v) return "(not set)";
  if (v.startsWith("glpat-")) {
    const suffix = v.slice(-4);
    return `glpat-***${suffix}`;
  }
  if (v.length <= 8) return "*".repeat(v.length);
  return `${v.slice(0, 4)}***${v.slice(-4)}`;
}

function printGitLabConfig(): void {
  const config = getConfig();
  console.log("GitLab configuration:");
  console.log(`  gitlabHost:  ${config.gitlabHost?.trim() || "(not set)"}`);
  console.log(`  gitlabGroup: ${config.gitlabGroup?.trim() || "(not set)"}`);
  console.log(`  gitlabToken: ${maskToken(config.gitlabToken)}`);
}

const gitlabCommand = new Command("gitlab")
  .description("Get or set GitLab sync configuration")
  .option("--host <host>", "GitLab host, e.g. gl.nimbusweb.co")
  .option("--group <group>", "Base GitLab group, e.g. vibecode")
  .option("--token <token>", "GitLab personal access token")
  .option("--show", "Show current GitLab configuration")
  .option("--clear-token", "Remove stored GitLab token")
  .action(async (options: {
    host?: string;
    group?: string;
    token?: string;
    show?: boolean;
    clearToken?: boolean;
  }) => {
    const hasCliUpdates =
      Boolean(options.host) ||
      Boolean(options.group) ||
      Boolean(options.token) ||
      options.clearToken === true;

    if (options.show || (!hasCliUpdates && !process.stdin.isTTY)) {
      printGitLabConfig();
      return;
    }

    const current = getConfig();
    let host = options.host?.trim() ?? current.gitlabHost?.trim() ?? "";
    let group = options.group?.trim() ?? current.gitlabGroup?.trim() ?? "";
    let token = options.token?.trim() ?? current.gitlabToken?.trim() ?? "";

    if (!hasCliUpdates && process.stdin.isTTY && process.stdout.isTTY) {
      host = String(
        await input({
          message: "GitLab host",
          default: host || "gitlab.example.com",
          validate: (v) => (String(v ?? "").trim() ? true : "Host is required"),
        }),
      ).trim();
      group = String(
        await input({
          message: "GitLab group",
          default: group,
          validate: (v) => (String(v ?? "").trim() ? true : "Group is required"),
        }),
      ).trim();
      const maskedCurrentToken = maskToken(token);
      const enteredToken = String(
        await password({
          message:
            maskedCurrentToken === "(not set)"
              ? "GitLab token"
              : `GitLab token (leave empty to keep current: ${maskedCurrentToken})`,
          mask: "*",
        }),
      ).trim();
      if (enteredToken) {
        token = enteredToken;
      }
    }

    if (options.clearToken) {
      token = "";
    }

    setConfig({
      gitlabHost: host || undefined,
      gitlabGroup: group || undefined,
      gitlabToken: token || undefined,
    });

    console.log("✓ GitLab configuration updated");
    printGitLabConfig();
  });

export const configCommand = new Command("config")
  .description("Manage CLI configuration")
  .addCommand(updateChannelCommand)
  .addCommand(setFlagCommand)
  .addCommand(removeFlagCommand)
  .addCommand(listFlagsCommand)
  .addCommand(ideCommand)
  .addCommand(gitlabCommand);
