import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import {
  loadFuseConfig,
  invalidateFuseConfigCache,
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
  .action(
    (opts: {
      feature: string;
      name: string;
      image: string;
      port?: number;
      tier?: string;
      env: string[];
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

      if (
        opts.tier &&
        !VALID_TIERS.includes(opts.tier as (typeof VALID_TIERS)[number])
      ) {
        console.error(
          `Error: Invalid tier "${opts.tier}". Valid tiers: ${VALID_TIERS.join(", ")}`,
        );
        process.exit(1);
      }

      const sidecars: SidecarConfig[] = feature.backend.sidecars ?? [];

      if (!SIDECAR_NAME_REGEX.test(opts.name)) {
        console.error(
          `Error: Invalid sidecar name "${opts.name}". ` +
            `Names must start with a lowercase letter and contain only lowercase letters, digits, and hyphens (max 63 chars).`,
        );
        process.exit(1);
      }

      if (sidecars.some((s) => s.name === opts.name)) {
        console.error(
          `Error: A sidecar named "${opts.name}" already exists for feature "${opts.feature}". ` +
            `Use a different name or remove the existing sidecar first.`,
        );
        process.exit(1);
      }

      if (sidecars.length >= MAX_SIDECARS) {
        console.error(
          `Error: Feature "${opts.feature}" already has ${MAX_SIDECARS} sidecars (maximum). ` +
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

      feature.backend.sidecars = [...sidecars, newSidecar];

      const raw = readFileSync(fuseJsonPath, "utf-8");
      const indent = detectIndent(raw);
      writeFileSync(
        fuseJsonPath,
        JSON.stringify(fuseConfig, null, indent) + "\n",
        "utf-8",
      );
      invalidateFuseConfigCache();

      console.log(
        `✓ Added sidecar "${opts.name}" to feature "${opts.feature}" in ${FUSE_JSON}`,
      );
      console.log(`  Image: ${opts.image}`);
      if (opts.port !== undefined) console.log(`  Port:  ${opts.port}`);
      if (opts.tier) console.log(`  Tier:  ${opts.tier}`);
      if (opts.env.length > 0) {
        console.log(`  Env:   ${opts.env.length} variable(s)`);
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
    const sidecars: SidecarConfig[] = feature.backend?.sidecars ?? [];
    const sidecarIndex = sidecars.findIndex((s) => s.name === opts.name);
    if (sidecarIndex === -1) {
      console.error(
        `Error: No sidecar named "${opts.name}" found for feature "${opts.feature}".`,
      );
      process.exit(1);
    }

    feature.backend!.sidecars = sidecars.filter((s) => s.name !== opts.name);
    if (feature.backend!.sidecars.length === 0) {
      delete feature.backend!.sidecars;
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
      `✓ Removed sidecar "${opts.name}" from feature "${opts.feature}" in ${FUSE_JSON}`,
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
  .action((opts: { feature: string }) => {
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

    const sidecars: SidecarConfig[] = feature.backend?.sidecars ?? [];

    if (sidecars.length === 0) {
      console.log(
        `No sidecars configured for feature "${opts.feature}".`,
      );
      return;
    }

    console.log(
      `Sidecars for feature "${opts.feature}" (${sidecars.length}/${MAX_SIDECARS}):`,
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
    }
  });

export const sidecarCommand = new Command("sidecar")
  .description("Manage sidecar containers for a feature backend")
  .addCommand(addCommand)
  .addCommand(removeCommand)
  .addCommand(listCommand);
