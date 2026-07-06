import { Command } from "commander";
import chalk from "chalk";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import {
  syncAppApiConsumerContracts,
  verifyCentralAppApiConsumerContracts,
  verifyCentralAppApiProviderContracts,
  type VerifyCentralAppApiContractCaseResult,
  type VerifyCentralAppApiContractsResponse,
} from "../api";
import {
  buildDraftAppApiConsumerContractFromConsumerCalls,
  discoverAndValidateAppApiContracts,
  getAppApiContractFilePath,
  type AppApiContractValue,
} from "../app-api-contracts";
import {
  getConfig,
  hasFlag,
  loadFuseConfig,
  requireAppId,
  upsertManualAppApiDependencyInFusebaseJson,
  type AppApiDependenciesSnapshot,
  type AppApiDependencySnapshot,
  type FeatureConfig,
} from "../config";
import {
  analyzeAppApiDependencyCalls,
  type AppApiResolvedCall,
} from "../app-api-dependencies-used-operations";

function getConfiguredAppById(appId: string): FeatureConfig {
  const fuseConfig = loadFuseConfig();
  if (!fuseConfig) {
    throw new Error("fusebase.json not found. Run fusebase init first.");
  }

  const app = (fuseConfig.apps ?? []).find((item) => item.id === appId);
  if (!app) {
    throw new Error(`App "${appId}" not found in fusebase.json`);
  }

  return app;
}

function getConfiguredAppsWithPath(
  requestedAppId?: string,
): Array<FeatureConfig & { path: string }> {
  const fuseConfig = loadFuseConfig();
  if (!fuseConfig) {
    throw new Error("fusebase.json not found. Run fusebase init first.");
  }

  const apps = (fuseConfig.apps ?? []).filter(
    (app): app is FeatureConfig & { path: string } =>
      typeof app.path === "string" && app.path.length > 0,
  );

  if (requestedAppId) {
    const app = getConfiguredAppById(requestedAppId);
    if (typeof app.path !== "string" || app.path.length === 0) {
      throw new Error(`App "${requestedAppId}" is missing "path" in fusebase.json`);
    }
    return [app];
  }

  if (apps.length === 0) {
    throw new Error(
      "No apps with path configured in fusebase.json. Run fusebase app create first.",
    );
  }

  return apps;
}

function getConsumerAppOrThrow(consumerAppId: string): FeatureConfig & { path: string } {
  const apps = getConfiguredAppsWithPath(consumerAppId);
  return apps[0]!;
}

function printValidationResult(
  appPath: string,
  result: Awaited<ReturnType<typeof discoverAndValidateAppApiContracts>>,
  dependencyIssues: Array<{ filePath: string; path: string; message: string }>,
): void {
  console.log(`Contracts dir: ${relative(process.cwd(), result.contractsDir) || "."}`);

  if (result.files.length === 0) {
    console.log("Contracts: 0");
  } else {
    console.log(`Contracts: ${result.files.length}`);
  }

  const issues = [...result.issues, ...dependencyIssues].sort(
    (a, b) =>
      a.filePath.localeCompare(b.filePath) || a.path.localeCompare(b.path),
  );

  if (issues.length === 0) {
    console.log("Status: valid");
    return;
  }

  console.log("Status: invalid");
  for (const issue of issues) {
    const fileLabel = relative(appPath, issue.filePath).replace(/\\/g, "/");
    console.log(`  ${fileLabel} ${issue.path} ${issue.message}`);
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeScaffoldedContractFile(params: {
  consumerAppPath: string;
  providerAppId: string;
  operationId: string;
  calls: Array<{ input?: AppApiContractValue }>;
  force: boolean;
}): Promise<{ path: string; outcome: "created" | "overwritten" | "skipped" }> {
  const contract = buildDraftAppApiConsumerContractFromConsumerCalls({
    providerAppId: params.providerAppId,
    operationId: params.operationId,
    calls: params.calls,
  });

  const contractPath = getAppApiContractFilePath(
    params.consumerAppPath,
    params.providerAppId,
    params.operationId,
  );

  const exists = await fileExists(contractPath);
  if (exists && !params.force) {
    return { path: contractPath, outcome: "skipped" };
  }

  await mkdir(dirname(contractPath), { recursive: true });
  await writeFile(
    contractPath,
    JSON.stringify(contract, null, 2) + "\n",
    "utf-8",
  );

  return { path: contractPath, outcome: exists ? "overwritten" : "created" };
}

function readScaffoldingTargets(params: {
  calls: AppApiResolvedCall[];
  providerAppId?: string;
  operationId?: string;
}): AppApiResolvedCall[] {
  const targets = params.calls.filter((target) => {
    if (params.providerAppId && target.targetAppId !== params.providerAppId) {
      return false;
    }
    if (params.operationId && target.operationId !== params.operationId) {
      return false;
    }
    return true;
  });

  return targets.sort((a, b) => {
    return (
      a.targetOrgId.localeCompare(b.targetOrgId) ||
      a.targetAppId.localeCompare(b.targetAppId) ||
      a.operationId.localeCompare(b.operationId) ||
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.column - b.column
    );
  });
}

function readMatchingManualDependencies(params: {
  snapshot: AppApiDependenciesSnapshot | undefined;
  providerAppId?: string;
  operationId?: string;
}): AppApiDependencySnapshot[] {
  return (params.snapshot?.dependencies ?? []).filter((dependency) => {
    if (dependency.source !== "manual") {
      return false;
    }
    if (params.providerAppId && dependency.targetAppId !== params.providerAppId) {
      return false;
    }
    if (params.operationId && dependency.operationId !== params.operationId) {
      return false;
    }
    return true;
  });
}

function printVerifyCaseDivider(caseLabel: string, filePath?: string): void {
  console.log("");
  console.log(chalk.dim("------------------------------------------------------------"));
  console.log(`${chalk.bold.cyan("CASE")} ${chalk.bold(caseLabel)}`);
  if (filePath) {
    console.log(chalk.dim(`     ${filePath}`));
  }
}

function formatVerifyTag(
  tag: "RUN" | "PASS" | "FAIL" | "WARN" | "SUMMARY" | "DEBUG",
): string {
  if (tag === "RUN") {
    return chalk.cyan.bold(tag);
  }
  if (tag === "PASS") {
    return chalk.green.bold(tag);
  }
  if (tag === "FAIL") {
    return chalk.red.bold(tag);
  }
  if (tag === "WARN") {
    return chalk.yellow.bold(tag);
  }
  if (tag === "DEBUG") {
    return chalk.magenta.bold(tag);
  }
  return chalk.bold(tag);
}

function printVerifyStatus(params: {
  tag: "RUN" | "PASS" | "FAIL" | "WARN" | "DEBUG";
  caseLabel: string;
  message: string;
}): void {
  console.log(`${formatVerifyTag(params.tag)} ${chalk.bold(params.caseLabel)} ${params.message}`);
}

function formatVerifyData(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable]";
  }
}

function groupCallsByOperation(
  calls: AppApiResolvedCall[],
): Array<{
  providerAppId: string;
  operationId: string;
  calls: AppApiResolvedCall[];
}> {
  const groups = new Map<
    string,
    { providerAppId: string; operationId: string; calls: AppApiResolvedCall[] }
  >();

  for (const call of calls) {
    const key = `${call.targetAppId}\u0000${call.operationId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.calls.push(call);
      continue;
    }

    groups.set(key, {
      providerAppId: call.targetAppId,
      operationId: call.operationId,
      calls: [call],
    });
  }

  return [...groups.values()].sort((a, b) => {
    return (
      a.providerAppId.localeCompare(b.providerAppId) ||
      a.operationId.localeCompare(b.operationId)
    );
  });
}

function readContractDependencyIssues(params: {
  app: FeatureConfig & { path: string };
  result: Awaited<ReturnType<typeof discoverAndValidateAppApiContracts>>;
}): Array<{ filePath: string; path: string; message: string }> {
  const dependencies = new Set(
    (params.app.fusebaseAppApiDependenciesMeta?.dependencies ?? []).map(
      (dependency) => `${dependency.targetAppId}\u0000${dependency.operationId}`,
    ),
  );

  return params.result.files.flatMap((file) => {
    const contractKey =
      `${file.contract.providerAppId}\u0000${file.contract.operationId}`;

    if (dependencies.has(contractKey)) {
      return [];
    }

    return [{
      filePath: file.filePath,
      path: "$",
      message:
        `No matching dependency found in fusebaseAppApiDependenciesMeta for ` +
        `${file.contract.providerAppId}#${file.contract.operationId}. ` +
        `Run fusebase analyze app-apis --feature ${params.app.id} or add a manual dependency.`,
    }];
  });
}

function printUnresolvedGuidance(consumerAppId: string): void {
  console.log(
    "Rule: orgId, appId, and operationId in callAppApi({ path }) must each resolve to a static string literal (a string literal, or a const that resolves to one) at the callsite.",
  );
  console.log("If the call is dynamic by design, declare the dependency manually:");
  console.log(
    `  fusebase app-api-contracts add-manual-dependency --app ${consumerAppId} --provider <providerAppId> --operation <operationId>`,
  );
}

function printVerifyResponseDebug(params: {
  caseLabel: string;
  status: number;
  body: unknown;
  requestId?: string;
}): void {
  printVerifyStatus({
    tag: "DEBUG",
    caseLabel: params.caseLabel,
    message:
      `response.status=${params.status}` +
      `${params.requestId ? ` requestId=${params.requestId}` : ""}`,
  });
  printVerifyStatus({
    tag: "DEBUG",
    caseLabel: params.caseLabel,
    message: `response.body=${formatVerifyData(params.body)}`,
  });
}

function readCentralCaseLabel(
  caseResult: VerifyCentralAppApiContractCaseResult,
): string {
  return `${caseResult.providerAppId}#${caseResult.operationId} ${caseResult.caseName}`;
}

function printCentralVerifyCase(
  caseResult: VerifyCentralAppApiContractCaseResult,
): void {
  const caseLabel = readCentralCaseLabel(caseResult);
  printVerifyCaseDivider(caseLabel);

  if (caseResult.status === "PASS") {
    printVerifyStatus({
      tag: "PASS",
      caseLabel,
      message: chalk.green(
        caseResult.response?.status !== undefined
          ? `Validation passed. status=${caseResult.response.status}`
          : "Validation passed.",
      ),
    });
    if (caseResult.warnings.length > 0) {
      printVerifyStatus({
        tag: "WARN",
        caseLabel,
        message: caseResult.warnings.join(" | "),
      });
    }
    return;
  }

  printVerifyStatus({
    tag: "FAIL",
    caseLabel,
    message: caseResult.message ?? "Verification failed.",
  });

  if (caseResult.request) {
    if (caseResult.request.url) {
      printVerifyStatus({
        tag: "DEBUG",
        caseLabel,
        message: `request.url=${caseResult.request.url}`,
      });
    }
    if (caseResult.request.envelope !== undefined) {
      printVerifyStatus({
        tag: "DEBUG",
        caseLabel,
        message: `request.body=${formatVerifyData(caseResult.request.envelope)}`,
      });
    }
  }

  if (caseResult.response) {
    printVerifyResponseDebug({
      caseLabel,
      status: caseResult.response.status ?? 0,
      body: caseResult.response.body,
    });
  }
}

function groupCentralCasesByConsumer(
  cases: VerifyCentralAppApiContractCaseResult[],
): Array<{
  consumerAppId: string | undefined;
  cases: VerifyCentralAppApiContractCaseResult[];
}> {
  const groups = new Map<
    string,
    {
      consumerAppId: string | undefined;
      cases: VerifyCentralAppApiContractCaseResult[];
    }
  >();

  for (const caseResult of cases) {
    const key = caseResult.consumerAppId ?? "";
    const existing = groups.get(key);
    if (existing) {
      existing.cases.push(caseResult);
    } else {
      groups.set(key, {
        consumerAppId: caseResult.consumerAppId,
        cases: [caseResult],
      });
    }
  }

  return [...groups.values()].sort((a, b) =>
    (a.consumerAppId ?? "").localeCompare(b.consumerAppId ?? ""),
  );
}

function printCentralVerifySummary(
  summary: VerifyCentralAppApiContractsResponse["summary"],
): void {
  const row = (label: string, value: string): string =>
    `  ${`${label}:`.padEnd(22)}${value}`;

  console.log("");
  console.log(formatVerifyTag("SUMMARY"));
  console.log(row("Total tests", String(summary.caseCount)));
  console.log(row("Passed", chalk.green(String(summary.passCount))));
  console.log(
    row(
      "Failed",
      summary.failCount > 0
        ? chalk.red(String(summary.failCount))
        : String(summary.failCount),
    ),
  );
  console.log(
    row(
      "Warnings",
      summary.warnCount > 0
        ? chalk.yellow(String(summary.warnCount))
        : String(summary.warnCount),
    ),
  );
  console.log(row("Contracts", String(summary.contractCount)));
}

export const appApiContractsCommand = new Command("app-api-contracts")
  .description("Internal: local app-to-app consumer contract PoC.");

// Gate every subcommand behind the same flag as `analyze app-apis` — the
// preAction hook fires for the actioned subcommand and its ancestors, so a
// single guard covers the whole command. `--help` runs no action and stays open.
appApiContractsCommand.hook("preAction", () => {
  if (!hasFlag("cross-app-api-calls-analysis")) {
    console.error(
      "app-api-contracts is disabled. Enable it with: fusebase config set-flag cross-app-api-calls-analysis",
    );
    process.exit(1);
  }
});

appApiContractsCommand
  .command("validate")
  .description("Internal: validate local consumer contract files.")
  .option(
    "--app <consumerAppId>",
    "Validate contracts for one consumer app; otherwise validate every configured app with a path",
  )
  .option("--json", "Emit a machine-readable JSON report for CI")
  .action(async (opts: { app?: string; json?: boolean }) => {
    try {
      const apps = getConfiguredAppsWithPath(opts.app);
      const entries = [];

      for (const app of apps) {
        const appPath = resolve(process.cwd(), app.path);
        const result = await discoverAndValidateAppApiContracts(appPath);
        const dependencyIssues = readContractDependencyIssues({ app, result });
        const issues = [...result.issues, ...dependencyIssues];
        entries.push({ app, appPath, result, dependencyIssues, issues });
      }

      const hasIssues = entries.some((entry) => entry.issues.length > 0);

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              command: "validate",
              ok: !hasIssues,
              apps: entries.map((entry) => ({
                appId: entry.app.id,
                path: entry.app.path,
                contractsDir:
                  relative(process.cwd(), entry.result.contractsDir) || ".",
                contractCount: entry.result.files.length,
                status: entry.issues.length === 0 ? "valid" : "invalid",
                issues: entry.issues
                  .slice()
                  .sort(
                    (a, b) =>
                      a.filePath.localeCompare(b.filePath) ||
                      a.path.localeCompare(b.path),
                  )
                  .map((issue) => ({
                    file: relative(process.cwd(), issue.filePath).replace(
                      /\\/g,
                      "/",
                    ),
                    path: issue.path,
                    message: issue.message,
                  })),
              })),
            },
            null,
            2,
          ),
        );
      } else {
        for (const [index, entry] of entries.entries()) {
          if (index > 0) {
            console.log("");
          }
          console.log(`App ${entry.app.id}`);
          console.log(`Path: ${entry.app.path}`);
          printValidationResult(entry.appPath, entry.result, entry.dependencyIssues);
        }
      }

      if (hasIssues) {
        process.exit(1);
      }
    } catch (error) {
      console.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  });

appApiContractsCommand
  .command("publish")
  .description(
    "Internal: publish validated local consumer contract files to Fusebase via the public API.",
  )
  .requiredOption("--app <consumerAppId>", "Consumer app id from fusebase.json")
  .action(async (opts: { app: string }) => {
    try {
      const consumerApp = getConsumerAppOrThrow(opts.app);

      const fuseConfig = loadFuseConfig();
      if (!fuseConfig) {
        throw new Error("fusebase.json not found. Run fusebase init first.");
      }
      if (
        typeof fuseConfig.orgId !== "string" ||
        typeof fuseConfig.productId !== "string"
      ) {
        throw new Error("fusebase.json is missing orgId or productId.");
      }

      const apiKey = getConfig().apiKey;
      if (!apiKey) {
        throw new Error(
          "Not authenticated. Run 'fusebase auth' or 'fusebase auth --api-key=<apiKey>' first.",
        );
      }

      const appPath = resolve(process.cwd(), consumerApp.path);
      const result = await discoverAndValidateAppApiContracts(appPath);
      const dependencyIssues = readContractDependencyIssues({
        app: consumerApp,
        result,
      });
      const issues = [...result.issues, ...dependencyIssues].sort(
        (a, b) =>
          a.filePath.localeCompare(b.filePath) || a.path.localeCompare(b.path),
      );

      if (issues.length > 0) {
        console.log(`App ${consumerApp.id}`);
        console.log(`Path: ${consumerApp.path}`);
        printValidationResult(appPath, result, dependencyIssues);
        console.log("");
        console.log(
          chalk.red("Publish aborted: fix the validation issues above first."),
        );
        process.exit(1);
      }

      const contracts = result.files.map((file) => file.contract);
      const response = await syncAppApiConsumerContracts(
        apiKey,
        fuseConfig.orgId,
        fuseConfig.productId,
        requireAppId(consumerApp),
        contracts,
      );
      const stored =
        typeof response.stored === "number" ? response.stored : contracts.length;

      console.log(`App ${consumerApp.id}`);
      console.log(`Path: ${consumerApp.path}`);
      console.log(`Contracts: ${contracts.length}`);
      console.log(
        chalk.green(`✓ Published ${stored} contract${stored === 1 ? "" : "s"}.`),
      );
    } catch (error) {
      console.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  });

appApiContractsCommand
  .command("unresolved")
  .description(
    "Internal: print unresolved consumer callAppApi usages and the manual-resolution follow-up.",
  )
  .requiredOption("--app <consumerAppId>", "Consumer app id from fusebase.json")
  .action(async (opts: { app: string }) => {
    try {
      const consumerApp = getConsumerAppOrThrow(opts.app);
      const snapshot = consumerApp.fusebaseAppApiDependenciesMeta;

      console.log(`App ${consumerApp.id}`);
      console.log(`Path: ${consumerApp.path}`);
      console.log("");

      if (!snapshot) {
        console.log("No fusebaseAppApiDependenciesMeta found.");
        console.log(
          `Run fusebase analyze app-apis --feature ${consumerApp.id} first.`,
        );
        return;
      }

      console.log(`Unresolved: ${snapshot.unresolved.length}`);
      if (snapshot.unresolved.length === 0) {
        console.log("  (none)");
      } else {
        for (const unresolved of snapshot.unresolved) {
          console.log(
            `  ${unresolved.file}:${unresolved.line}:${unresolved.column} ${unresolved.reason}`,
          );
        }
        console.log("");
        printUnresolvedGuidance(requireAppId(consumerApp));
      }

      const manualDependencies = readMatchingManualDependencies({ snapshot });
      console.log("");
      console.log(`Manual dependencies: ${manualDependencies.length}`);
      if (manualDependencies.length === 0) {
        console.log("  (none)");
      } else {
        for (const dependency of manualDependencies) {
          console.log(
            `  ${dependency.targetOrgId}/${dependency.targetAppId}#${dependency.operationId}`,
          );
        }
      }
    } catch (error) {
      console.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  });

appApiContractsCommand
  .command("add-manual-dependency")
  .description(
    "Internal: add a manual dependency entry for an unresolved or intentionally dynamic call.",
  )
  .requiredOption("--app <consumerAppId>", "Consumer app id from fusebase.json")
  .requiredOption("--provider <providerAppId>", "Provider app id")
  .requiredOption("--operation <operationId>", "Provider operation id")
  .option(
    "--org <targetOrgId>",
    "Provider org id; defaults to fusebase.json orgId",
  )
  .action(
    async (opts: {
      app: string;
      provider: string;
      operation: string;
      org?: string;
    }) => {
      try {
        const consumerApp = getConsumerAppOrThrow(opts.app);
        const fuseConfig = loadFuseConfig();
        if (!fuseConfig) {
          throw new Error("fusebase.json not found. Run fusebase init first.");
        }

        const projectRoot = resolve(process.cwd());
        const targetOrgId = opts.org ?? fuseConfig.orgId;
        const result = upsertManualAppApiDependencyInFusebaseJson(
          projectRoot,
          requireAppId(consumerApp),
          {
            targetOrgId,
            targetAppId: opts.provider,
            operationId: opts.operation,
          },
        );

        console.log(`App ${consumerApp.id}`);
        console.log(`Path: ${consumerApp.path}`);
        console.log("");
        if (result.added) {
          console.log(
            `✓ Added manual dependency ${targetOrgId}/${opts.provider}#${opts.operation}`,
          );
        } else {
          console.log(
            `Manual dependency already present for ${targetOrgId}/${opts.provider}#${opts.operation}`,
          );
        }
        console.log("");
        console.log(
          `Next: fusebase app-api-contracts scaffold --app ${consumerApp.id} --provider ${opts.provider} --operation ${opts.operation} --force`,
        );
      } catch (error) {
        console.error(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      }
    },
  );

appApiContractsCommand
  .command("scaffold")
  .description(
    "Internal: scaffold draft consumer contracts from resolved consumer callsites and manual dependencies.",
  )
  .requiredOption("--app <consumerAppId>", "Consumer app id from fusebase.json")
  .option("--provider <providerAppId>", "Only scaffold one provider app")
  .option("--operation <operationId>", "Only scaffold one provider operation")
  .option(
    "--force",
    "Overwrite existing contract files instead of skipping them",
  )
  .action(
    async (opts: {
      app: string;
      provider?: string;
      operation?: string;
      force?: boolean;
    }) => {
      try {
        const consumerApp = getConsumerAppOrThrow(opts.app);
        const snapshot = consumerApp.fusebaseAppApiDependenciesMeta;
        const consumerAppPath = resolve(process.cwd(), consumerApp.path);
        const analysis = await analyzeAppApiDependencyCalls({
          projectRoot: resolve(process.cwd()),
          scopeRoot: consumerAppPath,
        });

        const targets = readScaffoldingTargets({
          calls: analysis.calls,
          providerAppId: opts.provider,
          operationId: opts.operation,
        });
        const manualDependencies = readMatchingManualDependencies({
          snapshot,
          providerAppId: opts.provider,
          operationId: opts.operation,
        });
        const manualDependencyCount = manualDependencies.length;

        const targetsByKey = new Set(
          targets.map((target) => `${target.targetAppId}\u0000${target.operationId}`),
        );
        const manualOnlyTargets = manualDependencies
          .filter(
            (dependency) =>
              !targetsByKey.has(
                `${dependency.targetAppId}\u0000${dependency.operationId}`,
              ),
          )
          .sort((a, b) => {
            return (
              a.targetOrgId.localeCompare(b.targetOrgId) ||
              a.targetAppId.localeCompare(b.targetAppId) ||
              a.operationId.localeCompare(b.operationId)
            );
          });

        if (targets.length === 0 && manualOnlyTargets.length === 0) {
          console.log(
            "No resolved consumer callsites or manual dependencies matched the requested filters.",
          );
          if (analysis.unresolved.length > 0) {
            console.log("");
            console.log("Unresolved callAppApi usages still exist.");
            printUnresolvedGuidance(requireAppId(consumerApp));
          }
          return;
        }

        const scaffoldInputs = [
          ...groupCallsByOperation(targets),
          ...manualOnlyTargets.map((dependency) => ({
            providerAppId: dependency.targetAppId,
            operationId: dependency.operationId,
            calls: [] as AppApiResolvedCall[],
          })),
        ];

        const createdFiles: string[] = [];
        const skippedFiles: string[] = [];
        const overwrittenFiles: string[] = [];

        for (const input of scaffoldInputs) {
          const { path, outcome } = await writeScaffoldedContractFile({
            consumerAppPath,
            providerAppId: input.providerAppId,
            operationId: input.operationId,
            calls: input.calls,
            force: Boolean(opts.force),
          });

          if (outcome === "created") {
            createdFiles.push(path);
          } else if (outcome === "overwritten") {
            overwrittenFiles.push(path);
          } else {
            skippedFiles.push(path);
          }
        }

        console.log(`App ${consumerApp.id}`);
        console.log(`Path: ${consumerApp.path}`);
        console.log("");
        console.log(`Scaffolded: ${createdFiles.length}`);
        for (const filePath of createdFiles) {
          console.log(`  ${relative(process.cwd(), filePath).replace(/\\/g, "/")}`);
        }

        console.log("");
        console.log(`Overwritten: ${overwrittenFiles.length}`);
        for (const filePath of overwrittenFiles) {
          console.log(`  ${relative(process.cwd(), filePath).replace(/\\/g, "/")}`);
        }

        console.log("");
        console.log(`Skipped existing: ${skippedFiles.length}`);
        for (const filePath of skippedFiles) {
          console.log(`  ${relative(process.cwd(), filePath).replace(/\\/g, "/")}`);
        }

        if (analysis.unresolved.length > 0) {
          console.log("");
          console.log(
            `Unresolved callAppApi usages not scaffolded: ${analysis.unresolved.length}`,
          );
          printUnresolvedGuidance(requireAppId(consumerApp));
        }

        if (manualDependencyCount > 0) {
          console.log("");
          console.log(`Manual dependencies considered: ${manualDependencyCount}`);
        }
      } catch (error) {
        console.error(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      }
    },
  );

appApiContractsCommand
  .command("verify-consumer")
  .description(
    "Internal: verify centrally stored consumer contracts for one consumer app through the public API.",
  )
  .requiredOption("--app <consumerAppId>", "Consumer app id from fusebase.json")
  .option("--provider <providerAppId>", "Only verify one provider app")
  .option("--operation <operationId>", "Only verify one provider operation")
  .option("--json", "Emit a machine-readable JSON report for CI")
  .action(
    async (opts: {
      app: string;
      provider?: string;
      operation?: string;
      json?: boolean;
    }) => {
      try {
        const consumerApp = getConfiguredAppById(opts.app);
        const fuseConfig = loadFuseConfig();
        if (!fuseConfig) {
          throw new Error("fusebase.json not found. Run fusebase init first.");
        }

        const config = getConfig();
        if (!config.apiKey) {
          throw new Error("No API key configured. Run fusebase auth first.");
        }

        const response = await verifyCentralAppApiConsumerContracts(
          config.apiKey,
          fuseConfig.orgId,
          fuseConfig.productId,
          requireAppId(consumerApp),
          { provider: opts.provider, operation: opts.operation },
        );

        if (opts.json) {
          console.log(
            JSON.stringify(
              {
                command: "verify-consumer",
                consumerAppId: consumerApp.id,
                ok: response.ok,
                summary: response.summary,
                cases: response.cases,
              },
              null,
              2,
            ),
          );
        } else if (response.summary.caseCount === 0) {
          console.log(
            "No centrally stored contracts matched the requested filters. Nothing to verify.",
          );
          return;
        } else {
          for (const caseResult of response.cases) {
            printCentralVerifyCase(caseResult);
          }
          printCentralVerifySummary(response.summary);
        }

        if (!response.ok) {
          process.exit(1);
        }
      } catch (error) {
        console.error(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
      }
    },
  );

appApiContractsCommand
  .command("verify-provider")
  .description(
    "Internal: verify centrally stored org-wide inbound contracts for one provider app through the public API.",
  )
  .requiredOption("--app <providerAppId>", "Provider app id")
  .option("--json", "Emit a machine-readable JSON report for CI")
  .action(async (opts: { app: string; json?: boolean }) => {
    try {
      const fuseConfig = loadFuseConfig();
      if (!fuseConfig) {
        throw new Error("fusebase.json not found. Run fusebase init first.");
      }

      const config = getConfig();
      if (!config.apiKey) {
        throw new Error("No API key configured. Run fusebase auth first.");
      }

      const response = await verifyCentralAppApiProviderContracts(
        config.apiKey,
        fuseConfig.orgId,
        fuseConfig.productId,
        opts.app,
      );

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              command: "verify-provider",
              providerAppId: opts.app,
              ok: response.ok,
              summary: response.summary,
              cases: response.cases,
            },
            null,
            2,
          ),
        );
      } else if (response.summary.caseCount === 0) {
        console.log(
          "No centrally stored consumer contracts matched this provider. Nothing to verify.",
        );
        return;
      } else {
        const groups = groupCentralCasesByConsumer(response.cases);
        for (const group of groups) {
          console.log("");
          console.log(`Consumer ${group.consumerAppId ?? "(unknown)"}`);
          for (const caseResult of group.cases) {
            printCentralVerifyCase(caseResult);
          }
        }
        printCentralVerifySummary(response.summary);
      }

      if (!response.ok) {
        process.exit(1);
      }
    } catch (error) {
      console.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  });
