const GATE_OPERATION_REQUIRED_PERMISSION_HINTS: Record<string, string> = {
  countIsolatedStoreSqlRowsRlsBypass: "isolated_store.rls.bypass",
  selectIsolatedStoreSqlRowsRlsBypass: "isolated_store.rls.bypass",
};

export function findGatePermissionDiagnostics(args: {
  usedOps: string[];
  permissions: string[];
}): string[] {
  const permissions = new Set(args.permissions);
  const missing = new Set<string>();

  for (const op of args.usedOps) {
    const required = GATE_OPERATION_REQUIRED_PERMISSION_HINTS[op];
    if (required !== undefined && !permissions.has(required)) {
      missing.add(required);
    }
  }

  if (missing.size === 0) {
    return [];
  }

  return [
    `Gate permission resolver did not return expected permission(s) for detected operation(s): ${[...missing].sort().join(", ")}. Check Gate/SDK version skew or add reviewed fusebaseGateMeta.manualPermissions as a temporary override.`,
  ];
}
