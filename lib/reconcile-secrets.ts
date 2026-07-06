import { diffAppSecrets } from "./reconcile";
import { fetchAppSecrets, setAppSecrets, fetchOrg } from "./api";
import type { AppSecretDeclaration } from "./config";

export interface ReconcileAppSecretsParams {
  apiKey: string;
  orgId: string;
  productId: string;
  appId: string;
  /** Declared secrets from the app's fusebase.json entry (`apps[].secrets`). */
  declared: AppSecretDeclaration[];
  /** App path/subdomain, for human-readable log lines. */
  label?: string;
}

/**
 * Register declared-but-missing app secrets on the platform (NIM-secrets). The
 * declarative counterpart to `secret create`, which only writes key names to
 * fusebase.json — the real platform secret is created here at deploy/dev-start.
 *
 * Safety: only keys absent on the platform are POSTed, each with an EMPTY value,
 * because the platform POST overwrites the value — re-sending an existing key
 * would wipe a value set in the FuseBase UI. Values are NEVER read or written by
 * the CLI. Additive-only: platform keys not in the manifest are warned about,
 * never deleted (deletion would also destroy a UI-set value).
 *
 * Best-effort and non-fatal: a failure here logs a warning but does not abort the
 * deploy — the later secret-key fetch/hash still reflects the true platform set.
 */
export async function reconcileAppSecrets(
  params: ReconcileAppSecretsParams,
): Promise<void> {
  const { apiKey, orgId, productId, appId, declared, label } = params;
  if (declared.length === 0) return;
  const where = label ? ` for ${label}` : "";

  try {
    const existing = await fetchAppSecrets(apiKey, orgId, productId, appId);
    const plan = diffAppSecrets(
      declared,
      existing.secrets.map((s) => s.key),
    );

    if (plan.toCreate.length > 0) {
      await setAppSecrets(
        apiKey,
        orgId,
        productId,
        appId,
        plan.toCreate.map((s) => ({
          key: s.key,
          value: "",
          description: s.description,
        })),
      );
      console.log(
        `   Registered ${plan.toCreate.length} new secret key(s)${where}: ${plan.toCreate
          .map((s) => s.key)
          .join(", ")}`,
      );
      // Point the human at the UI to set the values — the CLI never handles them.
      try {
        const org = await fetchOrg(apiKey, orgId);
        const url = `https://${org.effectiveDomain}/dashboard/${orgId}/apps/features/${appId}/secrets`;
        console.log(`   Set their values in the FuseBase UI:\n     ${url}`);
      } catch {
        console.warn(
          "   Warning: could not fetch org domain to print the secrets URL.",
        );
      }
    }

    if (plan.undeclared.length > 0) {
      console.warn(
        `   Note: ${plan.undeclared.length} platform secret key(s)${where} are not declared in ` +
          `fusebase.json: ${plan.undeclared.join(", ")}. They are left untouched ` +
          `(deploy never deletes secrets). Add them to "secrets" or remove them in the UI.`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`   Warning: failed to reconcile secrets${where}: ${message}`);
  }
}
