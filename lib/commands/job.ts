import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import {
  loadFuseConfig,
  invalidateFuseConfigCache,
  type BackendJobConfig,
} from "../config";

const FUSE_JSON = "fusebase.json";

const createCommand = new Command("create")
  .description("Add a cron job to a feature's backend in fusebase.json")
  .requiredOption("-f, --feature <featureId>", "Feature ID to add the job to")
  .requiredOption("-n, --name <name>", "Job name (unique within the feature)")
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
      feature: string;
      name: string;
      cron: string;
      command: string;
    }) => {
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

      const features = fuseConfig.features ?? [];
      const featureIndex = features.findIndex((f) => f.id === opts.feature);
      if (featureIndex === -1) {
        console.error(
          `Error: Feature "${opts.feature}" not found in ${FUSE_JSON}. Available features: ${features.map((f) => f.id).join(", ") || "(none)"}`,
        );
        process.exit(1);
      }

      const feature = features[featureIndex]!;

      if (!feature.backend) {
        console.error(
          `Error: Feature "${opts.feature}" does not have a backend configured. ` +
            `Add a "backend" block to this feature in ${FUSE_JSON} first.`,
        );
        process.exit(1);
      }

      const jobs: BackendJobConfig[] = feature.backend.jobs ?? [];
      const existingIndex = jobs.findIndex((j) => j.name === opts.name);
      if (existingIndex !== -1) {
        console.error(
          `Error: A job named "${opts.name}" already exists for feature "${opts.feature}". ` +
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
        `✓ Added cron job "${opts.name}" to feature "${opts.feature}" in ${FUSE_JSON}`,
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
  .description("Remove a cron job from a feature's backend in fusebase.json")
  .requiredOption(
    "-f, --feature <featureId>",
    "Feature ID to remove the job from",
  )
  .requiredOption("-n, --name <name>", "Job name to remove")
  .action((opts: { feature: string; name: string }) => {
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

    const features = fuseConfig.features ?? [];
    const featureIndex = features.findIndex((f) => f.id === opts.feature);
    if (featureIndex === -1) {
      console.error(
        `Error: Feature "${opts.feature}" not found in ${FUSE_JSON}. Available features: ${features.map((f) => f.id).join(", ") || "(none)"}`,
      );
      process.exit(1);
    }

    const feature = features[featureIndex]!;
    const jobs: BackendJobConfig[] = feature.backend?.jobs ?? [];
    const jobIndex = jobs.findIndex((j) => j.name === opts.name);
    if (jobIndex === -1) {
      console.error(
        `Error: No job named "${opts.name}" found for feature "${opts.feature}".`,
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
      `✓ Removed cron job "${opts.name}" from feature "${opts.feature}" in ${FUSE_JSON}`,
    );
    console.log(
      `  The job will be deleted from cloud infrastructure on the next fusebase deploy.`,
    );
  });

export const jobCommand = new Command("job")
  .description("Manage cron jobs for a feature backend")
  .addCommand(createCommand)
  .addCommand(deleteCommand);
