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

/**
 * Top-level container that an organization owns. Renamed from `App`.
 * Public API: /v1/orgs/{orgId}/products
 */
export interface Product {
  id: string;
  orgId: string;
  title: string;
  description?: string;
  sub: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProductsResponse {
  products: Product[];
}

export type AppAccessPrincipalType =
  | "user"
  | "orgRole"
  | "orgGroup"
  | "visitor";

export interface AppAccessPrincipal {
  type: AppAccessPrincipalType;
  id?: string;
}

// App permissions types
export type AppPermissionType = "dashboardView" | "database" | "gate";
export type AppResourcePermissionPrivilege = "read" | "write";
export type AppGatePermissionPrivilege = string;

export interface AppPermissionDashboardViewResource {
  dashboardId: string;
  viewId: string;
}

export interface AppPermissionDatabaseResource {
  databaseId?: string;
  databaseAlias?: string;
}

export interface AppPermissionGateResource {
  kind?: string;
  ids?: string[];
}

export interface AppDashboardViewPermissionItem {
  type: "dashboardView";
  resource: AppPermissionDashboardViewResource;
  privileges: AppResourcePermissionPrivilege[];
}

export interface AppDatabasePermissionItem {
  type: "database";
  resource: AppPermissionDatabaseResource;
  privileges: AppResourcePermissionPrivilege[];
}

export interface AppGatePermissionItem {
  type: "gate";
  resource?: AppPermissionGateResource;
  privileges: AppGatePermissionPrivilege[];
}

export type AppPermissionItem =
  | AppDashboardViewPermissionItem
  | AppDatabasePermissionItem
  | AppGatePermissionItem;

export interface AppPermissions {
  items: AppPermissionItem[];
}

/**
 * Sub-component inside a Product. Renamed from `AppFeature`.
 * Public API: /v1/orgs/{orgId}/products/{productId}/apps
 */
export interface App {
  id: string;
  orgId: string;
  productId: string;
  title: string;
  description?: string;
  sub?: string;
  path: string;
  createdAt: number;
  updatedAt: number;
  url: string;
  accessPrincipals?: AppAccessPrincipal[];
  permissions?: AppPermissions;
  manifest?: Record<string, unknown>;
}

export interface AppsResponse {
  apps: App[];
}

/**
 * App version. Renamed from `AppFeatureVersion`. Field `productId` was `appId`,
 * `appId` was `appFeatureId`.
 */
export interface AppVersion {
  id: string;
  orgId: string;
  productId: string;
  appId: string;
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

export async function fetchProducts(
  apiKey: string,
  orgId: string,
): Promise<ProductsResponse> {
  const baseUrl = getBaseUrl();
  logger.info("Fetching products for org %s using base url %s", orgId, baseUrl);
  const response = await fetch(`${baseUrl}/v1/orgs/${orgId}/products`, {
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
      endpoint: `/v1/orgs/${orgId}/products`,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url: `${baseUrl}/v1/orgs/${orgId}/products`,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to fetch products: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  return res as ProductsResponse;
}

export async function fetchProduct(
  apiKey: string,
  orgId: string,
  productId: string,
): Promise<Product> {
  const products = await fetchProducts(apiKey, orgId);
  const product = products.products.find((p) => p.id === productId);
  if (!product) {
    throw new Error(`Product not found: ${productId}`);
  }
  return product;
}

export async function fetchApp(
  apiKey: string,
  orgId: string,
  productId: string,
  appId: string,
): Promise<App> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/products/${productId}/apps/${appId}`;
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
      endpoint: `/v1/orgs/${orgId}/products/${productId}/apps/${appId}`,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to fetch app: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  return res as App;
}

export async function fetchApps(
  apiKey: string,
  orgId: string,
  productId: string,
): Promise<AppsResponse> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/products/${productId}/apps`;
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
      endpoint: `/v1/orgs/${orgId}/products/${productId}/apps`,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to fetch apps: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  return res as AppsResponse;
}

export interface AppTokenResponse {
  token: string;
}

export async function fetchAppToken(
  apiKey: string,
  orgId: string,
  productId: string,
  appId: string,
  options?: { short?: boolean },
): Promise<AppTokenResponse> {
  const baseUrl = getBaseUrl();
  const startTime = Date.now();
  let url = `${baseUrl}/v1/orgs/${orgId}/products/${productId}/apps/${appId}/tokens`;
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
      `Failed to fetch app token: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  const took = Date.now() - startTime;

  if (took > 1000) {
    logger.warn(
      `⚠️  Slow response from fetchAppToken POST ${url}: ${took}ms for app ${appId}`,
    );
  }

  return res as AppTokenResponse;
}

export async function createAppVersion(
  apiKey: string,
  orgId: string,
  productId: string,
  appId: string,
): Promise<AppVersion> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/products/${productId}/apps/${appId}/versions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: `/v1/orgs/${orgId}/products/${productId}/apps/${appId}/versions`,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to create app version: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  return res as AppVersion;
}

export async function createProduct(
  apiKey: string,
  orgId: string,
  title: string,
  sub?: string,
): Promise<Product> {
  const baseUrl = getBaseUrl();
  const response = await fetch(`${baseUrl}/v1/orgs/${orgId}/products`, {
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
      endpoint: `/v1/orgs/${orgId}/products`,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url: `${baseUrl}/v1/orgs/${orgId}/products`,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to create product: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  return res as Product;
}

export async function createApp(
  apiKey: string,
  orgId: string,
  productId: string,
  title: string,
  sub: string,
): Promise<App> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/products/${productId}/apps`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, path: "", sub }),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: `/v1/orgs/${orgId}/products/${productId}/apps`,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to create app: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  return res as App;
}

export interface UpdateAppRequest {
  title?: string;
  accessPrincipals?: AppAccessPrincipal[];
  permissions?: AppPermissions;
  manifest?: Record<string, unknown>;
}

export async function updateApp(
  apiKey: string,
  orgId: string,
  productId: string,
  appId: string,
  updates: UpdateAppRequest,
): Promise<App> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/products/${productId}/apps/${appId}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      name?: string;
    };

    logger.error({
      msg: "API request failed",
      endpoint: `/v1/orgs/${orgId}/products/${productId}/apps/${appId}`,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to update app: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  const res = await response.json();

  return res as App;
}

export async function initUpload(
  apiKey: string,
  orgId: string,
  productId: string,
  appId: string,
  versionId: string,
  files: string[],
  frontendHash?: string,
): Promise<InitUploadResponse> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/products/${productId}/apps/${appId}/versions/${versionId}/init-upload`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(frontendHash ? { files, frontendHash } : { files }),
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
      `Failed to fetch dashboard info: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
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
      url: `${baseUrl}/v1/databases/${databaseId}`,
      timestamp: new Date().toISOString(),
    });

    throw new Error(
      `Failed to fetch database info: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
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
  productId: string;
  appId: string;
  appVersionId: string;
  status: DeployStatus;
  log?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ActiveVersionResponse {
  id?: number;
  globalId?: string;
  orgId?: string;
  productId?: string;
  appId?: string;
  userId?: number;
  deployFqdn?: string;
  s3Path?: string;
  backendHash?: string;
  frontendHash?: string;
  createdAt?: number;
  updatedAt?: number;
}

export async function getActiveVersion(
  apiKey: string,
  orgId: string,
  productId: string,
  appId: string,
): Promise<ActiveVersionResponse> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/products/${productId}/apps/${appId}/active-version`;
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
  productId: string,
  appId: string,
  versionId: string,
  backendHash?: string,
): Promise<InitSourceUploadResponse> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/products/${productId}/apps/${appId}/versions/${versionId}/init-source-upload`;
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
  /**
   * Whitelisted app secrets to inject as env vars into the sidecar container.
   * Wire format is always-object — apps-cli normalizes string config entries
   * (`"KEY"`) to `{from: "KEY", as: "KEY"}` at the deploy mapper boundary
   * before sending. The static `env` overrides secret values on key conflict
   * (resolved server-side in nimbus-ai).
   */
  secrets?: Array<{ from: string; as: string }>;
}

export interface DeployJobDefinition {
  name: string;
  type: "cron";
  cron: string;
  command: string;
  sidecars?: DeploySidecarDefinition[];
}

export async function createDeploy(
  apiKey: string,
  orgId: string,
  productId: string,
  appId: string,
  versionId: string,
  jobs?: DeployJobDefinition[],
  sidecars?: DeploySidecarDefinition[],
): Promise<Deploy> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/products/${productId}/apps/${appId}/versions/${versionId}/deploy`;

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
  const url = `${baseUrl}/v1/orgs/${orgId}/deploys/${deployId}/by-product`;
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
  const url = `${baseUrl}/v1/orgs/${orgId}/versions/${targetVersionId}/copy-backend-params/by-product`;
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

export async function copyFrontendParams(
  apiKey: string,
  orgId: string,
  targetVersionId: string,
  sourceVersionId: string,
): Promise<void> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/versions/${targetVersionId}/copy-frontend-params/by-product`;
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
      endpoint: "copyFrontendParams",
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url,
    });

    throw new Error(
      `Failed to copy frontend params: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }
}

// ---------------------------------------------------------------------------
// App Secrets
// ---------------------------------------------------------------------------

export interface AppSecretInput {
  key: string;
  value: string;
  description?: string;
}

export interface AppSecret {
  key: string;
  value: string;
  description?: string;
}

export interface AppSecretsResponse {
  secrets: AppSecret[];
}

export async function setAppSecrets(
  apiKey: string,
  orgId: string,
  productId: string,
  appId: string,
  secrets: AppSecretInput[],
): Promise<AppSecretsResponse> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/products/${productId}/apps/${appId}/secrets`;
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
      `Failed to set app secrets: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  return (await response.json()) as AppSecretsResponse;
}

export async function fetchAppSecrets(
  apiKey: string,
  orgId: string,
  productId: string,
  appId: string,
): Promise<AppSecretsResponse> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/products/${productId}/apps/${appId}/secrets`;
  logger.info("Fetching secrets for app %s", appId);
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
      `Failed to fetch app secrets: ${response.status} ${response.statusText}${errorBody.message ? ` - ${errorBody.message}` : ""}`,
    );
  }

  return (await response.json()) as AppSecretsResponse;
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

/**
 * A single aggregated runtime log line. Emitted by Container Apps Console/System
 * log shipping; aggregated across the backend, sidecars, and jobs of an app.
 */
export interface RuntimeLogEntry {
  /** ISO 8601 timestamp; empty string when the source line had no parseable timestamp. */
  timestamp: string;
  /** `backend`, `sidecar:<container>`, or `job:<container-app>`. */
  source: string;
  /** Log line text. Empty string for system rows that have no message body. */
  message: string;
}

export interface RuntimeLogsResponse {
  logs: RuntimeLogEntry[];
  tail: number;
  type: RuntimeLogType;
  deployId: string;
  /** Resolved inclusive lower bound of the log time window (ISO 8601). */
  from: string;
  /** Resolved inclusive upper bound of the log time window (ISO 8601). */
  to: string;
}

/**
 * Get build logs for an app (uses the latest deployed version).
 */
export async function getBuildLogsByApp(
  apiKey: string,
  orgId: string,
  appId: string,
): Promise<BuildLogsResponse> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/build-logs`;

  logger.debug("Fetching build logs for app %s", appId);

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
      endpoint: "getBuildLogsByApp",
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
 * Get build logs for a specific app version.
 */
export async function getBuildLogsByVersion(
  apiKey: string,
  orgId: string,
  versionId: string,
): Promise<BuildLogsResponse> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/versions/${versionId}/build-logs/by-product`;

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
  /** Inclusive lower bound of the log time window (ISO 8601). Default server-side: `to - 1h`. */
  from?: string;
  /** Inclusive upper bound of the log time window (ISO 8601). Default server-side: now. */
  to?: string;
}

/**
 * Get runtime logs for an app from Azure Container Apps.
 */
export async function getRuntimeLogsByApp(
  apiKey: string,
  orgId: string,
  appId: string,
  options?: GetRuntimeLogsOptions,
): Promise<RuntimeLogsResponse> {
  const baseUrl = getBaseUrl();
  const params = new URLSearchParams();
  if (options?.tail !== undefined) params.set("tail", String(options.tail));
  if (options?.type) params.set("type", options.type);
  if (options?.from) params.set("from", options.from);
  if (options?.to) params.set("to", options.to);

  const queryString = params.toString();
  const url = `${baseUrl}/v1/orgs/${orgId}/apps/${appId}/runtime-logs${queryString ? `?${queryString}` : ""}`;

  logger.debug("Fetching runtime logs for app %s", appId);

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
      endpoint: "getRuntimeLogsByApp",
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
 * Get runtime logs for a specific app version from Azure Container Apps.
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
  if (options?.from) params.set("from", options.from);
  if (options?.to) params.set("to", options.to);

  const queryString = params.toString();
  const url = `${baseUrl}/v1/orgs/${orgId}/versions/${versionId}/runtime-logs/by-product${queryString ? `?${queryString}` : ""}`;

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
  productId: string,
  body: { codingAgent?: string; model?: string; appId?: string },
): Promise<void> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/orgs/${orgId}/products/${productId}/coding-stats`;
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
      msg: "Failed to send coding stats",
      endpoint: url,
      status: response.status,
      statusText: response.statusText,
      errorBody,
    });
  }
}
