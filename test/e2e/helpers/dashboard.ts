/**
 * Dashboard read helpers. The smoke test (NIM-40901) drives the deployed
 * backend and cron job into writing rows into a pre-provisioned test
 * dashboard, then reads them back through these helpers to verify the
 * pipeline.
 *
 * The helpers here intentionally stay narrow: they only need to fetch
 * dashboard metadata and list rows. Path resolution against the public-api
 * OpenAPI spec is delegated to the {@link ApiClient.request} fallback so the
 * smoke test can pin or adjust the exact endpoint without touching the
 * harness API surface.
 */

import type { ApiClient } from "./api";
import type { E2eEnv } from "./env";

export interface DashboardSummary {
  id: string;
  name?: string;
  databaseId?: string | null;
}

export interface DashboardRow {
  id: string;
  fields: Record<string, unknown>;
  createdAt?: string | number;
  updatedAt?: string | number;
}

export interface DashboardClient {
  /** GET /v1/dashboards/{id} — verifies the dashboard exists and is readable. */
  getInfo(): Promise<DashboardSummary>;
  /**
   * Lists rows in the dashboard. The exact public-api path is configurable so
   * the smoke test can adjust to whichever shape the OpenAPI spec exposes
   * (e.g. `/v1/dashboards/{id}/rows`). Defaults to that path.
   */
  listRows(opts?: ListRowsOptions): Promise<DashboardRow[]>;
  /** Convenience: list rows and filter by an exact field value. */
  findRowsByField(field: string, value: unknown): Promise<DashboardRow[]>;
}

export interface ListRowsOptions {
  /** Override the rows path (relative to api base). */
  path?: string;
  /** Optional query string parameters. */
  query?: Record<string, string | number | boolean>;
}

export function createDashboardClient(
  api: ApiClient,
  env: E2eEnv,
): DashboardClient {
  const baseRowsPath = `/v1/dashboards/${encodeURIComponent(env.dashboardId)}/rows`;

  async function listRows(opts: ListRowsOptions = {}): Promise<DashboardRow[]> {
    const path = opts.path ?? baseRowsPath;
    const qs = opts.query
      ? "?" +
        Object.entries(opts.query)
          .map(
            ([k, v]) =>
              `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
          )
          .join("&")
      : "";
    const res = await api.request<DashboardRowsResponse>("GET", `${path}${qs}`);
    if (Array.isArray(res)) return res;
    if (Array.isArray(res?.rows)) return res.rows;
    if (Array.isArray(res?.items)) return res.items;
    return [];
  }

  return {
    listRows,
    async getInfo(): Promise<DashboardSummary> {
      const raw = await api.request<DashboardInfoResponse>(
        "GET",
        `/v1/dashboards/${encodeURIComponent(env.dashboardId)}`,
      );
      return {
        id: raw.global_id ?? raw.id ?? env.dashboardId,
        name: raw.name,
        databaseId: raw.database_id ?? raw.databaseId ?? null,
      };
    },
    async findRowsByField(
      field: string,
      value: unknown,
    ): Promise<DashboardRow[]> {
      const rows = await listRows();
      return rows.filter((r) => r.fields?.[field] === value);
    },
  };
}

interface DashboardRowsResponse {
  rows?: DashboardRow[];
  items?: DashboardRow[];
}

interface DashboardInfoResponse {
  id?: string;
  global_id?: string;
  name?: string;
  database_id?: string | null;
  databaseId?: string | null;
}
