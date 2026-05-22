import { Command, Option } from "commander";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import {
  loadFuseConfig,
  invalidateFuseConfigCache,
  type BackendJobConfig,
} from "../config";

const FUSE_JSON = "fusebase.json";

function resolveAppId(opts: { app?: string; feature?: string }): string {
  const appId = opts.app ?? opts.feature;
  if (!appId) {
    console.error("Error: --app is required.");
    process.exit(1);
  }
  if (opts.feature && !opts.app) {
    console.warn("[deprecated] --feature is deprecated; use --app instead.");
  }
  return appId;
}

const createCommand = new Command("create")
  .description("Add a cron job to an app's backend in fusebase.json")
  .option("-a, --app <appId>", "App ID to add the job to")
  .addOption(
    new Option("-f, --feature <featureId>", "Deprecated alias for --app")
      .hideHelp(),
  )
  .requiredOption("-n, --name <name>", "Job name (unique within the app)")
  .requiredOption(
    "-c, --cron <expression>",
    'Cron expression (5 fields, e.g. "0 * * * *")',
  )
  .requiredOption(
    "--command <command>",
    'Command to run (e.g. "npm run cron:send-reports")',
  )
  .action(
    (opts: {
      app?: string;
      feature?: string;
      name: string;
      cron: string;
      command: string;
    }) => {
      const appId = resolveAppId(opts);
      const fuseJsonPath = join(process.cwd(), FUSE_JSON);

      if (!existsSync(fuseJsonPath)) {
        console.error(`Error: ${FUSE_JSON} not found in current directory.`);
        process.exit(1);
      }

      const fuseConfig = loadFuseConfig();
      if (!fuseConfig) {
        console.error(`Error: Failed to parse ${FUSE_JSON}.`);
        process.exit(1);
      }

      const features = fuseConfig.apps ?? [];
      const featureIndex = features.findIndex((f) => f.id === appId);
      if (featureIndex === -1) {
        console.error(
          `Error: App "${appId}" not found in ${FUSE_JSON}. Available apps: ${features.map((f) => f.id).join(", ") || "(none)"}`,
        );
        process.exit(1);
      }

      const feature = features[featureIndex]!;

      if (!feature.backend) {
        console.error(
          `Error: App "${appId}" does not have a backend configured. ` +
            `Add a "backend" block to this app in ${FUSE_JSON} first.`,
        );
        process.exit(1);
      }

      const jobs: BackendJobConfig[] = feature.backend.jobs ?? [];
      const existingIndex = jobs.findIndex((j) => j.name === opts.name);
      if (existingIndex !== -1) {
        console.error(
          `Error: A job named "${opts.name}" already exists for app "${appId}". ` +
            `Use a different name or remove the existing job from ${FUSE_JSON} first.`,
        );
        process.exit(1);
      }

      const newJob: BackendJobConfig = {
        name: opts.name,
        type: "cron",
        cron: opts.cron,
        command: opts.command,
      };

      feature.backend.jobs = [...jobs, newJob];

      // Write back, preserving formatting
      const raw = readFileSync(fuseJsonPath, "utf-8");
      const indent = detectIndent(raw);
      writeFileSync(
        fuseJsonPath,
        JSON.stringify(fuseConfig, null, indent) + "\n",
        "utf-8",
      );
      invalidateFuseConfigCache();

      console.log(
        `✓ Added cron job "${opts.name}" to app "${appId}" in ${FUSE_JSON}`,
      );
      console.log(`  Type:    cron`);
      console.log(`  Cron:    ${opts.cron}`);
      console.log(`  Command: ${opts.command}`);
    },
  );

function detectIndent(src: string): number {
  const match = src.match(/^[\t ]*"[^"]+"\s*:/m);
  if (!match) return 2;
  const leading = match[0].match(/^( +)/);
  return leading?.[1]?.length ?? 2;
}

const deleteCommand = new Command("delete")
  .description("Remove a cron job from an app's backend in fusebase.json")
  .option("-a, --app <appId>", "App ID to remove the job from")
  .addOption(
    new Option("-f, --feature <featureId>", "Deprecated alias for --app")
      .hideHelp(),
  )
  .requiredOption("-n, --name <name>", "Job name to remove")
  .action((opts: { app?: string; feature?: string; name: string }) => {
    const appId = resolveAppId(opts);
    const fuseJsonPath = join(process.cwd(), FUSE_JSON);

    if (!existsSync(fuseJsonPath)) {
      console.error(`Error: ${FUSE_JSON} not found in current directory.`);
      process.exit(1);
    }

    const fuseConfig = loadFuseConfig();
    if (!fuseConfig) {
      console.error(`Error: Failed to parse ${FUSE_JSON}.`);
      process.exit(1);
    }

    const features = fuseConfig.apps ?? [];
    const featureIndex = features.findIndex((f) => f.id === appId);
    if (featureIndex === -1) {
      console.error(
        `Error: App "${appId}" not found in ${FUSE_JSON}. Available apps: ${features.map((f) => f.id).join(", ") || "(none)"}`,
      );
      process.exit(1);
    }

    const feature = features[featureIndex]!;
    const jobs: BackendJobConfig[] = feature.backend?.jobs ?? [];
    const jobIndex = jobs.findIndex((j) => j.name === opts.name);
    if (jobIndex === -1) {
      console.error(
        `Error: No job named "${opts.name}" found for app "${appId}".`,
      );
      process.exit(1);
    }

    feature.backend!.jobs = jobs.filter((j) => j.name !== opts.name);
    if (feature.backend!.jobs.length === 0) {
      delete feature.backend!.jobs;
    }

    const raw = readFileSync(fuseJsonPath, "utf-8");
    const indent = detectIndent(raw);
    writeFileSync(
      fuseJsonPath,
      JSON.stringify(fuseConfig, null, indent) + "\n",
      "utf-8",
    );
    invalidateFuseConfigCache();

    console.log(
      `✓ Removed cron job "${opts.name}" from app "${appId}" in ${FUSE_JSON}`,
    );
    console.log(
      `  The job will be deleted from cloud infrastructure on the next fusebase deploy.`,
    );
  });

export const jobCommand = new Command("job")
  .description("Manage cron jobs for an app backend")
  .addCommand(createCommand)
  .addCommand(deleteCommand);
