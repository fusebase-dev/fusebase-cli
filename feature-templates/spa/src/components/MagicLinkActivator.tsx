import { useEffect, useState } from 'react'
import {
  FEATURE_TOKEN_COOKIE,
  SESSION_COOKIE,
  buildLinkCookie,
  deriveGateBaseUrl,
  parseActivationError,
  parseLinkParams,
  type LinkActivationFailure,
} from '../lib/magic-link'

type ActivationState =
  | { status: 'loading' }
  | { status: 'invalid' }
  | { status: 'failed'; reason: LinkActivationFailure }

interface ActivationResponse {
  sessionToken?: string
  featureToken?: string
  redirectPath?: string | null
}

class MagicLinkActivationError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown) {
    super(`Magic-link activation failed with status ${status}`)
    this.name = 'MagicLinkActivationError'
    this.status = status
    this.body = body
  }
}

async function activateMagicLink(gateBaseUrl: string, globalId: string): Promise<ActivationResponse> {
  const url = `${gateBaseUrl}/apps/magic-links/${encodeURIComponent(globalId)}/activate`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (!response.ok) {
    throw new MagicLinkActivationError(response.status, body)
  }
  return (body ?? {}) as ActivationResponse
}

export function MagicLinkActivator() {
  const [state, setState] = useState<ActivationState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const params = parseLinkParams(window.location.search)
      if (!params) {
        if (!cancelled) setState({ status: 'invalid' })
        return
      }

      const gateBaseUrl = deriveGateBaseUrl({
        override: import.meta.env.VITE_FUSEBASE_GATE_URL ?? null,
      })

      try {
        const response = await activateMagicLink(gateBaseUrl, params.id)

        const isSecure = window.location.protocol === 'https:'
        const cookieMaxAge = 60 * 60 * 24 * 30
        if (response.featureToken) {
          document.cookie = buildLinkCookie(FEATURE_TOKEN_COOKIE, response.featureToken, {
            isSecure,
            maxAgeSeconds: cookieMaxAge,
          })
        }
        if (response.sessionToken) {
          document.cookie = buildLinkCookie(SESSION_COOKIE, response.sessionToken, {
            isSecure,
            maxAgeSeconds: cookieMaxAge,
          })
        }

        const target = response.redirectPath && response.redirectPath.startsWith('/')
          ? response.redirectPath
          : params.redirect
        window.location.replace(target)
      } catch (error) {
        if (cancelled) return
        const reason = parseActivationError(error)
        console.error('[magic-link] activation failed', { reason, error })
        setState({ status: 'failed', reason })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-500">
        Activating your link...
      </div>
    )
  }

  const ui = renderFailureUi(state)
  return (
    <div className="flex items-center justify-center min-h-screen p-6">
      <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-lg border border-slate-200">
        <h2 className="text-lg font-semibold mb-2">{ui.title}</h2>
        <p className="text-gray-600 mb-6 text-sm leading-relaxed">{ui.body}</p>
        <div className="flex gap-3 justify-end">
          <a
            href="/"
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Back to sign in
          </a>
        </div>
      </div>
    </div>
  )
}

function renderFailureUi(state: ActivationState): { title: string; body: string } {
  if (state.status === 'invalid') {
    return {
      title: 'Invalid link',
      body: 'This link is missing required information. Request a new magic link from the sign-in form to continue.',
    }
  }
  if (state.status === 'failed') {
    if (state.reason === 'expired') {
      return {
        title: 'This link has expired',
        body: 'Magic links are valid for 24 hours. Request a new one from the sign-in form and use it within the next day.',
      }
    }
    if (state.reason === 'revoked') {
      return {
        title: 'This link is no longer valid',
        body: 'Your access to this app was changed after the link was sent. Sign in again or contact the person who invited you.',
      }
    }
    if (state.reason === 'not_found') {
      return {
        title: 'Link not found',
        body: 'We could not find this magic link. It may have been already used or removed. Request a new one from the sign-in form.',
      }
    }
  }
  return {
    title: 'Could not activate this link',
    body: 'Something went wrong while activating your link. Try again, or request a new link from the sign-in form.',
  }
}
