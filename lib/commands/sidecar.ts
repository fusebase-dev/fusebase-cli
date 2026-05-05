import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import {
  loadFuseConfig,
  invalidateFuseConfigCache,
  hasFlag,
  type BackendJobConfig,
  type FeatureConfig,
  type SidecarConfig,
} from "../config";

const FUSE_JSON = "fusebase.json";
const MAX_SIDECARS = 3;
const VALID_TIERS = ["small", "medium", "large"] as const;
const SIDECAR_NAME_REGEX = /^[a-z][a-z0-9-]{0,62}$/;

function detectIndent(src: string): number {
  const match = src.match(/^[\t ]*"[^"]+"\s*:/m);
  if (!match) return 2;
  const leading = match[0].match(/^( +)/);
  return leading?.[1]?.length ?? 2;
}

function parseEnvPairs(envArgs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of envArgs) {
    const eqIndex = arg.indexOf("=");
    if (eqIndex === -1) {
      console.error(
        `Error: Invalid env format "${arg}". Expected KEY=VALUE.`,
      );
      process.exit(1);
    }
    const key = arg.substring(0, eqIndex);
    const value = arg.substring(eqIndex + 1);
    if (!key) {
      console.error(`Error: Empty key in env "${arg}".`);
      process.exit(1);
    }
    result[key] = value;
  }
  return result;
}

type SidecarSecretEntry = NonNullable<SidecarConfig["secrets"]>[number];

function parseSecretEntries(secretArgs: string[]): SidecarSecretEntry[] {
  const result: SidecarSecretEntry[] = [];
  const targetNames = new Set<string>();
  const duplicates: string[] = [];

  for (const arg of secretArgs) {
    const colonIndex = arg.indexOf(":");
    let entry: SidecarSecretEntry;
    let target: string;

    if (colonIndex === -1) {
      if (!arg) {
        console.error(
          `Error: Empty secret. Expected KEY or KEY:ALIAS.`,
        );
        process.exit(1);
      }
      entry = arg;
      target = arg;
    } else {
      const key = arg.substring(0, colonIndex);
      const alias = arg.substring(colonIndex + 1);
      if (!key || !alias) {
        console.error(
          `Error: Invalid secret "${arg}". Both KEY and ALIAS must be non-empty (use KEY or KEY:ALIAS).`,
        );
        process.exit(1);
      }
      entry = { from: key, as: alias };
      target = alias;
    }

    if (targetNames.has(target)) {
      if (!duplicates.includes(target)) duplicates.push(target);
    } else {
      targetNames.add(target);
    }
    result.push(entry);
  }

  if (duplicates.length > 0) {
    console.error(
      `Error: Duplicate secret target name(s): ${duplicates.join(", ")}. ` +
        `Each secret must map to a distinct env var name within the same sidecar.`,
    );
    process.exit(1);
  }

  return result;
}

function ensureJobFlagOrExit(jobName: string | undefined): void {
  if (jobName === undefined) return;
  if (!hasFlag("job-sidecars")) {
    console.error(
      `Error: --job requires the 'job-sidecars' flag. Run: fusebase config set-flag job-sidecars`,
    );
    process.exit(1);
  }
}

function findJobOrExit(
  feature: FeatureConfig,
  featureId: string,
  jobName: string,
): BackendJobConfig {
  const jobs = feature.backend?.jobs ?? [];
  const job = jobs.find((j) => j.name === jobName);
  if (!job) {
    console.error(
      `Error: Job "${jobName}" not found in feature "${featureId}". ` +
        `Available jobs: ${jobs.map((j) => j.name).join(", ") || "(none)"}`,
    );
    process.exit(1);
  }
  return job;
}

const addCommand = new Command("add")
  .description("Add a sidecar container to a feature backend in fusebase.json")
  .requiredOption(
    "-f, --feature <featureId>",
    "Feature ID to add the sidecar to",
  )
  .requiredOption(
    "-n, --name <name>",
    "Sidecar name (unique within the feature)",
  )
  .requiredOption("-i, --image <image>", "Docker image (e.g. chromium:latest)")
  .option("-p, --port <port>", "Port the sidecar listens on", parseInt)
  .option(
    "-t, --tier <tier>",
    "Resource tier: small, medium, or large (default: small)",
  )
  .option(
    "-e, --env <KEY=VALUE...>",
    "Environment variables (repeatable)",
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option(
    "-s, --secret <KEY|KEY:ALIAS...>",
    "Whitelist app feature secret keys to inject as env vars (repeatable; use KEY:ALIAS to rename)",
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option(
    "-j, --job <jobName>",
    "Attach the sidecar to the named cron job instead of the backend (requires 'job-sidecars' flag)",
  )
  .action(
    (opts: {
      feature: string;
      name: string;
      image: string;
      port?: number;
      tier?: string;
      env: string[];
      secret: string[];
      job?: string;
    }) => {
      ensureJobFlagOrExit(opts.job);

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

      if (
        opts.tier &&
        !VALID_TIERS.includes(opts.tier as (typeof VALID_TIERS)[number])
      ) {
        console.error(
          `Error: Invalid tier "${opts.tier}". Valid tiers: ${VALID_TIERS.join(", ")}`,
        );
        process.exit(1);
      }

      if (!SIDECAR_NAME_REGEX.test(opts.name)) {
        console.error(
          `Error: Invalid sidecar name "${opts.name}". ` +
            `Names must start with a lowercase letter and contain only lowercase letters, digits, and hyphens (max 63 chars).`,
        );
        process.exit(1);
      }

      const job = opts.job
        ? findJobOrExit(feature, opts.feature, opts.job)
        : null;

      const sidecars: SidecarConfig[] = job
        ? (job.sidecars ?? [])
        : (feature.backend.sidecars ?? []);

      const scopeLabel = job
        ? `job "${opts.job}" of feature "${opts.feature}"`
        : `feature "${opts.feature}"`;

      if (sidecars.some((s) => s.name === opts.name)) {
        console.error(
          `Error: A sidecar named "${opts.name}" already exists for ${scopeLabel}. ` +
            `Use a different name or remove the existing sidecar first.`,
        );
        process.exit(1);
      }

      if (sidecars.length >= MAX_SIDECARS) {
        console.error(
          `Error: ${scopeLabel[0]!.toUpperCase()}${scopeLabel.slice(1)} already has ${MAX_SIDECARS} sidecars (maximum). ` +
            `Remove an existing sidecar before adding a new one.`,
        );
        process.exit(1);
      }

      if (opts.port === 3000) {
        console.warn(
          `Warning: Port 3000 is reserved for the backend app. ` +
            `Sidecar "${opts.name}" will crash with EADDRINUSE if it binds to port 3000. ` +
            `Use --env to override the sidecar's default port (e.g. --env PORT=9222).`,
        );
      }

      const newSidecar: SidecarConfig = {
        name: opts.name,
        image: opts.image,
      };

      if (opts.port !== undefined) {
        newSidecar.port = opts.port;
      }

      if (opts.tier) {
        newSidecar.tier = opts.tier as SidecarConfig["tier"];
      }

      if (opts.env.length > 0) {
        newSidecar.env = parseEnvPairs(opts.env);
      }

      if (opts.secret.length > 0) {
        newSidecar.secrets = parseSecretEntries(opts.secret);
      }

      const nextSidecars = [...sidecars, newSidecar];
      if (job) {
        job.sidecars = nextSidecars;
      } else {
        feature.backend.sidecars = nextSidecars;
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
        job
          ? `✓ Added sidecar "${opts.name}" to job "${opts.job}" of feature "${opts.feature}" in ${FUSE_JSON}`
          : `✓ Added sidecar "${opts.name}" to feature "${opts.feature}" in ${FUSE_JSON}`,
      );
      console.log(`  Image: ${opts.image}`);
      if (opts.port !== undefined) console.log(`  Port:  ${opts.port}`);
      if (opts.tier) console.log(`  Tier:  ${opts.tier}`);
      if (opts.env.length > 0) {
        console.log(`  Env:   ${opts.env.length} variable(s)`);
      }
      if (newSidecar.secrets && newSidecar.secrets.length > 0) {
        console.log(
          `  Secrets: ${newSidecar.secrets.length} entry(ies)`,
        );
      }
    },
  );

const removeCommand = new Command("remove")
  .description(
    "Remove a sidecar container from a feature backend in fusebase.json",
  )
  .requiredOption(
    "-f, --feature <featureId>",
    "Feature ID to remove the sidecar from",
  )
  .requiredOption("-n, --name <name>", "Sidecar name to remove")
  .option(
    "-j, --job <jobName>",
    "Remove from the named cron job instead of the backend (requires 'job-sidecars' flag)",
  )
  .action((opts: { feature: string; name: string; job?: string }) => {
    ensureJobFlagOrExit(opts.job);

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
    const job = opts.job
      ? findJobOrExit(feature, opts.feature, opts.job)
      : null;

    const sidecars: SidecarConfig[] = job
      ? (job.sidecars ?? [])
      : (feature.backend?.sidecars ?? []);
    const sidecarIndex = sidecars.findIndex((s) => s.name === opts.name);
    if (sidecarIndex === -1) {
      const scopeLabel = job
        ? `job "${opts.job}" of feature "${opts.feature}"`
        : `feature "${opts.feature}"`;
      console.error(
        `Error: No sidecar named "${opts.name}" found for ${scopeLabel}.`,
      );
      process.exit(1);
    }

    const nextSidecars = sidecars.filter((s) => s.name !== opts.name);
    if (job) {
      if (nextSidecars.length === 0) {
        delete job.sidecars;
      } else {
        job.sidecars = nextSidecars;
      }
    } else {
      feature.backend!.sidecars = nextSidecars;
      if (feature.backend!.sidecars.length === 0) {
        delete feature.backend!.sidecars;
      }
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
      job
        ? `✓ Removed sidecar "${opts.name}" from job "${opts.job}" of feature "${opts.feature}" in ${FUSE_JSON}`
        : `✓ Removed sidecar "${opts.name}" from feature "${opts.feature}" in ${FUSE_JSON}`,
    );
    console.log(
      `  The sidecar will be removed from cloud infrastructure on the next fusebase deploy.`,
    );
  });

const listCommand = new Command("list")
  .description("List sidecar containers for a feature backend")
  .requiredOption(
    "-f, --feature <featureId>",
    "Feature ID to list sidecars for",
  )
  .option(
    "-j, --job <jobName>",
    "List sidecars for the named cron job instead of the backend (requires 'job-sidecars' flag)",
  )
  .action((opts: { feature: string; job?: string }) => {
    ensureJobFlagOrExit(opts.job);

    const fuseConfig = loadFuseConfig();
    if (!fuseConfig) {
      console.error(
        `Error: ${FUSE_JSON} not found or failed to parse in current directory.`,
      );
      process.exit(1);
    }

    const features = fuseConfig.features ?? [];
    const feature = features.find((f) => f.id === opts.feature);
    if (!feature) {
      console.error(
        `Error: Feature "${opts.feature}" not found in ${FUSE_JSON}. Available features: ${features.map((f) => f.id).join(", ") || "(none)"}`,
      );
      process.exit(1);
    }

    const job = opts.job
      ? findJobOrExit(feature, opts.feature, opts.job)
      : null;

    const sidecars: SidecarConfig[] = job
      ? (job.sidecars ?? [])
      : (feature.backend?.sidecars ?? []);

    if (sidecars.length === 0) {
      console.log(
        job
          ? `No sidecars configured for job "${opts.job}" of feature "${opts.feature}".`
          : `No sidecars configured for feature "${opts.feature}".`,
      );
      return;
    }

    console.log(
      job
        ? `Sidecars for job "${opts.job}" of feature "${opts.feature}" (${sidecars.length}/${MAX_SIDECARS}):`
        : `Sidecars for feature "${opts.feature}" (${sidecars.length}/${MAX_SIDECARS}):`,
    );
    console.log();

    for (const sc of sidecars) {
      console.log(`  ${sc.name}`);
      console.log(`    Image: ${sc.image}`);
      if (sc.port !== undefined) console.log(`    Port:  ${sc.port}`);
      if (sc.tier) console.log(`    Tier:  ${sc.tier}`);
      if (sc.env && Object.keys(sc.env).length > 0) {
        console.log(`    Env:   ${Object.keys(sc.env).join(", ")}`);
      }
      if (sc.secrets && sc.secrets.length > 0) {
        const rendered = sc.secrets.map((s) =>
          typeof s === "string" ? s : `${s.from} -> ${s.as}`,
        );
        console.log(`    Secrets: ${rendered.join(", ")}`);
      }
    }
  });

export const sidecarCommand = new Command("sidecar")
  .description("Manage sidecar containers for a feature backend")
  .addCommand(addCommand)
  .addCommand(removeCommand)
  .addCommand(listCommand);
