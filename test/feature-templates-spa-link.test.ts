import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REQUEST_TIMEOUT_MS } from '../feature-templates/spa/src/lib/api'
import {
  MAGIC_LINK_ROUTE,
  PLATFORM_MAGIC_LINK_PATH,
  buildLegacyMagicLinkRedirect,
} from '../feature-templates/spa/src/lib/magic-link'

describe('feature-templates/spa legacy /link redirect helpers', () => {
  it('exposes the legacy route and platform path constants', () => {
    expect(MAGIC_LINK_ROUTE).toBe('/link')
    expect(PLATFORM_MAGIC_LINK_PATH).toBe('/_auth/magiclink/')
  })

  describe('buildLegacyMagicLinkRedirect', () => {
    it('returns null when id is missing', () => {
      expect(buildLegacyMagicLinkRedirect('')).toBeNull()
      expect(buildLegacyMagicLinkRedirect('?redirect=/foo')).toBeNull()
      expect(buildLegacyMagicLinkRedirect('?id=')).toBeNull()
    })

    it('maps ?id= to the platform activation path', () => {
      expect(buildLegacyMagicLinkRedirect('?id=abc123')).toBe('/_auth/magiclink/abc123')
    })

    it('ignores the legacy redirect param (platform uses the stored redirectPath)', () => {
      expect(buildLegacyMagicLinkRedirect('?id=abc&redirect=/proposals/42')).toBe(
        '/_auth/magiclink/abc',
      )
    })

    it('encodes ids so they cannot escape the path segment', () => {
      expect(buildLegacyMagicLinkRedirect('?id=a%2Fb%3Fx%3D1')).toBe(
        '/_auth/magiclink/a%2Fb%3Fx%3D1',
      )
      expect(buildLegacyMagicLinkRedirect('?id=..%2F..%2Fevil')).toBe(
        '/_auth/magiclink/..%2F..%2Fevil',
      )
    })
  })
})

describe('feature-templates/spa cold-start request timeout', () => {
  it('keeps a cold-start-tolerant deadline under the 30s platform ceiling', () => {
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(15000)
    expect(REQUEST_TIMEOUT_MS).toBeLessThan(30000)
  })

  it('is actually applied to the template fetch calls', () => {
    const envPanel = readFileSync(
      join(import.meta.dir, '../feature-templates/spa/src/components/EnvPanel.tsx'),
      'utf8',
    )
    expect(envPanel).toContain('AbortSignal.timeout(REQUEST_TIMEOUT_MS)')
  })
})
