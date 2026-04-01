/**
 * Detects AppTokenValidationError across different error shapes returned by the SDK.
 * Use this in every API call's catch block.
 */
export function isAppTokenValidationError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>
    const nested = [err, err['data'], err['error'], err['body']]
    return nested.some(
      (e) => e && typeof e === 'object' && (e as Record<string, unknown>)['name'] === 'AppTokenValidationError'
    )
  }
  return false
}

/** Thrown when the feature token has expired. Catch at the UI level to show AuthExpiredModal. */
export class AuthTokenExpiredError extends Error {
  constructor() {
    super('Authentication token expired')
    this.name = 'AuthTokenExpiredError'
  }
}

/** Read a cookie value by name. */
export function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
  return match ? decodeURIComponent(match[2]) : null
}
