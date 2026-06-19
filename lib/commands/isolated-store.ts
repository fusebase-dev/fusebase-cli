import { Command } from "commander";
import { join } from "path";
import { hasFlag, loadFuseConfig } from "../config";
import { requestGateService } from "../gate-api";
import { readAppGateTokenOrExit } from "../managed-integrations";
import {
  buildSqlMigrationBundleArtifact,
  resolveSqlStoreConfig,
  type SqlMigrationBundleArtifact,
} from "../isolated-sql-bundle";

type SqlBundleOptions = {
  app: string;
  alias?: string;
  storeId?: string;
  stage?: "dev" | "prod";
  schema?: string;
  json?: boolean;
  status?: boolean;
  rlsStatus?: boolean;
  dryRun?: boolean;
  apply?: boolean;
  yes?: boolean;
};

const ISOLATED_SQL_RLS_FLAG = "postgres-rls";

function writeStdoutLine(text: string): void {
  process.stdout.write(`${text}\n`);
}

function resolveAppConfig(appId: string) {
  const fuseConfig = loadFuseConfig();
  if (fuseConfig === null) {
    throw new Error("Project is not initialized. Run 'fusebase init' first.");
  }
  const appConfig = (fuseConfig.apps ?? []).find((app) => app.id === appId);
  if (appConfig === undefined) {
    const knownIds = (fuseConfig.apps ?? []).map((app) => app.id).join(", ");
    throw new Error(
      knownIds.length > 0
        ? `App "${appId}" not found in fusebase.json. Known app ids: ${knownIds}`
        : `App "${appId}" not found in fusebase.json (apps[] is empty)`,
    );
  }
  return { fuseConfig, appConfig };
}

type SqlRlsStatusResponse = {
  currentUser?: string;
  bypassRls?: boolean;
  superuser?: boolean;
  rlsEnabledCount?: number;
};

function readArtifact(options: SqlBundleOptions): SqlMigrationBundleArtifact {
  const { appConfig } = resolveAppConfig(options.app);
  if (appConfig.path === undefined || appConfig.path.trim().length === 0) {
    throw new Error(`App "${options.app}" has no path in fusebase.json`);
  }
  const store = resolveSqlStoreConfig(appConfig, options.alias);
  if (store === null) {
    throw new Error(
      `App "${options.app}" has no isolatedStores.sql[] config in fusebase.json`,
    );
  }
  return buildSqlMigrationBundleArtifact({
    appConfig,
    appBasePath: join(process.cwd(), appConfig.path),
    store,
  });
}

function buildGateRequestBody(
  artifact: SqlMigrationBundleArtifact,
  schemaOverride: string | undefined,
  includeRlsManifest: boolean,
) {
  return {
    bundle: artifact.bundle,
    schemaName: schemaOverride ?? artifact.schemaName ?? undefined,
    ...(includeRlsManifest ? { rlsManifest: artifact.rlsManifest ?? undefined } : {}),
  };
}

function printSummary(
  artifact: SqlMigrationBundleArtifact,
  includeRlsManifest: boolean,
): void {
  const latest = artifact.bundle.migrations.at(-1);
  writeStdoutLine(`App: ${artifact.appId}`);
  writeStdoutLine(`Store alias: ${artifact.store.alias}`);
  if (artifact.store.storeId !== undefined) {
    writeStdoutLine(`Store ID: ${artifact.store.storeId}`);
  }
  writeStdoutLine(`Migrations: ${artifact.bundle.migrations.length}`);
  writeStdoutLine(`Bundle version: ${String(artifact.bundle.bundleVersion ?? "")}`);
  if (latest !== undefined) {
    writeStdoutLine(
      `Head: v${latest.version} ${latest.name} ${latest.checksum.slice(0, 12)}...`,
    );
  }
  if (artifact.rlsManifest === null) {
    writeStdoutLine("RLS manifest: none");
  } else if (includeRlsManifest) {
    writeStdoutLine("RLS manifest: yes");
  } else {
    const message = `RLS manifest: present but not sent (enable with: fusebase config set-flag ${ISOLATED_SQL_RLS_FLAG})`;
    writeStdoutLine(message);
    console.warn(
      `WARNING: ${message}. Gate will not validate the declared RLS baseline for status/apply.`,
    );
  }
  if (artifact.warnings.length > 0) {
    writeStdoutLine("Warnings:");
    for (const warning of artifact.warnings) {
      writeStdoutLine(`  - ${warning}`);
    }
  }
}

async function callGate<T>(options: {
  token: string;
  orgId: string;
  storeId: string;
  stage: "dev" | "prod";
  mode: "status" | "apply";
  body: unknown;
}): Promise<T> {
  const actionPath =
    options.mode === "status" ? "status" : "apply";
  return requestGateService<T>(options.token, {
    method: "POST",
    path: `/${options.orgId}/isolated-stores/${options.storeId}/stages/${options.stage}/sql/migrations/${actionPath}`,
    body: options.body,
  });
}

async function callGateRlsStatus(options: {
  token: string;
  orgId: string;
  storeId: string;
  stage: "dev" | "prod";
  schemaName?: string;
}): Promise<SqlRlsStatusResponse> {
  return requestGateService<SqlRlsStatusResponse>(options.token, {
    method: "GET",
    path: `/${options.orgId}/isolated-stores/${options.storeId}/stages/${options.stage}/sql/rls/status`,
    query:
      options.schemaName === undefined
        ? undefined
        : { schemaName: options.schemaName },
  });
}

function warnIfRuntimeDoesNotEnforceRls(status: SqlRlsStatusResponse): void {
  if (status.bypassRls !== true && status.superuser !== true) {
    return;
  }
  const currentUser = status.currentUser?.trim() || "unknown";
  const reasons = [
    ...(status.bypassRls === true ? ["bypassRls=true"] : []),
    ...(status.superuser === true ? ["superuser=true"] : []),
  ].join(", ");
  console.warn(
    `WARNING: RLS policies exist but are NOT enforced for runtime role ${currentUser} because ${reasons}. Scoped tests require a runtime role without BYPASSRLS and without superuser privileges.`,
  );
}

async function warnRuntimeRlsStatus(options: {
  token: string;
  orgId: string;
  storeId: string;
  stage: "dev" | "prod";
  schemaName?: string;
}): Promise<void> {
  try {
    const rlsStatus = await callGateRlsStatus(options);
    warnIfRuntimeDoesNotEnforceRls(rlsStatus);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Warning: Could not check RLS runtime status after apply: ${message}`);
  }
}

const sqlBundleCommand = new Command("bundle")
  .description(
    "Build an isolated SQL migration bundle and optional RLS manifest from app files",
  )
  .requiredOption("--app <appId>", "App id from fusebase.json apps[]")
  .option("--alias <alias>", "SQL isolated store alias from isolatedStores.sql[]")
  .option("--store-id <storeId>", "Gate store id; overrides isolatedStores.sql[].storeId")
  .option("--stage <stage>", "Stage for Gate status/apply: dev or prod", "dev")
  .option("--schema <schemaName>", "Override schemaName sent to Gate")
  .option("--json", "Print the Gate request body as JSON")
  .option("--status", "Call Gate migration status with the built body")
  .option("--rls-status", "Call Gate RLS status for the selected store/stage")
  .option("--dry-run", "Call Gate apply with dryRun:true")
  .option("--apply", "Apply pending migrations through Gate")
  .option("--yes", "Confirm --apply")
  .action(async (options: SqlBundleOptions) => {
    const stage = options.stage === "prod" ? "prod" : "dev";
    const artifact = readArtifact({ ...options, stage });
    const includeRlsManifest = hasFlag(ISOLATED_SQL_RLS_FLAG);
    const requestBody = buildGateRequestBody(
      artifact,
      options.schema,
      includeRlsManifest,
    );

    if (options.json === true) {
      writeStdoutLine(JSON.stringify(requestBody, null, 2));
      return;
    }

    printSummary(artifact, includeRlsManifest);

    const shouldCallGate =
      options.status === true ||
      options.rlsStatus === true ||
      options.dryRun === true ||
      options.apply === true;
    if (!shouldCallGate) {
      return;
    }

    const { fuseConfig } = resolveAppConfig(options.app);
    const storeId = options.storeId ?? artifact.store.storeId;
    if (storeId === undefined || storeId.trim().length === 0) {
      throw new Error("Missing store id. Set isolatedStores.sql[].storeId or pass --store-id.");
    }
    const token = await readAppGateTokenOrExit(process.cwd());

    if (options.status === true) {
      const status = await callGate({
        token,
        orgId: fuseConfig.orgId,
        storeId,
        stage,
        mode: "status",
        body: requestBody,
      });
      writeStdoutLine(JSON.stringify(status, null, 2));
    }

    if (options.rlsStatus === true) {
      const rlsStatus = await callGateRlsStatus({
        token,
        orgId: fuseConfig.orgId,
        storeId,
        stage,
        schemaName: options.schema ?? artifact.schemaName ?? undefined,
      });
      warnIfRuntimeDoesNotEnforceRls(rlsStatus);
      writeStdoutLine(JSON.stringify(rlsStatus, null, 2));
    }

    if (options.dryRun === true) {
      const dryRun = await callGate({
        token,
        orgId: fuseConfig.orgId,
        storeId,
        stage,
        mode: "apply",
        body: { ...requestBody, dryRun: true },
      });
      writeStdoutLine(JSON.stringify(dryRun, null, 2));
    }

    if (options.apply === true) {
      if (options.yes !== true) {
        throw new Error("Refusing to apply without --yes");
      }
      const apply = await callGate({
        token,
        orgId: fuseConfig.orgId,
        storeId,
        stage,
        mode: "apply",
        body: requestBody,
      });
      writeStdoutLine(JSON.stringify(apply, null, 2));
      await warnRuntimeRlsStatus({
        token,
        orgId: fuseConfig.orgId,
        storeId,
        stage,
        schemaName: options.schema ?? artifact.schemaName ?? undefined,
      });
    }
  });

const sqlCommand = new Command("sql").description("SQL isolated store helpers");
sqlCommand.addCommand(sqlBundleCommand);

export const isolatedStoreCommand = new Command("isolated-store").description(
  "Isolated store helpers",
);
isolatedStoreCommand.addCommand(sqlCommand);
