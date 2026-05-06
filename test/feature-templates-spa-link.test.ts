import { describe, expect, it } from 'bun:test'
import {
  MAGIC_LINK_ROUTE,
  buildLinkCookie,
  deriveGateBaseUrl,
  parseActivationError,
  parseLinkParams,
  sanitizeRedirectPath,
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
})
