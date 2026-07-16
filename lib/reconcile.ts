import { createApp, updateApp, type App, type AppAccessPrincipal, type AppPermissions, type UpdateAppRequest } from "./api";
import {
  assertDeployableFeature,
  getConfig,
  loadFuseConfig,
  type AppSecretDeclaration,
  type FeatureConfig,
  type FuseConfig,
} from "./config";
import assert from "assert";
import { reconcileAppSecrets } from "./reconcile-secrets";
import { mergeFeaturePermissions } from "./permissions";

export type AppPlatformState = Pick<App, "title" | "accessPrincipals" | "permissions" | "path" | "id" | "sub">;

/**
 * Minimal shape `reconcileApps` needs from a platform app (from `fetchApps`).
 * Match key is the immutable local `path`; `id` is the fallback for apps created
 * before the platform tracked/returned `path`. `sub` is carried for logging only
 * (it is never changed by reconcile).
 */


export type ReconcileAction = "legacy" | "bound" | "created";

export interface ReconcileResult {
  appConfig: FeatureConfig;
  appId: string;
  action: ReconcileAction;
  platformApp: AppPlatformState;
}

interface CreateAppFnParams {
  title: string,
  subdomain: string,
  path: string,
}

/**
 * Create a platform app for a declarative entry, returning its new id. Injected
 * so `reconcileApps` stays pure/network-free and unit-testable; deploy wires the
 * real `createApp` (public-api `POST .../apps`).
 */
export type CreateAppFn = (
  title: string,
  subdomain: string,
  path: string,
) => Promise<{ id: string }>;


// Config/context are resolved at call time, never at module init: the effective
// apiKey depends on the backend and the org/product on the active environment,
// both of which are selected (e.g. via `--env` in the preAction hook) after
// this module is imported.

// Order-insensitive canonical form of access principals, for change detection.
function normalizePrincipals(principals?: AppAccessPrincipal[]): string {
  if (principals === undefined) return "";
  return JSON.stringify(
    principals
      .map((p) => ({ type: p.type, id: p.id ?? "" }))
      .sort((a, b) =>
        `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`),
      ),
  );
}

// Order-insensitive canonical form of app permissions, for change detection.
function normalizePermissions(permissions?: AppPermissions): string {
  const items = permissions?.items ?? [];
  return JSON.stringify(items.map((item) => JSON.stringify(item)).sort());
}

function createAppCreateFunction () {
  const config = getConfig();
  const fuseConfig = loadFuseConfig();
  assert(fuseConfig, "fusebase.json not found or invalid in createAppCreateFunction");

  return (title: string, subdomain: string, path: string) => createApp(
    config.apiKey!,
    fuseConfig.orgId,
    fuseConfig.productId,
    title,
    subdomain,
    path,
  )
}

export async function reconcileAppsEnsureAppsExist (
  appConfigs: FeatureConfig[],
  platformApps: AppPlatformState[],
  createFn: CreateAppFn = createAppCreateFunction(),
): Promise<ReconcileResult[]> {
  const seenPaths = new Set<string>();
  for (const decl of appConfigs) {
    // Surfaces the guiding deployability error before any create.
    assertDeployableFeature(decl);
    if (decl.path) {
      if (seenPaths.has(decl.path)) {
        throw new Error(
          `fusebase.json: duplicate app path "${decl.path}" — ` +
            `each app needs a unique path.`,
        );
      }
      seenPaths.add(decl.path);
    }
  }

  const byPath = new Map<string, AppPlatformState>();
  const byId = new Map<string, AppPlatformState>();
  for (const app of platformApps) {
    if (app.path) byPath.set(app.path, app);
    byId.set(app.id, app);
  }

  const results: ReconcileResult[] = [];

  for (const decl of appConfigs) {
    // Match by immutable local path first, then fall back to a stored platform
    // id (apps created before path was tracked/returned).
    const matched =
      (decl.path ? byPath.get(decl.path) : undefined) ??
      (decl.id ? byId.get(decl.id) : undefined);
    if (matched) {
      results.push({ appConfig: decl, appId: matched.id, action: "bound", platformApp: matched });
      continue;
    }
    const created = await createFn(
      decl.name ?? decl.subdomain ?? decl.path ?? "",
      decl.subdomain ?? "",
      decl.path ?? "",
    );
    // Record so a later declaration reusing the path/id binds, not re-creates.
    const createdApp: AppPlatformState = {
      id: created.id,
      sub: decl.subdomain,
      path: decl.path ?? "",
      title: decl.name ?? ""
    };
    if (decl.path) byPath.set(decl.path, createdApp);
    byId.set(created.id, createdApp);
    results.push({ appConfig: decl, appId: created.id, action: "created", platformApp: createdApp });
  }

  return results
}

/**
 * Resolve each local app declaration to a real platform app id at deploy time
 * (NIM-41746). Per declaration:
 *  - match the immutable local `path` against `platformApps[].path` → bind
 *    (`bound`).
 *  - else match a stored platform `id` against `platformApps[].id` → bind
 *    (`bound`). This is the fallback for apps created before `path` was tracked,
 *    so an existing deploy is never duplicated.
 *  - else create the app via `createFn` (sending its declared `subdomain` and
 *    `path`) → (`created`).
 *
 * The subdomain is never changed here: once an app exists its subdomain is
 * immutable on the platform, so a subdomain edit in fusebase.json has no effect.
 *
 * In-memory only: does NOT write resolved ids back into `fusebase.json`, so the
 * manifest stays declarative. Throws on a declaration that is not deployable
 * (see `assertDeployableFeature`) and on a duplicate `path` across declarations.
 */
export async function reconcileApps(
  appConfigs: FeatureConfig[],
  platformApps: AppPlatformState[],
  createFn: CreateAppFn = createAppCreateFunction(),
): Promise<ReconcileResult[]> {
  const config = getConfig();
  const fuseConfig = loadFuseConfig();
  assert(fuseConfig, "fusebase.json not found or invalid in reconcileApps");

  const results = await reconcileAppsEnsureAppsExist(appConfigs, platformApps, createFn)
  const _platformApps = results.map(r => r.platformApp)

  // Sync each reconciled app's title/access/permissions from fusebase.json
  // to the platform, patching only fields that changed. `features` is the
  // pre-reconcile platform snapshot; an app created this run isn't in it,
  // so its server state is what `createApp` set (title only).
  const platformAppsById = new Map(_platformApps.map((a) => [a.id, a]));
  for (const target of results) {
    const platformApp: AppPlatformState | undefined =
      platformAppsById.get(target.appId) ??
      (target.action === "created"
        // if app is just created we treat it as only have title field set
        // as we don't set other fields on creation
        ? {
          title: target.appConfig.name ?? "",
          path: target.appConfig.path ?? "",
          id: target.appId
        }
        : undefined);

    await applyAppUpdates({
      apiKey: config.apiKey!,
      orgId: fuseConfig.orgId,
      productId: fuseConfig.productId,
      appId: target.appId,
      appConfig: target.appConfig,
      platformApp,
    });
  }

  for (const { appConfig, appId } of results) {
    await reconcileAppSecrets({
      apiKey: config.apiKey!,
      orgId: fuseConfig.orgId,
      productId: fuseConfig.productId,
      appId,
      declared: appConfig.secrets ?? [],
      label: appConfig.path ?? appConfig.subdomain,
    });
  }

  return results;
}

// Reconcile an app's platform state with its fusebase.json declaration, PATCHing
// only the fields that actually differ (`title`, `accessPrincipals`,
// `permissions`). Manual `permissions` are merged with the Gate SDK analyze
// snapshot (`fusebaseGateMeta.permissions`), matching legacy `app create`. A
// field the manifest does not declare (undefined) is left untouched, so deploy
// never clobbers platform-only settings. No-op when nothing changed. Best-effort:
// a failure warns but never fails the deploy.
async function applyAppUpdates(params: {
  apiKey: string;
  orgId: string;
  productId: string;
  appId: string;
  appConfig: FeatureConfig;
  platformApp: AppPlatformState | undefined;
}): Promise<void> {
  const { apiKey, orgId, productId, appId, appConfig, platformApp } = params;

  const desiredTitle = appConfig.name;
  const desiredAccess = appConfig.access;
  const desiredPermissions = mergeFeaturePermissions({
    manualPermissions: appConfig.permissions,
    gatePermissions: appConfig.fusebaseGateMeta?.permissions,
  });

  const updateRequest: UpdateAppRequest = {};
  const changed: string[] = [];

  if (desiredTitle !== undefined && desiredTitle !== platformApp?.title) {
    updateRequest.title = desiredTitle;
    changed.push("title");
  }
  if (
    desiredAccess !== undefined &&
    normalizePrincipals(desiredAccess) !==
      normalizePrincipals(platformApp?.accessPrincipals)
  ) {
    updateRequest.accessPrincipals = desiredAccess;
    changed.push("accessPrincipals");
  }
  if (
    desiredPermissions !== undefined &&
    normalizePermissions(desiredPermissions) !==
      normalizePermissions(platformApp?.permissions)
  ) {
    updateRequest.permissions = desiredPermissions;
    changed.push("permissions");
  }

  if (changed.length === 0) return;

  try {
    await updateApp(apiKey, orgId, productId, appId, updateRequest);
    console.log(`   ✓ Updated app ${appId}: ${changed.join(", ")}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `   Warning: Failed to update app ${appId}: ${message}`,
    );
  }
}

/**
 * Result of diffing declared app secrets against the platform's existing keys.
 *  - `toCreate`: declared keys not yet on the platform — registered with an
 *    EMPTY value so the human sets the real value in the UI. Never includes a
 *    key that already exists, because the platform POST overwrites the value and
 *    re-sending an existing key with `""` would wipe a UI-set value.
 *  - `undeclared`: platform keys absent from the manifest. Additive-only model
 *    (deploy warns, never deletes — deletion would also destroy a UI-set value).
 */
export interface SecretReconcilePlan {
  toCreate: AppSecretDeclaration[];
  undeclared: string[];
}

/**
 * Pure diff of declared secrets vs. the platform's current secret keys. Network
 * (fetch existing keys, POST the `toCreate` set) is done by the caller; this
 * stays testable and value-free. Deduplicates declared keys (first wins) so a
 * repeated `secret create` in fusebase.json can't POST the same key twice.
 */
export function diffAppSecrets(
  declared: AppSecretDeclaration[],
  existingKeys: string[],
): SecretReconcilePlan {
  const existing = new Set(existingKeys);
  const declaredKeys = new Set<string>();
  const toCreate: AppSecretDeclaration[] = [];
  for (const decl of declared) {
    if (declaredKeys.has(decl.key)) continue;
    declaredKeys.add(decl.key);
    if (!existing.has(decl.key)) toCreate.push(decl);
  }
  const undeclared = existingKeys.filter((k) => !declaredKeys.has(k));
  return { toCreate, undeclared };
}



/** One human-readable line per app for the deploy reconcile summary. */
export function formatReconcileLine(result: ReconcileResult): string {
  const label =
    result.appConfig.path ?? result.appConfig.subdomain ?? "";
  switch (result.action) {
    case "bound":
      return `bound ${label} → ${result.appId}`;
    case "created":
      return `created ${label} → ${result.appId}`;
    case "legacy":
      return `legacy id ${result.appId}`;
  }
}

