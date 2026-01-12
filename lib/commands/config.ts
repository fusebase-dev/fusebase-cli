import { Command } from "commander";
import { getConfig, setConfig, getFlags, addFlag, removeFlag, KNOWN_FLAGS } from "../config";
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
    console.log(`  Run 'fusebase skills update' to regenerate project files.`);
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
    console.log(`  Run 'fusebase skills update' to regenerate project files.`);
  });

const listFlagsCommand = new Command("flags")
  .description("List active experimental flags")
  .action(() => {
    const flags = getFlags();
    if (flags.length === 0) {
      console.log("No active flags.");
    } else {
      console.log(`Active flags: ${flags.join(", ")}`);
    }
    console.log(`Known flags: ${KNOWN_FLAGS.join(", ")}`);
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

export const configCommand = new Command("config")
  .description("Manage CLI configuration")
  .addCommand(updateChannelCommand)
  .addCommand(setFlagCommand)
  .addCommand(removeFlagCommand)
  .addCommand(listFlagsCommand)
  .addCommand(ideCommand);
