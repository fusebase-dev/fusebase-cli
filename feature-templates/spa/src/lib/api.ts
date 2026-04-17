function collectErrorObjects(error: unknown): Record<string, unknown>[] {
  if (!error || typeof error !== 'object') return []
  const err = error as Record<string, unknown>
  const nested = [err, err['data'], err['error'], err['body']]
  return nested.filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
}

/**
 * Detects AppTokenValidationError across different error shapes returned by the SDK.
 * Use this in every API call's catch block.
 */
export function isAppTokenValidationError(error: unknown): boolean {
  return collectErrorObjects(error).some((e) => e['name'] === 'AppTokenValidationError')
}

/**
 * Reads `reason` from an AppTokenValidationError payload (e.g. `missing_gate_service_token`, `expired`).
 */
export function extractAppTokenValidationReason(error: unknown): string | undefined {
  for (const e of collectErrorObjects(error)) {
    if (e['name'] !== 'AppTokenValidationError') continue
    const r = e['reason']
    return typeof r === 'string' && r.length > 0 ? r : undefined
  }
  return undefined
}

/** User-facing title + body for the auth modal; driven by platform `reason`, not only clock expiry. */
export function authUiForAppTokenReason(reason: string | undefined): { title: string; body: string } {
  if (reason === 'expired') {
    return {
      title: 'Session expired',
      body: 'Your feature session expired. Refresh the page to get a new token.',
    }
  }
  if (reason === 'missing_gate_service_token') {
    return {
      title: 'Could not authorize this app',
      body:
        'The app token is missing the Gate authorization part — this is not a timed session expiry in your browser. Try refreshing the page. If it keeps happening, the feature token may be incomplete for your role; check with support and mention the request id from the failed network call.',
    }
  }
  if (reason) {
    return {
      title: 'Authentication error',
      body: `The platform rejected the app token (reason: ${reason}). Refresh the page, or contact support if it continues.`,
    }
  }
  return {
    title: 'Authentication error',
    body: 'The platform could not validate the app token. Refresh the page to try again.',
  }
}

/**
 * Thrown when Gate/dashboard returns AppTokenValidationError. Catch at the UI level to show AuthExpiredModal.
 * `appTokenReason` mirrors the server `reason` field when present.
 */
export class AuthTokenExpiredError extends Error {
  readonly appTokenReason: string | undefined

  constructor(appTokenReason?: string) {
    super(authUiForAppTokenReason(appTokenReason).title)
    this.name = 'AuthTokenExpiredError'
    this.appTokenReason = appTokenReason
  }
}

/** Read a cookie value by name. */
export function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
  return match ? decodeURIComponent(match[2]) : null
}

/**
 * Read the feature token. Checks the `fbsfeaturetoken` cookie first;
 * falls back to `window.FBS_FEATURE_TOKEN` if the cookie is absent.
 */
export function getFeatureToken(): string | null {
  return getCookie('fbsfeaturetoken') ?? (window as Window & { FBS_FEATURE_TOKEN?: string }).FBS_FEATURE_TOKEN ?? null
}
