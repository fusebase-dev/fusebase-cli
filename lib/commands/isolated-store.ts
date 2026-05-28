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
  dryRun?: boolean;
  apply?: boolean;
  yes?: boolean;
};

const ISOLATED_SQL_RLS_FLAG = "postgres-rls";

function readArtifact(options: SqlBundleOptions): SqlMigrationBundleArtifact {
  const fuseConfig = loadFuseConfig();
  if (fuseConfig === null) {
    throw new Error("Project is not initialized. Run 'fusebase init' first.");
  }
  const appConfig = (fuseConfig.apps ?? []).find((app) => {
    return app.id === options.app;
  });
  if (appConfig === undefined) {
    throw new Error(`App "${options.app}" not found in fusebase.json`);
  }
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
  console.log(`App: ${artifact.appId}`);
  console.log(`Store alias: ${artifact.store.alias}`);
  if (artifact.store.storeId !== undefined) {
    console.log(`Store ID: ${artifact.store.storeId}`);
  }
  console.log(`Migrations: ${artifact.bundle.migrations.length}`);
  console.log(`Bundle version: ${String(artifact.bundle.bundleVersion ?? "")}`);
  if (latest !== undefined) {
    console.log(
      `Head: v${latest.version} ${latest.name} ${latest.checksum.slice(0, 12)}...`,
    );
  }
  if (artifact.rlsManifest === null) {
    console.log("RLS manifest: none");
  } else if (includeRlsManifest) {
    console.log("RLS manifest: yes");
  } else {
    console.log(
      `RLS manifest: present but not sent (enable with: fusebase config set-flag ${ISOLATED_SQL_RLS_FLAG})`,
    );
  }
  if (artifact.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of artifact.warnings) {
      console.log(`  - ${warning}`);
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
      console.log(JSON.stringify(requestBody, null, 2));
      return;
    }

    printSummary(artifact, includeRlsManifest);

    const shouldCallGate =
      options.status === true ||
      options.dryRun === true ||
      options.apply === true;
    if (!shouldCallGate) {
      return;
    }

    const fuseConfig = loadFuseConfig();
    if (fuseConfig === null) {
      throw new Error("Project is not initialized. Run 'fusebase init' first.");
    }
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
      console.log(JSON.stringify(status, null, 2));
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
      console.log(JSON.stringify(dryRun, null, 2));
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
      console.log(JSON.stringify(apply, null, 2));
    }
  });

const sqlCommand = new Command("sql").description("SQL isolated store helpers");
sqlCommand.addCommand(sqlBundleCommand);

export const isolatedStoreCommand = new Command("isolated-store").description(
  "Isolated store helpers",
);
isolatedStoreCommand.addCommand(sqlCommand);
