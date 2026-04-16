import { getEnv } from "./config";
import { logger } from "./logger";

/** Public API base URL (Fusebase HTTP API). */
export const getBaseUrl = (): string => {
  const env = getEnv();
  let url = "";
  if (env === "dev") {
    url = "https://public-api.dev-thefusebase.com";
  } else if (env === "prod") {
    url = "https://public-api.thefusebase.com";
  } else if (env === "local") {
    url = "http://localhost:3000";
  } else {
    throw new Error(`Unknown environment in ~/.fusebase/config.json: ${env}`);
  }

  logger.debug("Getting base url for env %s: %s", env, url);

  return url;
};

export interface Organization {
  id: string;
  title: string;
  domain: string | null;
  sub: string;
}

export interface OrganizationDetails extends Organization {
  effectiveDomain: string;
}

export interface OrganizationsResponse {
  organizations: Organization[];
}

export interface App {
  id: string;
  orgId: string;
  title: string;
  description?: string;
  sub: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppsResponse {
  apps: App[];
}

export type AppFeatureAccessPrincipalType =
  | "user"
  | "orgRole"
  | "orgGroup"
  | "visitor";

export interface AppFeatureAccessPrincipal {
  type: AppFeatureAccessPrincipalType;
  id?: string;
}

// Feature permissions types
export type AppFeaturePermissionType = "dashboardView" | "database" | "gate";
export type AppFeatureResourcePermissionPrivilege = "read" | "write";
export type AppFeatureGatePermissionPrivilege = string;

export interface AppFeaturePermissionDashboardViewResource {
  dashboardId: string;
  viewId: string;
}

export interface AppFeaturePermissionDatabaseResource {
  databaseId?: string;
  databaseAlias?: string;
}

export interface AppFeaturePermissionGateResource {
  kind?: string;
  ids?: string[];
}

export interface AppFeatureDashboardViewPermissionItem {
  type: "dashboardView";
  resource: AppFeaturePermissionDashboardViewResource;
  privileges: AppFeatureResourcePermissionPrivilege[];
}

export interface AppFeatureDatabasePermissionItem {
  type: "database";
  resource: AppFeaturePermissionDatabaseResource;
  privileges: AppFeatureResourcePermissionPrivilege[];
}

export interface AppFeatureGatePermissionItem {
  type: "gate";
  resource?: AppFeaturePermissionGateResource;
  privileges: AppFeatureGatePermissionPrivilege[];
}

export type AppFeaturePermissionItem =
  | AppFeatureDashboardViewPermissionItem
  | AppFeatureDatabasePermissionItem
  | AppFeatureGatePermissionItem;

export interface AppFeaturePermissions {
  items: AppFeaturePermissionItem[];
}

export interface AppFeature {
  id: string;
  orgId: string;
  appId: string;
  title: string;
  description?: string;
  sub?: string;
  path: string;
  createdAt: number;
  updatedAt: number;
  url: string;
  accessPrincipals?: AppFeatureAccessPrincipal[];
  permissions?: AppFeaturePermissions;
}

export interface AppFeaturesResponse {
  features: AppFeature[];
}

export interface AppFeatureVersion {
  id: string;
  orgId: string;
  appId: string;
  appFeatureId: string;
  s3Path: string;
  createdAt: number;
  updatedAt: number;
}

export interface UploadInfo {
  path: string;
  uploadUrl: string;
}

export interface InitUploadResponse {
  uploads: UploadInfo[];
}

// Token types
export type ScopeType = "org" | "client";

export interface Scope {
  scope_type: ScopeType;
  scope_id: string;
}

export interface ResourceScopeRule {
  databases: string[];
  dashboards: string[];
  views: string[];
}

export interface ResourceScope {
  allow?: ResourceScopeRule[];
  deny?: ResourceScopeRule[];
}

export interface CreateTokenRequest {
  scopes: Scope[];
  permissions: string[];
  resource_scope: ResourceScope;
  name?: string;
  expiresAt?: string;
}

export interface CreateTokenData {
  token: string;
  id: string;
  name?: string | null;
  permissions: string[];
  expiresAt?: string | null;
  createdAt: string;
}

export interface CreateTokenResponse {
  data: CreateTokenData;
}

export async function fetchOrgs(
  apiKey: string,
): Promise<OrganizationsResponse> {
  const baseUrl = getBaseUrl();
  logger.info("Fetching organizations using base url %s", baseUrl);
  const response = await fetch(`${baseUrl}/v1/orgs`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: "/v1/orgs",
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url: `${baseUrl}/v1/orgs`,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to fetch organizations: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  return res as OrganizationsResponse;
}

export async function fetchOrg(
  apiKey: string,
  orgId: string,
): Promise<OrganizationDetails> {
  const baseUrl = getBaseUrl();
  logger.info("Fetching org %s using base url %s", orgId, baseUrl);
  const response = await fetch(
    `${baseUrl}/v1/orgs/${encodeURIComponent(orgId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: `/v1/orgs/${orgId}`,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url: `${baseUrl}/v1/orgs/${orgId}`,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to fetch organization: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  return res as OrganizationDetails;
}

export async function fetchApps(
  apiKey: string,
  orgId: string,
): Promise<AppsResponse> {
  const baseUrl = getBaseUrl();
  logger.info("Fetching apps for org %s using base url %s", orgId, baseUrl);
  const response = await fetch(`${baseUrl}/v1/orgs/${orgId}/apps`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: `/v1/orgs/${orgId}/apps`,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url: `${baseUrl}/v1/orgs/${orgId}/apps`,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to fetch apps: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  return res as AppsResponse;
}

export async function fetchApp(
  apiKey: string,
  orgId: string,
  appId: string,
): Promise<App> {
  const apps = await fetchApps(apiKey, orgId);
  const app = apps.apps.find((a) => a.id === appId);
  if (!app) {
    throw new Error(`App not found: ${appId}`);
  }
  return app;
}

export async function fetchAppFeature(
  apiKey: string,
  orgId: string,
  appId: string,
  featureId: string,
): Promise<AppFeature> {
  const baseUrl = getBaseUrl();
  const response = await fetch(
    `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/features/${featureId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: `/v1/orgs/${orgId}/apps/${appId}/features/${featureId}`,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url: `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/features/${featureId}`,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to fetch app feature: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  return res as AppFeature;
}

export async function fetchAppFeatures(
  apiKey: string,
  orgId: string,
  appId: string,
): Promise<AppFeaturesResponse> {
  const baseUrl = getBaseUrl();
  const response = await fetch(
    `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/features`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: `/v1/orgs/${orgId}/apps/${appId}/features`,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url: `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/features`,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to fetch app features: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  return res as AppFeaturesResponse;
}

export interface FeatureTokenResponse {
  token: string;
}

export async function fetchFeatureToken(
  apiKey: string,
  orgId: string,
  appId: string,
  featureId: string,
  options?: { short?: boolean },
): Promise<FeatureTokenResponse> {
  const baseUrl = getBaseUrl();
  const startTime = Date.now();
  let url = `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/features/${featureId}/tokens`;
  if (options?.short) {
    url += "?short=true";
  }
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    logger.error({
      msg: "API request failed",
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to fetch feature token: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  const took = Date.now() - startTime;

  if (took > 1000) {
    logger.warn(
      `⚠️  Slow response from fetchFeatureToken POST ${url}: ${took}ms for feature ${featureId}`,
    );
  }

  return res as FeatureTokenResponse;
}

export async function createAppFeatureVersion(
  apiKey: string,
  orgId: string,
  appId: string,
  appFeatureId: string,
): Promise<AppFeatureVersion> {
  const baseUrl = getBaseUrl();
  const response = await fetch(
    `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/features/${appFeatureId}/versions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    },
  );

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: `/v1/orgs/${orgId}/apps/${appId}/features/${appFeatureId}/versions`,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url: `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/features/${appFeatureId}/versions`,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to create feature version: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  return res as AppFeatureVersion;
}

export async function createApp(
  apiKey: string,
  orgId: string,
  title: string,
  sub?: string,
): Promise<App> {
  const baseUrl = getBaseUrl();
  const response = await fetch(`${baseUrl}/v1/orgs/${orgId}/apps`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, ...(sub && { sub }) }),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: `/v1/orgs/${orgId}/apps`,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url: `${baseUrl}/v1/orgs/${orgId}/apps`,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to create app: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  return res as App;
}

export async function createAppFeature(
  apiKey: string,
  orgId: string,
  appId: string,
  title: string,
  sub: string,
): Promise<AppFeature> {
  const baseUrl = getBaseUrl();
  const response = await fetch(
    `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/features`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, path: "", sub }),
    },
  );

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: `/v1/orgs/${orgId}/apps/${appId}/features`,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url: `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/features`,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to create app feature: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  return res as AppFeature;
}

export interface UpdateAppFeatureRequest {
  title?: string;
  accessPrincipals?: AppFeatureAccessPrincipal[];
  permissions?: AppFeaturePermissions;
}

export async function updateAppFeature(
  apiKey: string,
  orgId: string,
  appId: string,
  featureId: string,
  updates: UpdateAppFeatureRequest,
): Promise<AppFeature> {
  const baseUrl = getBaseUrl();
  const response = await fetch(
    `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/features/${featureId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    },
  );

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: `/v1/orgs/${orgId}/apps/${appId}/features/${featureId}`,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url: `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/features/${featureId}`,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to update app feature: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  return res as AppFeature;
}

export async function initUpload(
  apiKey: string,
  orgId: string,
  appId: string,
  appFeatureId: string,
  versionId: string,
  files: string[],
): Promise<InitUploadResponse> {
  const baseUrl = getBaseUrl();
  const response = await fetch(
    `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/features/${appFeatureId}/versions/${versionId}/init-upload`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ files }),
    },
  );

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: `/v1/orgs/${orgId}/apps/${appId}/features/${appFeatureId}/versions/${versionId}/init-upload`,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url: `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/features/${appFeatureId}/versions/${versionId}/init-upload`,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to initialize upload: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  return res as InitUploadResponse;
}

// ---------------------------------------------------------------------------
// Dashboards and Databases Data
// ---------------------------------------------------------------------------

// Simplified DatabaseApi from dashboard sdk
export interface DatabaseApi {
  global_id: string;
  alias?: string | null;
  title: string;
  is_public?: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date | null;
  dashboards?: Array<{
    global_id: string;
    database_id?: string | null;
    name: string;
    alias?: string | null;
    is_public?: boolean;
    views_count?: number;
  }>;
}

// Simplified DashboardApi from dashboard sdk
export interface DashboardApi {
  global_id: string;
  database_id?: string | null;
  name: string;
  alias?: string | null;
  is_public?: boolean;
  views_count?: number;
  template_id?: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date | null;
  database?: {
    global_id: string;
    alias?: string | null;
    title: string;
    is_public?: boolean;
  };
}

export async function fetchDashboardInfo(
  apiKey: string,
  dashboardId: string,
): Promise<DashboardApi> {
  const baseUrl = getBaseUrl();
  const response = await fetch(`${baseUrl}/v1/dashboards/${dashboardId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: `/v1/dashboards/${dashboardId}`,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url: `${baseUrl}/v1/dashboards/${dashboardId}`,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to fetch app features: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  return res as DashboardApi;
}

export async function fetchDatabaseInfo(
  apiKey: string,
  databaseId: string,
): Promise<DatabaseApi> {
  const baseUrl = getBaseUrl();
  const response = await fetch(`${baseUrl}/v1/databases/${databaseId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: `/v1/databases/${databaseId}`,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url: `${baseUrl}/v1/dashboards/${databaseId}`,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to fetch app features: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  return res as DatabaseApi;
}

// ---------------------------------------------------------------------------
// Fullstack deploy types & functions
// ---------------------------------------------------------------------------

export type DeployStatus = "in_progress" | "failed" | "finished";

export interface InitSourceUploadResponse {
  uploadUrl: string;
}

export interface Deploy {
  id: string;
  orgId: string;
  appId: string;
  appFeatureId: string;
  appFeatureVersionId: string;
  status: DeployStatus;
  log?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ActiveVersionResponse {
  id?: number;
  globalId?: string;
  orgId?: string;
  appId?: string;
  appFeatureId?: string;
  userId?: number;
  deployFqdn?: string;
  s3Path?: string;
  backendHash?: string;
  createdAt?: number;
  updatedAt?: number;
}

export async function getActiveVersion(
  apiKey: string,
  orgId: string,
  appId: string,
  appFeatureId: string,
): Promise<ActiveVersionResponse> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/features/${appFeatureId}/active-version`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: "getActiveVersion",
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url,
    });

    throw new Error(
      `Failed to get active backend version: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  return (await response.json()) as ActiveVersionResponse;
}

export async function initSourceUpload(
  apiKey: string,
  orgId: string,
  appId: string,
  appFeatureId: string,
  versionId: string,
  backendHash?: string,
): Promise<InitSourceUploadResponse> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/features/${appFeatureId}/versions/${versionId}/init-source-upload`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(backendHash ? { backendHash } : {}),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: "init-source-upload",
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url,
    });

    throw new Error(
      `Failed to init source upload: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  return (await response.json()) as InitSourceUploadResponse;
}

export interface DeploySidecarDefinition {
  name: string;
  image: string;
  port?: number;
  env?: Array<{ key: string; value: string }>;
  tier?: "small" | "medium" | "large";
}

export async function createDeploy(
  apiKey: string,
  orgId: string,
  appId: string,
  appFeatureId: string,
  versionId: string,
  jobs?: Array<{ name: string; type: "cron"; cron: string; command: string }>,
  sidecars?: DeploySidecarDefinition[],
): Promise<Deploy> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/features/${appFeatureId}/versions/${versionId}/deploy`;

  const body: Record<string, unknown> = { jobs: jobs ?? [] };
  if (sidecars && sidecars.length > 0) {
    body.sidecars = sidecars;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: "deploy",
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url,
    });

    throw new Error(
      `Failed to create deploy: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  return (await response.json()) as Deploy;
}

export async function getDeploy(
  apiKey: string,
  orgId: string,
  deployId: string,
): Promise<Deploy> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/deploys/${deployId}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: "getDeploy",
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url,
    });

    throw new Error(
      `Failed to get deploy: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  return (await response.json()) as Deploy;
}

export async function copyBackendParams(
  apiKey: string,
  orgId: string,
  targetVersionId: string,
  sourceVersionId: string,
): Promise<void> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/versions/${targetVersionId}/copy-backend-params`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sourceVersionId }),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: "copyBackendParams",
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url,
    });

    throw new Error(
      `Failed to copy backend params: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }
}

// ---------------------------------------------------------------------------
// App Feature Secrets
// ---------------------------------------------------------------------------

export interface AppFeatureSecretInput {
  key: string;
  value: string;
  description?: string;
}

export interface AppFeatureSecret {
  key: string;
  value: string;
  description?: string;
}

export interface AppFeatureSecretsResponse {
  secrets: AppFeatureSecret[];
}

export async function setAppFeatureSecrets(
  apiKey: string,
  orgId: string,
  appId: string,
  appFeatureId: string,
  secrets: AppFeatureSecretInput[],
): Promise<AppFeatureSecretsResponse> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/features/${appFeatureId}/secrets`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ secrets }),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: url,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to set app feature secrets: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  return (await response.json()) as AppFeatureSecretsResponse;
}

export async function fetchAppFeatureSecrets(
  apiKey: string,
  orgId: string,
  appId: string,
  appFeatureId: string,
): Promise<AppFeatureSecretsResponse> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/features/${appFeatureId}/secrets`;
  logger.info("Fetching secrets for feature %s", appFeatureId);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: url,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to fetch app feature secrets: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  return (await response.json()) as AppFeatureSecretsResponse;
}

const MAX_API_ERROR_BODY_CHARS = 6000;

/** Full response body for failed HTTP responses (JSON pretty-printed when possible). */
async function readFailedResponseBodySnippet(
  response: Response,
): Promise<string> {
  const raw = await response.text();
  const trimmed = raw.trim();
  if (!trimmed) {
    return "(empty response body)";
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const serialized =
      typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
    return serialized.length > MAX_API_ERROR_BODY_CHARS
      ? `${serialized.slice(0, MAX_API_ERROR_BODY_CHARS)}…`
      : serialized;
  } catch {
    return trimmed.length > MAX_API_ERROR_BODY_CHARS
      ? `${trimmed.slice(0, MAX_API_ERROR_BODY_CHARS)}…`
      : trimmed;
  }
}

export async function createDashboardsToken(
  apiKey: string,
  request: CreateTokenRequest,
): Promise<CreateTokenResponse> {
  const baseUrl = getBaseUrl();
  logger.info("Creating dashboards token using base url %s", baseUrl);
  const response = await fetch(`${baseUrl}/v1/tokens/dashboards`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const bodySnippet = await readFailedResponseBodySnippet(response);

    logger.error({
      msg: "API request failed",
      endpoint: "/v1/tokens/dashboards",
      status: response.status,
      statusText: response.statusText,
      bodySnippet,
      url: `${baseUrl}/v1/tokens/dashboards`,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to create dashboards token: ${response.status} ${response.statusText}\n${bodySnippet}`,
    );
  }

  const res = await response.json();

  return res as CreateTokenResponse;
}

/** Gate MCP token creation (public API: `POST /v1/tokens/gate`). */
export async function createGateToken(
  apiKey: string,
  request: CreateTokenRequest,
): Promise<CreateTokenResponse> {
  const baseUrl = getBaseUrl();
  logger.info("Creating Gate MCP token using base url %s", baseUrl);
  const response = await fetch(`${baseUrl}/v1/tokens/gate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const bodySnippet = await readFailedResponseBodySnippet(response);

    logger.error({
      msg: "API request failed",
      endpoint: "/v1/tokens/gate",
      status: response.status,
      statusText: response.statusText,
      bodySnippet,
      url: `${baseUrl}/v1/tokens/gate`,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to create Gate MCP token: ${response.status} ${response.statusText}\n${bodySnippet}`,
    );
  }

  const res = await response.json();

  return res as CreateTokenResponse;
}

/** Public API: `POST /v1/gate/resolve-operation-permissions` */
export interface ResolveGateOperationPermissionsRequestBody {
  operations: string[];
}

export interface ResolveGateOperationPermissionsData {
  permissions: string[];
  operations: unknown[];
  missing: string[];
}

export interface ResolveGateOperationPermissionsResponse {
  success: boolean;
  message: string | null;
  data: ResolveGateOperationPermissionsData;
}

export async function resolveGateOperationPermissions(
  apiKey: string,
  operations: string[],
): Promise<ResolveGateOperationPermissionsResponse> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/gate/resolve-operation-permissions`;
  logger.info(
    "Resolving Gate operation permissions using base url %s",
    baseUrl,
  );
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      operations,
    } as ResolveGateOperationPermissionsRequestBody),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: "/v1/gate/resolve-operation-permissions",
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to resolve Gate operation permissions: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  return (await response.json()) as ResolveGateOperationPermissionsResponse;
}

export interface UploadUrlEntry {
  path: string;
  uploadUrl: string;
}

export interface GetUploadUrlsResponse {
  s3Path: string;
  uploadUrls: UploadUrlEntry[];
}

export async function getCliErrorReportUploadUrls(
  apiKey: string | undefined,
  body: { orgId?: string; files: string[] },
): Promise<GetUploadUrlsResponse> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/cli-error-reports/upload-urls`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to get upload URLs: ${response.status} ${response.statusText}: ${text}`,
    );
  }

  return (await response.json()) as GetUploadUrlsResponse;
}

export interface SubmitCliErrorReportRequest {
  errorMessage: string;
  stackTrace?: string;
  requestUrl?: string;
  cliVersion?: string;
  appId?: string;
  env?: string;
  command?: string;
  s3Path: string;
  metadata?: Record<string, unknown>;
}

export async function submitCliErrorReport(
  apiKey: string | undefined,
  orgId: string,
  body: SubmitCliErrorReportRequest,
): Promise<void> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/cli-error-reports`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, orgId }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `submitCliErrorReport failed: ${response.status} ${response.statusText}: ${text}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Remote Logs (Build & Runtime)
// ---------------------------------------------------------------------------

export type RuntimeLogType = "console" | "system";

export interface BuildLogsResponse {
  log?: string;
  status: DeployStatus;
  deployId: string;
}

export interface RuntimeLogsResponse {
  logs: string;
  tail: number;
  type: RuntimeLogType;
  deployId: string;
}

/**
 * Get build logs for an app feature (uses the latest deployed version).
 */
export async function getBuildLogsByFeature(
  apiKey: string,
  orgId: string,
  featureId: string,
): Promise<BuildLogsResponse> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/features/${featureId}/build-logs`;

  logger.debug("Fetching build logs for feature %s", featureId);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: "getBuildLogsByFeature",
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url,
    });

    throw new Error(
      `Failed to get build logs: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  return (await response.json()) as BuildLogsResponse;
}

/**
 * Get build logs for a specific app feature version.
 */
export async function getBuildLogsByVersion(
  apiKey: string,
  orgId: string,
  versionId: string,
): Promise<BuildLogsResponse> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/versions/${versionId}/build-logs`;

  logger.debug("Fetching build logs for version %s", versionId);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: "getBuildLogsByVersion",
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url,
    });

    throw new Error(
      `Failed to get build logs: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  return (await response.json()) as BuildLogsResponse;
}

export interface GetRuntimeLogsOptions {
  tail?: number;
  type?: RuntimeLogType;
}

/**
 * Get runtime logs for an app feature from Azure Container Apps.
 */
export async function getRuntimeLogsByFeature(
  apiKey: string,
  orgId: string,
  featureId: string,
  options?: GetRuntimeLogsOptions,
): Promise<RuntimeLogsResponse> {
  const baseUrl = getBaseUrl();
  const params = new URLSearchParams();
  if (options?.tail !== undefined) params.set("tail", String(options.tail));
  if (options?.type) params.set("type", options.type);

  const queryString = params.toString();
  const url = `${baseUrl}/v1/orgs/${orgId}/features/${featureId}/runtime-logs${queryString ? `?${queryString}` : ""}`;

  logger.debug("Fetching runtime logs for feature %s", featureId);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: "getRuntimeLogsByFeature",
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url,
    });

    throw new Error(
      `Failed to get runtime logs: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  return (await response.json()) as RuntimeLogsResponse;
}

/**
 * Get runtime logs for a specific app feature version from Azure Container Apps.
 */
export async function getRuntimeLogsByVersion(
  apiKey: string,
  orgId: string,
  versionId: string,
  options?: GetRuntimeLogsOptions,
): Promise<RuntimeLogsResponse> {
  const baseUrl = getBaseUrl();
  const params = new URLSearchParams();
  if (options?.tail !== undefined) params.set("tail", String(options.tail));
  if (options?.type) params.set("type", options.type);

  const queryString = params.toString();
  const url = `${baseUrl}/v1/orgs/${orgId}/versions/${versionId}/runtime-logs${queryString ? `?${queryString}` : ""}`;

  logger.debug("Fetching runtime logs for version %s", versionId);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: "getRuntimeLogsByVersion",
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url,
    });

    throw new Error(
      `Failed to get runtime logs: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  return (await response.json()) as RuntimeLogsResponse;
}

export interface CommandLogPayload {
  command: string;
  commandArgs?: string;
  cliVersion: string;
  os: string;
  osVersion?: string;
  appId?: string;
  orgId: string;
  duration: number;
  success: boolean;
  errorMessage?: string;
  errorStackTrace?: string;
}

export async function sendCommandLog(
  apiKey: string,
  body: CommandLogPayload,
): Promise<void> {
  const baseUrl = getBaseUrl();
  const response = await fetch(`${baseUrl}/v1/cli-command-logs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
    };

    logger.error({
      msg: "Failed to send command log",
      endpoint: "/v1/cli-command-logs",
      status: response.status,
      statusText: response.statusText,
      errorBody,
    });
  }
}


export async function sendCodingStats(
  apiKey: string,
  orgId: string,
  appId: string,
  body: { codingAgent?: string; model?: string; appFeatureId?: string },
): Promise<void> {
  const baseUrl = getBaseUrl();
  const response = await fetch(
    `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/coding-stats`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
    };

    logger.error({
      msg: "Failed to send coding stats",
      endpoint: `/v1/orgs/${orgId}/apps/${appId}/coding-stats`,
      status: response.status,
      statusText: response.statusText,
      errorBody,
    });
  }
}
