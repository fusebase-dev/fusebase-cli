import { createHash } from "crypto";
import type { CreateTokenRequest } from "./api";
import { hasFlag } from "./config";

/** Bump when fingerprint inputs change so old .env values force refresh once. */
export const MCP_POLICY_SCHEMA_VERSION = 1 as const;

/** Written to `.env` after token refresh — sole source of truth for policy drift checks (`fusebase app update`, `fusebase env create`). */
export const DASHBOARDS_MCP_POLICY_FP_KEY = "DASHBOARDS_MCP_POLICY_FP";
export const GATE_MCP_POLICY_FP_KEY = "GATE_MCP_POLICY_FP";

const DASHBOARDS_PERMISSIONS = [
  "column.*.read",
  "column.*.write",
  "dashboard.delete",
  "dashboard.read",
  "dashboard.write",
  "data.read",
  "data.write",
  "database.delete",
  "database.read",
  "database.write",
  "relation.read",
  "relation.write",
  "template.read",
  "template.write",
  "token.delete",
  "token.read",
  "token.write",
  "view.delete",
  "view.read",
  "view.write",
] as const;

const GATE_PERMISSIONS_BASE = [
  "automation.delete",
  "automation.read",
  "automation.write",
  "billing.read",
  "billing.write",
  "email.write",
  "notes.read",
  "notes.write",
  "org.groups.read",
  "org.groups.write",
  "org.members.read",
  "org.members.write",
  "org.read",
  "org.write",
  "token.delete",
  "token.read",
  "token.write",
] as const;

const GATE_PERMISSIONS_ISOLATED = [
  "isolated_store.control.write",
  "isolated_store.data.write",
  "isolated_store.delete",
  "isolated_store.execute",
  "isolated_store.read",
  "isolated_store.schema.write",
] as const;

/**
 * Baseline permission-only fingerprints accepted for old projects with no FP keys in `.env`.
 * Generated from the permission lists that shipped before FP markers existed.
 */
const LEGACY_PERMISSIONS_ONLY_BASELINE = {
  dashboards: "566ccf5972e80b00f7eacc95f9d4d94bb414f8a7337a688f21695f21b8b93a44",
  gate: "c1ce31108d389282e45f9d3fbe8a6d7c1e511386aa79a71b271fad71ce7bc350",
} as const;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

/** Serializable policy shape (no org/app ids) for dashboards MCP token. */
export function dashboardsMcpPolicyDescriptor(): Record<string, unknown> {
  return {
    schema: MCP_POLICY_SCHEMA_VERSION,
    product: "dashboards-mcp",
    permissions: [...DASHBOARDS_PERMISSIONS],
    resource_scope: {
      allow: [
        {
          databases: ["*"],
          dashboards: ["*"],
          views: ["*"],
        },
      ],
    },
    scope_types: ["org"],
  };
}

/** Serializable policy shape for Gate MCP token (isolated-stores toggles extra permissions). */
export function gateMcpPolicyDescriptor(isolatedStores: boolean): Record<string, unknown> {
  const permissions = [
    ...GATE_PERMISSIONS_BASE,
    ...(isolatedStores ? GATE_PERMISSIONS_ISOLATED : []),
  ].sort((a, b) => a.localeCompare(b));
  return {
    schema: MCP_POLICY_SCHEMA_VERSION,
    product: "gate-mcp",
    permissions,
    resource_scope: {},
    scope_types: ["org", "client"],
    isolated_stores: isolatedStores,
  };
}

export function fingerprintPolicyDescriptor(descriptor: Record<string, unknown>): string {
  return sha256Hex(stableStringify(descriptor));
}

export function getExpectedMcpPolicyFingerprints(): {
  dashboards: string;
  gate: string;
} {
  return {
    dashboards: fingerprintPolicyDescriptor(dashboardsMcpPolicyDescriptor()),
    gate: fingerprintPolicyDescriptor(gateMcpPolicyDescriptor(hasFlag("isolated-stores"))),
  };
}

/**
 * Legacy fallback for apps initialized before FP keys existed in `.env`.
 * Based on the historical permission lists only (no resource/scope fields).
 */
export function getLegacyPermissionsOnlyFingerprints(): {
  dashboards: string;
  gate: string;
} {
  const isolatedStores = hasFlag("isolated-stores");
  return {
    dashboards: sha256Hex(
      stableStringify({
        legacy: 1,
        product: "dashboards-mcp",
        permissions: [...DASHBOARDS_PERMISSIONS],
      }),
    ),
    gate: sha256Hex(
      stableStringify({
        legacy: 1,
        product: "gate-mcp",
        permissions: [
          ...GATE_PERMISSIONS_BASE,
          ...(isolatedStores ? GATE_PERMISSIONS_ISOLATED : []),
        ],
        isolated_stores: isolatedStores,
      }),
    ),
  };
}

/**
 * Accepts exact current FP values, and also old apps with missing FP keys
 * when current policy still matches legacy permission-only fallback values.
 */
export function matchesCurrentOrLegacyFallback(stored: {
  dashboards?: string;
  gate?: string;
}): boolean {
  const expected = getExpectedMcpPolicyFingerprints();
  const d = (stored.dashboards ?? "").trim();
  const g = (stored.gate ?? "").trim();

  if (d && g) {
    return d === expected.dashboards && g === expected.gate;
  }

  const legacy = getLegacyPermissionsOnlyFingerprints();
  return (
    legacy.dashboards === LEGACY_PERMISSIONS_ONLY_BASELINE.dashboards &&
    legacy.gate === LEGACY_PERMISSIONS_ONLY_BASELINE.gate
  );
}

/** Full API request for dashboards MCP token (org-scoped). */
export function buildDashboardsMcpTokenRequest(orgId: string): CreateTokenRequest {
  return {
    scopes: [{ scope_type: "org", scope_id: orgId }],
    permissions: [...DASHBOARDS_PERMISSIONS],
    resource_scope: {
      allow: [
        {
          databases: ["*"],
          dashboards: ["*"],
          views: ["*"],
        },
      ],
    },
    name: "MCP Token (generated by CLI)",
  };
}

/** Full API request for Gate MCP token (org + client scopes). */
export function buildGateMcpTokenRequest(orgId: string, appId: string): CreateTokenRequest {
  const isolated = hasFlag("isolated-stores")
    ? [...GATE_PERMISSIONS_ISOLATED]
    : [];
  const permissions = [...GATE_PERMISSIONS_BASE, ...isolated];
  return {
    scopes: [
      { scope_type: "org", scope_id: orgId },
      { scope_type: "client", scope_id: appId },
    ],
    permissions,
    resource_scope: {},
    name: "Gate token (full access)",
  };
}
