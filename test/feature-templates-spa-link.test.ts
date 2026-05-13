import { describe, expect, it } from 'bun:test'
import {
  DASHBOARD_TOKEN_COOKIE,
  FEATURE_TOKEN_COOKIE,
  MAGIC_LINK_ROUTE,
  SESSION_COOKIE,
  buildLinkCookie,
  deriveGateBaseUrl,
  parseActivationError,
  parseLinkParams,
  sanitizeRedirectPath,
  selectActivationOutcome,
} from '../feature-templates/spa/src/lib/magic-link'

describe('feature-templates/spa /link handler helpers', () => {
  it('exposes the canonical /link route constant', () => {
    expect(MAGIC_LINK_ROUTE).toBe('/link')
  })

  describe('parseLinkParams', () => {
    it('returns null when id is missing', () => {
      expect(parseLinkParams('')).toBeNull()
      expect(parseLinkParams('?redirect=/foo')).toBeNull()
    })

    it('returns id and a sanitized redirect', () => {
      expect(parseLinkParams('?id=abc&redirect=/proposals/42')).toEqual({
        id: 'abc',
        redirect: '/proposals/42',
      })
    })

    it('falls back to / when redirect is unsafe', () => {
      expect(parseLinkParams('?id=abc&redirect=https://evil.com')?.redirect).toBe('/')
      expect(parseLinkParams('?id=abc&redirect=//evil.com/path')?.redirect).toBe('/')
      expect(parseLinkParams('?id=abc')?.redirect).toBe('/')
    })
  })

  describe('sanitizeRedirectPath', () => {
    it('returns / for missing or non-relative input', () => {
      expect(sanitizeRedirectPath(null)).toBe('/')
      expect(sanitizeRedirectPath(undefined)).toBe('/')
      expect(sanitizeRedirectPath('')).toBe('/')
      expect(sanitizeRedirectPath('proposals/42')).toBe('/')
      expect(sanitizeRedirectPath('https://evil.com')).toBe('/')
      expect(sanitizeRedirectPath('//evil.com')).toBe('/')
      expect(sanitizeRedirectPath('/foo\\bar')).toBe('/')
    })

    it('passes through safe relative paths', () => {
      expect(sanitizeRedirectPath('/')).toBe('/')
      expect(sanitizeRedirectPath('/proposals/42')).toBe('/proposals/42')
      expect(sanitizeRedirectPath('/a?x=1#y')).toBe('/a?x=1#y')
    })
  })

  describe('parseActivationError', () => {
    it('reads body.reason for expired/revoked', () => {
      expect(parseActivationError({ status: 403, body: { reason: 'expired' } })).toBe('expired')
      expect(parseActivationError({ status: 403, body: { reason: 'revoked' } })).toBe('revoked')
    })

    it('falls back to status 404 → not_found', () => {
      expect(parseActivationError({ status: 404 })).toBe('not_found')
    })

    it('returns unknown for non-error inputs and unrecognized shapes', () => {
      expect(parseActivationError(null)).toBe('unknown')
      expect(parseActivationError('boom')).toBe('unknown')
      expect(parseActivationError({})).toBe('unknown')
      expect(parseActivationError({ status: 500 })).toBe('unknown')
      expect(parseActivationError({ status: 403, body: { reason: 'mystery' } })).toBe('unknown')
    })
  })

  describe('deriveGateBaseUrl', () => {
    it('honours an explicit override', () => {
      expect(deriveGateBaseUrl({ override: 'https://custom/gate', hostname: 'foo.dev-thefusebase-app.com' })).toBe(
        'https://custom/gate',
      )
    })

    it('maps Fusebase-managed hostnames to the matching app-api host', () => {
      expect(deriveGateBaseUrl({ hostname: 'app.feature.dev-thefusebase-app.com' })).toBe(
        'https://app-api.dev-thefusebase.com/v4/api/proxy/gate-service/v1',
      )
      expect(deriveGateBaseUrl({ hostname: 'app.feature.thefusebase.app' })).toBe(
        'https://app-api.thefusebase.com/v4/api/proxy/gate-service/v1',
      )
    })

    it('defaults to prod app-api for unknown hostnames', () => {
      expect(deriveGateBaseUrl({ hostname: 'localhost' })).toBe(
        'https://app-api.thefusebase.com/v4/api/proxy/gate-service/v1',
      )
    })
  })

  describe('buildLinkCookie', () => {
    it('encodes the value and applies path + SameSite', () => {
      expect(buildLinkCookie('fbsfeaturetoken', 'abc 123')).toBe(
        'fbsfeaturetoken=abc%20123; path=/; SameSite=Lax',
      )
    })

    it('appends Max-Age and Secure when requested', () => {
      expect(buildLinkCookie('eversessionid', 's', { isSecure: true, maxAgeSeconds: 60 })).toBe(
        'eversessionid=s; path=/; SameSite=Lax; Max-Age=60; Secure',
      )
    })
  })

  describe('selectActivationOutcome', () => {
    const cookieOpts = { isSecure: true, maxAgeSeconds: 60 }

    it('prefers a safe server-returned redirectPath over the URL fallback', () => {
      const outcome = selectActivationOutcome(
        { redirectPath: '/proposals/42' },
        '/fallback',
        cookieOpts,
      )
      expect(outcome.redirectTarget).toBe('/proposals/42')
    })

    it('rejects an unsafe server redirectPath instead of trusting it (open-redirect guard)', () => {
      // Regression for NIM-41013 round-1 CR: window.location.replace('//evil.com/path')
      // is a protocol-relative redirect to evil.com. The server response must be
      // sanitised exactly like the URL fallback.
      const cases = ['//evil.com/path', 'https://evil.com', 'evil.com', '/foo\\bar', 'javascript:alert(1)']
      for (const bad of cases) {
        const outcome = selectActivationOutcome({ redirectPath: bad }, '/fallback', cookieOpts)
        expect(outcome.redirectTarget).toBe('/fallback')
      }
    })

    it('falls back to the (sanitised) URL redirect when the server omits redirectPath', () => {
      expect(
        selectActivationOutcome({ redirectPath: null }, '/proposals/42', cookieOpts).redirectTarget,
      ).toBe('/proposals/42')
      expect(
        selectActivationOutcome({}, '/proposals/42', cookieOpts).redirectTarget,
      ).toBe('/proposals/42')
    })

    it('also sanitises an unsafe URL fallback (defence in depth)', () => {
      expect(
        selectActivationOutcome({ redirectPath: null }, '//evil.com/x', cookieOpts).redirectTarget,
      ).toBe('/')
    })

    it('builds cookie strings for every token returned by activation', () => {
      // Regression for NIM-41013 round-3 CR: nimbus-ai's activation response carries
      // featureToken (Gate), dashboardToken (dashboard-service), and sessionToken; the
      // SPA must persist all three so dashboard SDK calls can authenticate post-activation.
      const outcome = selectActivationOutcome(
        {
          sessionToken: 'sess',
          featureToken: 'feat',
          dashboardToken: 'dash',
          redirectPath: '/',
        },
        '/',
        cookieOpts,
      )
      expect(outcome.cookies.map((c) => c.name)).toEqual([
        FEATURE_TOKEN_COOKIE,
        DASHBOARD_TOKEN_COOKIE,
        SESSION_COOKIE,
      ])
      expect(outcome.cookies[0]?.cookie).toBe('fbsfeaturetoken=feat; path=/; SameSite=Lax; Max-Age=60; Secure')
      expect(outcome.cookies[1]?.cookie).toBe('fbsdashboardtoken=dash; path=/; SameSite=Lax; Max-Age=60; Secure')
      expect(outcome.cookies[2]?.cookie).toBe('eversessionid=sess; path=/; SameSite=Lax; Max-Age=60; Secure')
    })

    it('omits cookies when tokens are absent', () => {
      expect(
        selectActivationOutcome({ redirectPath: '/' }, '/', cookieOpts).cookies,
      ).toEqual([])
      expect(
        selectActivationOutcome(
          { sessionToken: '', featureToken: '', dashboardToken: '', redirectPath: '/' },
          '/',
          cookieOpts,
        ).cookies,
      ).toEqual([])
    })

    it('persists dashboardToken independently of the other two', () => {
      const outcome = selectActivationOutcome(
        { dashboardToken: 'dash-only', redirectPath: '/' },
        '/',
        cookieOpts,
      )
      expect(outcome.cookies.map((c) => c.name)).toEqual([DASHBOARD_TOKEN_COOKIE])
      expect(outcome.cookies[0]?.cookie).toBe('fbsdashboardtoken=dash-only; path=/; SameSite=Lax; Max-Age=60; Secure')
    })
  })
})
