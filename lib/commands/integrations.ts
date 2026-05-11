import { Command } from "commander";
import chalk from "chalk";
import type { IdePreset } from "./steps/ide-setup";
import { resolveIdePresets } from "./steps/ide-setup";
import {
  loadMcpServersCatalog,
  runMcpIntegrationsStep,
  syncMcpIntegrationsNow,
} from "./steps/integrations";
import {
  assertCustomNameNotReserved,
  removeCustomIntegration,
  setCustomIntegrationEnabled,
  upsertCustomIntegration,
  type McpCustomIntegrationEntry,
} from "../mcp-custom-integrations";
import { probeMcpHttpEndpoint } from "../mcp-probe";
import {
  hasFlag,
  loadFuseConfig,
  MANAGED_INTEGRATIONS_FLAG,
} from "../config";
import {
  connectManagedMcpTemplate,
  listManagedMcpTemplates,
  readAppGateTokenOrExit,
} from "../managed-integrations";

const VALID_IDE_PRESETS: IdePreset[] = ["claude-code", "cursor", "vscode", "opencode", "codex", "other"];

function resolveIdePresetsOrExit(ide?: string): Set<IdePreset> | undefined {
  if (!ide) return undefined;
  const presets = resolveIdePresets(ide);
  if (presets.size === 0) {
    console.error(`Error: Invalid --ide "${ide}". Use: ${VALID_IDE_PRESETS.join(", ")}`);
    process.exit(1);
  }
  return presets;
}

function buildProbeHeaders(entry: Pick<McpCustomIntegrationEntry, "token" | "headers">): Record<
  string,
  string
> | undefined {
  const headers: Record<string, string> = { ...(entry.headers ?? {}) };
  const token = entry.token?.trim();
  if (token && headers.Authorization === undefined) {
    headers.Authorization = `Bearer ${token}`;
  }
  return Object.keys(headers).length ? headers : undefined;
}

function collectHeader(
  value: string,
  prev: { key: string; value: string }[],
): { key: string; value: string }[] {
  const idx = value.indexOf(":");
  if (idx <= 0) {
    throw new Error(`Invalid --header "${value}". Use Key: value`);
  }
  const key = value.slice(0, idx).trim();
  const v = value.slice(idx + 1).trim();
  if (!key) throw new Error(`Invalid --header "${value}"`);
  return [...prev, { key, value: v }];
}

function parsePositiveIntOption(value: string, fieldName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

function printKeyValueRows(rows: Array<{ key: string; value: string }>): void {
  const keyWidth = Math.max(...rows.map((row) => row.key.length));
  for (const row of rows) {
    console.log(`  ${row.key.padEnd(keyWidth)}  ${row.value}`);
  }
}

export const integrationsCommand = new Command("integrations").description(
  "Configure optional MCP integrations: catalog servers, custom HTTP MCP URLs, and IDE configs",
);

if (hasFlag(MANAGED_INTEGRATIONS_FLAG)) {
  integrationsCommand
    .command("list-templates")
    .description("List MCP manager templates from Gate service")
    .action(async () => {
      const gateToken = await readAppGateTokenOrExit(process.cwd());
      const managedTemplates = await listManagedMcpTemplates(gateToken);

      if (managedTemplates.length === 0) {
        console.log("No managed templates found.");
        return;
      }

      console.log(chalk.bold.cyan("Managed templates"));
      for (const template of managedTemplates) {
        console.log(
          `  ${chalk.green("•")} ${template.name} (id: \`${template.globalId}\`, app: \`${template.app}\`)`,
        );
      }

      const firstTemplateName = managedTemplates[0]!.name;
      const escapedTemplateName = firstTemplateName.includes(" ")
        ? `"${firstTemplateName.replace(/"/g, '\\"')}"`
        : firstTemplateName;
      console.log("");
      console.log(chalk.bold("Connect example:"));
      console.log(
        `  ${chalk.cyan("fusebase integrations connect-template --template-name")} ${escapedTemplateName}`,
      );
    });

  integrationsCommand
    .command("connect-template")
    .description("Create an MCP server connection from a managed template")
    .requiredOption("--template-name <name>", "Template name to connect")
    .option("--channel-id <id>", "Channel ID attached to the server")
    .option("--no-channel", "Create server without channels")
    .option(
      "--wait-timeout-sec <sec>",
      "How long to wait for auth activation",
      (value) => parsePositiveIntOption(value, "wait-timeout-sec"),
      300,
    )
    .option(
      "--poll-interval-sec <sec>",
      "Auth polling interval",
      (value) => parsePositiveIntOption(value, "poll-interval-sec"),
      5,
    )
    .option("--token <token>", "Required when template auth type is token_bearer")
    .action(
      async (options: {
        templateName: string;
        channelId?: string;
        channel?: boolean;
        waitTimeoutSec: number;
        pollIntervalSec: number;
        token?: string;
      }) => {
        try {
          const gateToken = await readAppGateTokenOrExit(process.cwd());
          const fuseConfig = loadFuseConfig();
          if (!fuseConfig?.appId) {
            throw new Error("Invalid fusebase.json. Missing appId. Run 'fusebase init' first.");
          }

          const server = await connectManagedMcpTemplate({
            templateName: options.templateName,
            gateToken,
            channelId: options.channelId,
            noChannel: options.channel === false,
            waitTimeoutSec: options.waitTimeoutSec,
            pollIntervalSec: options.pollIntervalSec,
            token: options.token,
          });

          console.log(chalk.green("✓ Managed MCP server connected."));
          printKeyValueRows([
            { key: "Template", value: options.templateName },
            { key: "Server ID", value: server.serverId },
          ]);
          if (server.command !== undefined) {
            const commandText =
              typeof server.command === "string"
                ? server.command
                : JSON.stringify(server.command, null, 2);
            console.log(chalk.bold("Command:"));
            console.log(commandText);
          }
        } catch (error) {
          console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
          process.exit(1);
        }
      },
    );
}

integrationsCommand
  .command("add")
  .description("Add a custom HTTP MCP server (stored in fusebase.json) and apply IDE configs")
  .argument("<name>", "Unique server key (not a catalog name)")
  .requiredOption("--url <url>", "MCP endpoint URL")
  .option("--type <type>", "Transport type (default: http)", "http")
  .option("--token <token>", "Optional Bearer token (or set Authorization in --header)")
  .option(
    "--header <key:value>",
    "Optional header (repeatable), e.g. --header 'Authorization: Bearer x'",
    collectHeader,
    [] as { key: string; value: string }[],
  )
  .option("--skip-check", "Skip HTTP reachability check before saving")
  .option(
    "--ide <preset>",
    `Limit IDE configs: ${VALID_IDE_PRESETS.join(", ")} (default: all)`,
  )
  .action(
    async (
      name: string,
      opts: {
        url: string;
        type: string;
        token?: string;
        header: { key: string; value: string }[];
        skipCheck?: boolean;
        ide?: string;
      },
    ) => {
      const cwd = process.cwd();
      const presets = resolveIdePresetsOrExit(opts.ide);
      const { catalog, cleanup } = await loadMcpServersCatalog();
      try {
        assertCustomNameNotReserved(name, new Set(Object.keys(catalog)));
      } finally {
        if (cleanup) await cleanup();
      }

      const headers: Record<string, string> = {};
      for (const h of opts.header) {
        headers[h.key] = h.value;
      }

      const entry: McpCustomIntegrationEntry = {
        type: opts.type.trim() || "http",
        url: opts.url.trim(),
        enabled: true,
      };
      if (opts.token) entry.token = opts.token;
      if (Object.keys(headers).length) entry.headers = headers;

      if (!opts.skipCheck) {
        const probeHeaders = buildProbeHeaders(entry);
        const result = await probeMcpHttpEndpoint(entry.url, { headers: probeHeaders });
        if (result.ok === false) {
          console.error(`Error: MCP endpoint unreachable: ${result.error}`);
          process.exit(1);
        }
        // eslint-disable-next-line no-console
        console.log(`✓ Endpoint responded (HTTP ${result.status})`);
      }

      upsertCustomIntegration(cwd, name, entry);
      // eslint-disable-next-line no-console
      console.log(`✓ Saved custom MCP "${name}" to fusebase.json`);

      await syncMcpIntegrationsNow({ targetDir: cwd, idePresets: presets });
    },
  );

integrationsCommand
  .command("disable")
  .description(
    "Disable a custom MCP integration (removes it from IDE configs; keeps fusebase.json entry)",
  )
  .argument("<name>", "Custom server key")
  .option(
    "--ide <preset>",
    `Limit IDE configs: ${VALID_IDE_PRESETS.join(", ")} (default: all)`,
  )
  .action(async (name: string, opts: { ide?: string }) => {
    const cwd = process.cwd();
    const presets = resolveIdePresetsOrExit(opts.ide);
    setCustomIntegrationEnabled(cwd, name, false);
    // eslint-disable-next-line no-console
    console.log(`✓ Disabled custom MCP "${name}"`);
    await syncMcpIntegrationsNow({ targetDir: cwd, idePresets: presets });
  });

integrationsCommand
  .command("enable")
  .description("Re-enable a disabled custom MCP integration and apply IDE configs")
  .argument("<name>", "Custom server key")
  .option(
    "--ide <preset>",
    `Limit IDE configs: ${VALID_IDE_PRESETS.join(", ")} (default: all)`,
  )
  .action(async (name: string, opts: { ide?: string }) => {
    const cwd = process.cwd();
    const presets = resolveIdePresetsOrExit(opts.ide);
    setCustomIntegrationEnabled(cwd, name, true);
    // eslint-disable-next-line no-console
    console.log(`✓ Enabled custom MCP "${name}"`);
    await syncMcpIntegrationsNow({ targetDir: cwd, idePresets: presets });
  });

integrationsCommand
  .command("remove")
  .description("Remove a custom MCP integration from fusebase.json and IDE configs")
  .alias("delete")
  .argument("<name>", "Custom server key")
  .option(
    "--ide <preset>",
    `Limit IDE configs: ${VALID_IDE_PRESETS.join(", ")} (default: all)`,
  )
  .action(async (name: string, opts: { ide?: string }) => {
    const cwd = process.cwd();
    const presets = resolveIdePresetsOrExit(opts.ide);
    removeCustomIntegration(cwd, name);
    // eslint-disable-next-line no-console
    console.log(`✓ Removed custom MCP "${name}"`);
    await syncMcpIntegrationsNow({
      targetDir: cwd,
      idePresets: presets,
      extraRemoveServerNames: [name.trim()],
    });
  });

integrationsCommand
  .option(
    "--ide <preset>",
    `Limit to a single IDE preset: ${VALID_IDE_PRESETS.join(", ")} (default: all)`,
  )
  .option(
    "--no-prompt",
    "Do not show interactive selection; keep catalog optional servers inferred from IDE configs",
  )
  .action(async (options: { ide?: string; noPrompt?: boolean }) => {
    const cwd = process.cwd();

    const presets = resolveIdePresetsOrExit(options.ide);
    const noPrompt = process.argv.includes("--no-prompt") || options.noPrompt === true;
    await runMcpIntegrationsStep({
      targetDir: cwd,
      idePresets: presets,
      interactive: noPrompt ? false : undefined,
    });
  });
