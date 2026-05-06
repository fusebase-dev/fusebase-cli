/**
 * Helpers for the `/link` magic-link activation route.
 *
 * The page lives at `https://{featureSub}.{appHost}/link?id=<globalId>&redirect=/some/path`.
 * Calls Gate `activateAppMagicLink({ path: { globalId } })`, persists the returned
 * tokens as cookies, then redirects. See `.claude/skills/fusebase-gate/references/app-magic-links.md`.
 *
 * Pure helpers only — no React, no SDK imports — so the unit test runs in plain Bun without JSDOM.
 */

export const MAGIC_LINK_ROUTE = '/link'
export const FEATURE_TOKEN_COOKIE = 'fbsfeaturetoken'
export const SESSION_COOKIE = 'eversessionid'

export type LinkActivationFailure = 'expired' | 'revoked' | 'not_found' | 'unknown'

/** Reject any value that is not a same-origin relative path. */
export function sanitizeRedirectPath(input: string | null | undefined): string {
  if (typeof input !== 'string' || input.length === 0) return '/'
  if (!input.startsWith('/')) return '/'
  if (input.startsWith('//')) return '/'
  if (input.includes('\\')) return '/'
  return input
}

/** Parse `?id=...&redirect=...`. Returns null when `id` is missing. */
export function parseLinkParams(search: string): { id: string; redirect: string } | null {
  const params = new URLSearchParams(search)
  const id = params.get('id')
  if (!id) return null
  return { id, redirect: sanitizeRedirectPath(params.get('redirect')) }
}

/**
 * Map an SDK `ApiError`-shaped value to a stable failure code.
 * Reads `body.reason` ("expired" / "revoked") then falls back to status code.
 */
export function parseActivationError(error: unknown): LinkActivationFailure {
  if (!error || typeof error !== 'object') return 'unknown'
  const err = error as Record<string, unknown>
  const candidates: Record<string, unknown>[] = []
  for (const candidate of [err, err['body'], err['data'], err['error']]) {
    if (candidate && typeof candidate === 'object') {
      candidates.push(candidate as Record<string, unknown>)
    }
  }
  for (const c of candidates) {
    const reason = c['reason']
    if (reason === 'expired' || reason === 'revoked') return reason
  }
  const status =
    typeof err['status'] === 'number'
      ? err['status']
      : typeof err['statusCode'] === 'number'
        ? err['statusCode']
        : undefined
  if (status === 404) return 'not_found'
  return 'unknown'
}

/**
 * Resolve the Gate SDK base URL.
 *
 * Priority: explicit override (`VITE_FUSEBASE_GATE_URL`) > app hostname heuristic > prod.
 * Heuristic recognises Fusebase-managed app domains; for custom domains pass an override
 * via the env var or update this helper.
 */
export function deriveGateBaseUrl(opts?: { hostname?: string; override?: string | null }): string {
  const override = opts?.override
  if (typeof override === 'string' && override.length > 0) return override
  const hostname =
    typeof opts?.hostname === 'string'
      ? opts.hostname
      : typeof window !== 'undefined' && window.location
        ? window.location.hostname
        : ''
  if (hostname.endsWith('.dev-thefusebase-app.com')) {
    return 'https://app-api.dev-thefusebase.com/v4/api/proxy/gate-service/v1'
  }
  if (hostname.endsWith('.thefusebase-app.com') || hostname.endsWith('.thefusebase.app')) {
    return 'https://app-api.thefusebase.com/v4/api/proxy/gate-service/v1'
  }
  return 'https://app-api.thefusebase.com/v4/api/proxy/gate-service/v1'
}

/**
 * Build a `document.cookie` string with sane defaults for the activation flow.
 * `Secure` is omitted for non-HTTPS so it works against `http://localhost` during dev.
 */
export function buildLinkCookie(
  name: string,
  value: string,
  opts?: { isSecure?: boolean; maxAgeSeconds?: number },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'path=/',
    'SameSite=Lax',
  ]
  if (typeof opts?.maxAgeSeconds === 'number' && opts.maxAgeSeconds > 0) {
    parts.push(`Max-Age=${Math.floor(opts.maxAgeSeconds)}`)
  }
  if (opts?.isSecure) parts.push('Secure')
  return parts.join('; ')
}
