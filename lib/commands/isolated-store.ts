import { Command } from "commander";
import { join } from "path";
import {
  getConfig,
  getEnv,
  hasFlag,
  loadFuseConfig,
  persistResolvedAppId,
  persistResolvedStoreId,
  type FeatureConfig,
  type FuseConfig,
} from "../config";
import { fetchApps } from "../api";
import { reconcileApps } from "../reconcile";
import assert from "assert";
import { requestGateService } from "../gate-api";
import { readAppGateTokenOrExit } from "../managed-integrations";
import {
  buildSqlMigrationBundleArtifact,
  resolveSqlStoreConfig,
  type SqlMigrationBundleArtifact,
} from "../isolated-sql-bundle";
import {
  classifyRls,
  type RlsVerdict,
  type SqlRlsStatusResponse as SharedRlsStatusResponse,
} from "../provision-store";

type SqlBundleOptions = {
  app: string;
  alias?: string;
  storeId?: string;
  stage?: "dev" | "prod";
  schema?: string;
  json?: boolean;
  status?: boolean;
  rlsStatus?: boolean;
  assertRls?: boolean;
  assertMigrations?: boolean;
  dryRun?: boolean;
  apply?: boolean;
  yes?: boolean;
};

/** Migration status fields the `--assert-migrations` gate checks. */
type SqlMigrationStatusResponse = {
  appliedCount?: number;
  pendingCount?: number;
  currentVersion?: number | null;
  bundleHeadVersion?: number | null;
  isDrifted?: boolean;
  requiresBaselineAdoption?: boolean;
};

const ISOLATED_SQL_RLS_FLAG = "postgres-rls";

// An app entry has no platform `id` yet (it is assigned at deploy-time
// reconcile), so `--app` is matched by local `path` only.
const APP_OPTION_DESCRIPTION = "App path from fusebase.json apps[]";

function writeStdoutLine(text: string): void {
  process.stdout.write(`${text}\n`);
}

function resolveAppConfig(appRef: string) {
  const fuseConfig = loadFuseConfig();
  if (fuseConfig === null) {
    throw new Error("Project is not initialized. Run 'fusebase init' first.");
  }
  const appConfig = (fuseConfig.apps ?? []).find(
    (app) => app.path === appRef,
  );
  if (appConfig === undefined) {
    const known = (fuseConfig.apps ?? [])
      .map((app) => app.path)
      .filter(Boolean)
      .join(", ");
    const label = "paths";
    throw new Error(
      known.length > 0
        ? `App "${appRef}" not found in fusebase.json. Known app ${label}: ${known}`
        : `App "${appRef}" not found in fusebase.json (apps[] is empty)`,
    );
  }
  return { fuseConfig, appConfig };
}

// Shared with provisioning so the CLI and `env provision-store` classify RLS
// identically — `tableCount` matters (the migration journal is not app data).
type SqlRlsStatusResponse = SharedRlsStatusResponse;

/**
 * Human-readable reason the `--assert-rls` gate fails, or null when RLS is fine.
 */
export function describeRlsFailure(
  verdict: RlsVerdict,
  status: SqlRlsStatusResponse,
  dataTables: number,
): string | null {
  if (verdict === "unenforced") {
    const reasons = [
      ...(status.bypassRls === true ? ["bypassRls=true"] : []),
      ...(status.superuser === true ? ["superuser=true"] : []),
    ].join(", ");
    return `RLS is NOT enforced for runtime role ${status.currentUser?.trim() || "unknown"} (${reasons}). Rows are readable regardless of policy.`;
  }
  if (verdict === "no-policy") {
    return `RLS enabled on 0/${dataTables} data table(s) — the schema shipped with no row-level protection.`;
  }
  return null;
}

/**
 * Gate stage for this run. An explicit `--stage` always wins; otherwise it
 * follows the active environment's backend.
 *
 * This used to default to a hardcoded "dev", which silently pointed a
 * `FUSEBASE_ENV=prod` run at the dev stage: a store that has both stages would
 * be asserted against the wrong data and report a false OK.
 */
export function resolveStage(
  explicit: string | undefined,
  backend: string | undefined = getEnv(),
): "dev" | "prod" {
  if (explicit === "prod" || explicit === "dev") return explicit;
  return backend === "prod" ? "prod" : "dev";
}

// True when an app entry has not been deployed to the platform yet. The
// resolved `id` is written back into fusebase.json at deploy time, so an id-less
// entry reliably means "no platform app (and thus no isolated store) exists yet".
function appIsUndeployed(appConfig: FeatureConfig): boolean {
  return appConfig.id === undefined || appConfig.id.trim().length === 0;
}

// Predefined migration status for an app that isn't on the platform yet, so a
// read-only `--status` check reports a stable result instead of failing at the
// `requireAppId` build guard. `appExists: false` is the discriminator callers
// (CI) can branch on.
function buildUndeployedStatus(appConfig: FeatureConfig) {
  return {
    appExists: false,
    app: appConfig.path ?? appConfig.subdomain ?? null,
    subdomain: appConfig.subdomain ?? null,
    migrations: { applied: [], pending: [] },
    message:
      "App is not deployed on the platform yet, so its isolated store has no " +
      "migration status. Run `fusebase deploy --nocode` to provision it first.",
  };
}

// Applying migrations targets an app's isolated store, so the app must exist on
// the platform. An entry is authored with only a `path`/`subdomain` and the
// platform app may not exist yet — so reconcile it now, exactly like `fusebase
// dev` start (NIM-41996): bind the subdomain to an existing app, else create
// one, sync its declared state, persist the resolved id, and return the config
// carrying that id. Only the mutating `--apply` path calls this (creating the
// app is an unexpected side effect for read-only status/dry-run). An
// already-reconciled entry (id present) is returned untouched with no network call.
async function ensureAppExists(
  appConfig: FeatureConfig,
  fuseConfig: FuseConfig,
): Promise<FeatureConfig> {
  if (
    (appConfig.id !== undefined && appConfig.id.trim().length > 0) ||
    appConfig.subdomain === undefined ||
    appConfig.subdomain.length === 0
  ) {
    return appConfig;
  }

  const config = getConfig();
  if (config.apiKey === undefined || config.apiKey.trim().length === 0) {
    throw new Error("No API key configured. Run 'fusebase auth' first.");
  }

  const { apps: platformApps } = await fetchApps(
    config.apiKey,
    fuseConfig.orgId,
    fuseConfig.productId,
  );
  const [resolved] = await reconcileApps([appConfig], platformApps);
  assert(resolved, "Reconcile result should not be undefined");
  appConfig.id = resolved.appId;
  writeStdoutLine(
    `✓ ${resolved.action === "created" ? "Created" : "Bound"} app ${appConfig.subdomain} → ${resolved.appId}`,
  );

  // Best-effort write-back so the next run takes the id fast path — a failure
  // here must not stop the command.
  try {
    persistResolvedAppId(process.cwd(), appConfig, resolved.appId, {
      createdSubdomain:
        resolved.action === "created" ? appConfig.subdomain : undefined,
    });
  } catch {
    // ignore: the reconcile already resolved the id in-memory for this run.
  }

  return appConfig;
}

function readArtifact(
  appConfig: FeatureConfig,
  appRef: string,
  alias: string | undefined,
): SqlMigrationBundleArtifact {
  if (appConfig.path === undefined || appConfig.path.trim().length === 0) {
    throw new Error(`App "${appRef}" has no path in fusebase.json`);
  }
  const store = resolveSqlStoreConfig(appConfig, alias);
  if (store === null) {
    throw new Error(
      `App "${appRef}" has no isolatedStores.sql[] config in fusebase.json`,
    );
  }
  return buildSqlMigrationBundleArtifact({
    appConfig,
    appBasePath: join(process.cwd(), appConfig.path),
    cwd: process.cwd(),
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
  .requiredOption("--app <app>", APP_OPTION_DESCRIPTION)
  .option("--alias <alias>", "SQL isolated store alias from isolatedStores.sql[]")
  .option("--store-id <storeId>", "Gate store id; overrides isolatedStores.sql[].storeId")
  .option(
    "--stage <stage>",
    "Stage for Gate status/apply: dev or prod (default: the active environment's backend)",
  )
  .option("--schema <schemaName>", "Override schemaName sent to Gate")
  .option("--json", "Print the Gate request body as JSON")
  .option("--status", "Call Gate migration status with the built body")
  .option("--rls-status", "Call Gate RLS status for the selected store/stage")
  .option(
    "--assert-rls",
    "CI gate: exit non-zero unless RLS is enforced (policies present, runtime role without bypass/superuser)",
  )
  .option(
    "--assert-migrations",
    "CI gate: exit non-zero unless every migration is applied and the journal is not drifted",
  )
  .option("--dry-run", "Call Gate apply with dryRun:true")
  .option("--apply", "Apply pending migrations through Gate")
  .option("--yes", "Confirm --apply")
  .action(async (options: SqlBundleOptions) => {
    const stage = resolveStage(options.stage);
    const { fuseConfig, appConfig } = resolveAppConfig(options.app);

    // A read-only status check on a not-yet-deployed declarative app returns a
    // predefined "not deployed" status instead of failing the build — its
    // isolated store doesn't exist until the app is deployed.
    if (options.status === true && appIsUndeployed(appConfig)) {
      writeStdoutLine(JSON.stringify(buildUndeployedStatus(appConfig), null, 2));
      return;
    }

    // Reconcile only for `--apply`, where creating/ensuring the platform app is
    // the intended side effect of applying migrations against its isolated
    // store. Read-only paths (`--status`, `--rls-status`, `--dry-run`, `--json`,
    // summary) must not create or mutate the app; an id-less declarative entry
    // just surfaces the standard `requireAppId` "run deploy first" guidance.
    const resolvedAppConfig =
      options.apply === true
        ? await ensureAppExists(appConfig, fuseConfig)
        : appConfig;
    const artifact = readArtifact(
      resolvedAppConfig,
      options.app,
      options.alias,
    );
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

    // The assert gates are the CI-facing form of the status calls: they fetch
    // the same payload and turn "not enforced" / "not applied" into a non-zero
    // exit instead of a warning a pipeline would scroll past.
    const wantMigrationStatus =
      options.status === true || options.assertMigrations === true;
    const wantRlsStatus =
      options.rlsStatus === true || options.assertRls === true;

    const shouldCallGate =
      wantMigrationStatus ||
      wantRlsStatus ||
      options.dryRun === true ||
      options.apply === true;
    if (!shouldCallGate) {
      return;
    }

    // Collected so every failing invariant is reported in one run, rather than
    // making CI re-run to discover the next one.
    const assertionFailures: string[] = [];

    const storeId = options.storeId ?? artifact.store.storeId;
    if (storeId === undefined || storeId.trim().length === 0) {
      throw new Error("Missing store id. Set isolatedStores.sql[].storeId or pass --store-id.");
    }
    const token = await readAppGateTokenOrExit(process.cwd());

    if (wantMigrationStatus) {
      const status = await callGate<SqlMigrationStatusResponse>({
        token,
        orgId: fuseConfig.orgId,
        storeId,
        stage,
        mode: "status",
        body: requestBody,
      });
      writeStdoutLine(JSON.stringify(status, null, 2));

      if (options.assertMigrations === true) {
        const pending = status.pendingCount ?? 0;
        if (pending > 0) {
          assertionFailures.push(
            `${pending} migration(s) pending — the store schema is behind postgres/migrations/.`,
          );
        }
        if (status.isDrifted === true) {
          assertionFailures.push(
            "Migration journal is DRIFTED — an already-applied migration file changed. Do not repair checksums blindly; reconcile the file with what was applied.",
          );
        }
        if (status.requiresBaselineAdoption === true) {
          assertionFailures.push(
            "Store requires migration baseline adoption — its schema predates the journal.",
          );
        }
      }
    }

    if (wantRlsStatus) {
      const rlsStatus = await callGateRlsStatus({
        token,
        orgId: fuseConfig.orgId,
        storeId,
        stage,
        schemaName: options.schema ?? artifact.schemaName ?? undefined,
      });
      warnIfRuntimeDoesNotEnforceRls(rlsStatus);
      writeStdoutLine(JSON.stringify(rlsStatus, null, 2));

      if (options.assertRls === true) {
        const { verdict, dataTables } = classifyRls(rlsStatus);
        const failure = describeRlsFailure(verdict, rlsStatus, dataTables);
        if (failure !== null) {
          assertionFailures.push(failure);
        } else if (verdict === "unknown") {
          assertionFailures.push(
            "No data tables found in the store — nothing to protect, so RLS enforcement cannot be asserted.",
          );
        }
      }
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

      // The store this apply bound to belongs in the active env lockfile, the
      // store-id counterpart of the app-id write-back in `ensureAppExists` —
      // `--store-id` and legacy fusebase.json ids are otherwise invisible to
      // `env status` and operator tooling. Best-effort: the migrations are
      // already applied, the lockfile is only bookkeeping.
      try {
        const recorded = persistResolvedStoreId(
          process.cwd(),
          resolvedAppConfig,
          artifact.store.alias,
          storeId,
        );
        if (recorded) {
          writeStdoutLine(
            `✓ Recorded store ${artifact.store.alias} → ${storeId} in the active environment`,
          );
        }
      } catch {
        // ignore
      }

      await warnRuntimeRlsStatus({
        token,
        orgId: fuseConfig.orgId,
        storeId,
        stage,
        schemaName: options.schema ?? artifact.schemaName ?? undefined,
      });
    }

    // Assertions decide the exit code last, so the status payloads above are
    // always printed first — a failing CI job shows the evidence, not just the
    // verdict.
    if (assertionFailures.length > 0) {
      console.error(
        `\nFAILED: store contract violated for ${options.app} (alias ${artifact.store.alias}, stage ${stage}):`,
      );
      for (const failure of assertionFailures) {
        console.error(`  ✗ ${failure}`);
      }
      process.exit(1);
    }
    if (options.assertRls === true || options.assertMigrations === true) {
      const checked = [
        ...(options.assertMigrations === true ? ["migrations applied, no drift"] : []),
        ...(options.assertRls === true ? ["RLS enforced"] : []),
      ].join("; ");
      writeStdoutLine(`\n✓ Store contract OK for ${options.app} (${checked}).`);
    }
  });

const sqlCommand = new Command("sql").description("SQL isolated store helpers");
sqlCommand.addCommand(sqlBundleCommand);

export const isolatedStoreCommand = new Command("isolated-store").description(
  "Isolated store helpers",
);
isolatedStoreCommand.addCommand(sqlCommand);
