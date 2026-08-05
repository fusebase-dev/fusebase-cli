/**
 * Isolated-store provisioning core (shared by `fusebase env provision-store`
 * and `fusebase deploy`).
 *
 * `fusebase deploy` creates product + apps + code but never the isolated store,
 * so a freshly-deployed environment has no database to apply migrations
 * against (Gate `listIsolatedStores` returns []). This module closes that gap:
 * for each app store it create-or-gets the Gate store, applies the app's SQL
 * migrations, verifies RLS, and records the resolved storeId into the
 * environment lockfile.
 *
 * Managed store aliases are unique per ORG, so many environments sharing one
 * backend-org would collide on the same alias. The Gate-side alias is therefore
 * env-suffixed (`<alias>-<env>`); that suffix never reaches the lockfile or app
 * code, which keep using the LOGICAL alias. The runtime overlay substitutes the
 * per-env storeId, so the app asks for its logical alias and resolves to its own
 * store.
 */

import { join } from "path";
import { createGateToken } from "./api";
import { buildGateMcpTokenRequest } from "./mcp-token-policy";
import { requestGateService, type GateServiceRequestOptions } from "./gate-api";
import {
  buildSqlMigrationBundleArtifact,
  resolveSqlStoreConfig,
} from "./isolated-sql-bundle";
import { writeEnvironmentStoreId } from "./environments";
import type { FeatureConfig } from "./config";

/** Injectable Gate transport (already bound to a token). Tests pass a fake. */
export type GateTransport = <T>(options: GateServiceRequestOptions) => Promise<T>;

export interface ProvisionAppInput {
  /** Stable app key the store is recorded under in the lockfile. */
  key: string;
  /** Full app config (path, isolatedStores.sql, …) from fusebase.json. */
  appConfig: FeatureConfig;
}

export interface ProvisionStoreOptions {
  cwd: string;
  envName: string;
  backend: "dev" | "prod" | "local";
  orgId: string;
  productId: string;
  apps: ProvisionAppInput[];
  /** Real path: mint a Gate token from this key. Ignored when `gate` is given. */
  apiKey?: string;
  /** Injected transport (tests / reuse an existing token). */
  gate?: GateTransport;
  /** Only this logical store alias. */
  alias?: string;
  /** Override the Gate-side alias suffix (default: env name). */
  aliasSuffix?: string;
  dryRun?: boolean;
  log?: (line: string) => void;
  warn?: (line: string) => void;
}

export type RlsVerdict = "ok" | "unenforced" | "no-policy" | "unknown";

export interface ProvisionStoreResult {
  appKey: string;
  logicalAlias: string;
  gateAlias: string;
  planned?: boolean;
  storeId?: string;
  created?: boolean;
  applied?: number;
  pending?: number;
  rls: RlsVerdict;
}

interface GetOrCreateStoreResponse {
  created: boolean;
  cloned: boolean;
  store: { globalId: string };
  stageInstance?: { status?: string };
}

interface SqlMigrationStatusResponse {
  appliedCount?: number;
  pendingCount?: number;
  isDrifted?: boolean;
}

interface SqlRlsStatusResponse {
  currentUser?: string;
  bypassRls?: boolean;
  superuser?: boolean;
  tableCount?: number;
  rlsEnabledCount?: number;
}

/**
 * Thrown when the env-suffixed alias is already taken in the org by a store we
 * do not own — we never touch someone else's database.
 */
export class StoreAliasCollisionError extends Error {
  constructor(
    public readonly gateAlias: string,
    public readonly orgId: string,
  ) {
    super(
      `Gate store alias "${gateAlias}" already exists in org ${orgId} under a different owner. ` +
        `Aliases are unique per org — pass --alias-suffix <suffix> to disambiguate, or target a separate org for this environment. ` +
        `(Not touching the existing store.)`,
    );
    this.name = "StoreAliasCollisionError";
  }
}

/**
 * Gate-side store alias — env-suffixed so many environments can coexist in one
 * org. The suffix never reaches the lockfile or app code.
 */
export function gateStoreAlias(
  logicalAlias: string,
  envName: string,
  override?: string,
): string {
  return `${logicalAlias}-${override ?? envName}`;
}

/**
 * Classify RLS enforcement for a freshly-migrated store. `tableCount` includes
 * the migration journal table, which is not app data — hence the -1.
 */
export function classifyRls(
  rls: SqlRlsStatusResponse,
): { verdict: RlsVerdict; dataTables: number } {
  const dataTables = Math.max(0, (rls.tableCount ?? 0) - 1);
  if (rls.bypassRls === true || rls.superuser === true) {
    return { verdict: "unenforced", dataTables };
  }
  if ((rls.rlsEnabledCount ?? 0) === 0 && dataTables > 0) {
    return { verdict: "no-policy", dataTables };
  }
  if (dataTables === 0) return { verdict: "unknown", dataTables };
  return { verdict: "ok", dataTables };
}

function makeTransport(token: string): GateTransport {
  return <T>(options: GateServiceRequestOptions) =>
    requestGateService<T>(token, options);
}

/**
 * Provision every requested app store in one environment. Idempotent:
 * get-or-create resolves an existing store and re-applying migrations is a
 * no-op when nothing is pending.
 */
export async function provisionStoresForEnvironment(
  options: ProvisionStoreOptions,
): Promise<ProvisionStoreResult[]> {
  const log = options.log ?? (() => {});
  const warn = options.warn ?? (() => {});
  if (options.backend === "local") {
    throw new Error("provision-store needs a dev or prod backend.");
  }
  const stage: "dev" | "prod" = options.backend === "prod" ? "prod" : "dev";
  const { cwd, envName, orgId, productId } = options;

  // Collect (app, store) pairs up front so a pure dry run needs no token.
  const jobs: Array<{
    key: string;
    logicalAlias: string;
    gateAlias: string;
    appConfig: FeatureConfig;
    artifact: ReturnType<typeof buildSqlMigrationBundleArtifact>;
  }> = [];
  for (const { key, appConfig } of options.apps) {
    const sqlStores = (appConfig.isolatedStores?.sql ?? []).filter(
      (s) =>
        s.alias !== undefined &&
        (options.alias === undefined || s.alias === options.alias),
    );
    for (const storeCfg of sqlStores) {
      const logicalAlias = storeCfg.alias as string;
      const store = resolveSqlStoreConfig(appConfig, logicalAlias);
      if (store === null) continue;
      const artifact = buildSqlMigrationBundleArtifact({
        appConfig,
        appBasePath: join(cwd, appConfig.path ?? ""),
        store,
      });
      jobs.push({
        key,
        logicalAlias,
        gateAlias: gateStoreAlias(logicalAlias, envName, options.aliasSuffix),
        appConfig,
        artifact,
      });
    }
  }

  const results: ProvisionStoreResult[] = [];

  if (options.dryRun) {
    for (const job of jobs) {
      log(
        `  • ${job.key}/${job.logicalAlias}: would create Gate store "${job.gateAlias}" and apply ${job.artifact.bundle.migrations.length} migration(s), then record storeId under stores["${job.logicalAlias}"].`,
      );
      results.push({
        appKey: job.key,
        logicalAlias: job.logicalAlias,
        gateAlias: job.gateAlias,
        planned: true,
        rls: "unknown",
      });
    }
    return results;
  }

  if (jobs.length === 0) return results;

  // One Gate token per environment (client = productId), carrying isolated-store
  // control + schema permissions for every app here.
  const gate =
    options.gate ??
    makeTransport(
      (
        await createGateToken(
          requireApiKey(options.apiKey),
          buildGateMcpTokenRequest(orgId, productId),
        )
      ).data.token,
    );

  for (const job of jobs) {
    // 1. create-or-get the store (idempotent; org-unique alias).
    let storeResp: GetOrCreateStoreResponse;
    try {
      storeResp = await gate<GetOrCreateStoreResponse>({
        method: "POST",
        path: `/${orgId}/isolated-stores/get-or-create`,
        body: {
          clientId: productId,
          alias: job.gateAlias,
          storeType: "sql",
          engine: "postgres",
          targetStage: stage,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("already exists in org")) {
        throw new StoreAliasCollisionError(job.gateAlias, orgId);
      }
      throw error;
    }
    const storeId = storeResp.store.globalId;
    const reqBody = {
      bundle: job.artifact.bundle,
      schemaName: job.artifact.schemaName ?? undefined,
    };

    // 2. apply migrations.
    await gate({
      method: "POST",
      path: `/${orgId}/isolated-stores/${storeId}/stages/${stage}/sql/migrations/apply`,
      body: reqBody,
    });

    // 3. verify migration status.
    const status = await gate<SqlMigrationStatusResponse>({
      method: "POST",
      path: `/${orgId}/isolated-stores/${storeId}/stages/${stage}/sql/migrations/status`,
      body: reqBody,
    });

    // 4. verify RLS enforcement.
    const rls = await gate<SqlRlsStatusResponse>({
      method: "GET",
      path: `/${orgId}/isolated-stores/${storeId}/stages/${stage}/sql/rls/status`,
      query: job.artifact.schemaName
        ? { schemaName: job.artifact.schemaName }
        : undefined,
    });

    // 5. record storeId into the lockfile under the LOGICAL alias.
    writeEnvironmentStoreId(cwd, envName, job.key, job.logicalAlias, storeId);

    const { verdict, dataTables } = classifyRls(rls);
    const drift = status.isDrifted ? " DRIFTED" : "";
    log(
      `  ✓ ${job.key}/${job.logicalAlias} → store ${storeId} (${storeResp.created ? "created" : "existing"}, alias "${job.gateAlias}")`,
    );
    log(
      `      migrations: ${status.appliedCount ?? 0} applied, ${status.pendingCount ?? 0} pending${drift}`,
    );
    if (verdict === "unenforced") {
      warn(
        `      ⚠ RLS NOT enforced for runtime role ${rls.currentUser ?? "unknown"} (bypassRls/superuser). Scoped access is not isolated.`,
      );
    } else if (verdict === "no-policy") {
      warn(
        `      ⚠ RLS enabled on 0/${dataTables} data table(s). Migrations applied but no row-level policy protects them — add RLS to your migrations/rlsManifest.`,
      );
    } else if (verdict === "ok") {
      log(
        `      RLS: ${rls.rlsEnabledCount ?? 0}/${dataTables} data table(s) protected (runtime role ${rls.currentUser ?? "?"} without bypass).`,
      );
    }

    results.push({
      appKey: job.key,
      logicalAlias: job.logicalAlias,
      gateAlias: job.gateAlias,
      storeId,
      created: storeResp.created,
      applied: status.appliedCount ?? 0,
      pending: status.pendingCount ?? 0,
      rls: verdict,
    });
  }

  return results;
}

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error("provision-store: no API key and no injected Gate transport.");
  }
  return apiKey;
}
