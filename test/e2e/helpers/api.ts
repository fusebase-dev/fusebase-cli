/**
 * Thin fetch wrapper over the public Fusebase API for E2E tests.
 *
 * Intentionally not a re-export of `lib/api.ts`: the CLI client reads its base
 * URL from `~/.fusebase/config.json`, while tests need to drive it from
 * `FUSEBASE_ENV` (and to keep their own credentials separate from any local
 * dev config).
 */

import type { E2eEnv } from "./env";

export interface ApiAppSummary {
  id: string;
  orgId: string;
  title: string;
  sub?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface ApiClient {
  /** GET /v1/orgs/{orgId}/apps — list apps in the test org. */
  listApps(): Promise<ApiAppSummary[]>;
  /** GET /v1/orgs/{orgId}/apps/{appId} — fetch a single app. */
  getApp(appId: string): Promise<ApiAppSummary>;
  /**
   * DELETE /v1/orgs/{orgId}/apps/{appId} — teardown endpoint added under
   * NIM-40899; cascades to Azure cleanup via NIM-40898. Treats 404 as success
   * so callers can use it idempotently.
   */
  deleteApp(appId: string): Promise<void>;
  /** Generic JSON request helper for endpoints not covered above. */
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
}

export function createApiClient(env: E2eEnv): ApiClient {
  const headers = (extra?: Record<string, string>): Record<string, string> => ({
    Authorization: `Bearer ${env.apiKey}`,
    Accept: "application/json",
    ...extra,
  });

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${env.apiBaseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: headers(body !== undefined ? { "Content-Type": "application/json" } : undefined),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
    const response = await fetch(url, init);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ApiRequestError(method, url, response.status, response.statusText, text);
    }
    if (response.status === 204) return undefined as T;
    const ct = response.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  }

  return {
    request,
    async listApps(): Promise<ApiAppSummary[]> {
      const res = await request<{ apps?: ApiAppSummary[] }>(
        "GET",
        `/v1/orgs/${encodeURIComponent(env.orgId)}/apps`,
      );
      return res.apps ?? [];
    },
    async getApp(appId: string): Promise<ApiAppSummary> {
      return request<ApiAppSummary>(
        "GET",
        `/v1/orgs/${encodeURIComponent(env.orgId)}/apps/${encodeURIComponent(appId)}`,
      );
    },
    async deleteApp(appId: string): Promise<void> {
      const url = `${env.apiBaseUrl}/v1/orgs/${encodeURIComponent(env.orgId)}/apps/${encodeURIComponent(appId)}`;
      const response = await fetch(url, { method: "DELETE", headers: headers() });
      if (response.status === 404) return;
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new ApiRequestError(
          "DELETE",
          url,
          response.status,
          response.statusText,
          text,
        );
      }
    },
  };
}

export class ApiRequestError extends Error {
  constructor(
    public readonly method: string,
    public readonly url: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly bodySnippet: string,
  ) {
    super(
      `${method} ${url} → ${status} ${statusText}${bodySnippet ? `\n${bodySnippet.slice(0, 500)}` : ""}`,
    );
    this.name = "ApiRequestError";
  }
}
