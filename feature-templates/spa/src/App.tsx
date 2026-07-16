import { useState, useEffect } from 'react'
import { AuthTokenExpiredError, getFeatureToken } from './lib/api'
import { MAGIC_LINK_ROUTE, buildLegacyMagicLinkRedirect } from './lib/magic-link'
import { AuthExpiredModal } from './components/AuthExpiredModal'
import { EnvPanel } from './components/EnvPanel'

function App() {
  if (typeof window !== 'undefined' && window.location.pathname === MAGIC_LINK_ROUTE) {
    return <LegacyMagicLinkRedirect />
  }
  return (
    <>
      <AppContent />
      {/*
        Staff/debug environment panel (app environments). Deliberately outside
        the token gate — it must stay visible when auth is broken, which is
        exactly when you need to know which stage you are on. Hidden unless
        enabled with `?envpanel=1`; renders nothing on legacy deploys. Gate
        behind your app's role check before exposing in client-facing apps.
      */}
      <EnvPanel />
    </>
  )
}

/**
 * Old emails link to `/link?id={key}`; activation now happens server-side at
 * the platform `/_auth/magiclink/{key}` endpoint, so just forward there.
 */
function LegacyMagicLinkRedirect() {
  const target = buildLegacyMagicLinkRedirect(window.location.search)

  useEffect(() => {
    if (target) window.location.replace(target)
  }, [target])

  if (target) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-500">
        Redirecting...
      </div>
    )
  }
  return (
    <div className="flex items-center justify-center min-h-screen p-6">
      <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-lg border border-slate-200">
        <h2 className="text-lg font-semibold mb-2">Invalid link</h2>
        <p className="text-gray-600 text-sm leading-relaxed">
          This link is missing required information. Request a new magic link from the sign-in
          form to continue.
        </p>
      </div>
    </div>
  )
}

function AppContent() {
  const [appToken, setAppToken] = useState<string | null>(null)
  const [authExpired, setAuthExpired] = useState<AuthTokenExpiredError | null>(null)

  useEffect(() => {
    setAppToken(getFeatureToken())
  }, [])

  if (!appToken) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-500">
        Loading...
      </div>
    )
  }

  return (
    <>
      <main className="p-6">
        {/*
          App content goes here.
          Pass appToken to child components that make API calls.
          On AppTokenValidationError, use authErrorFromAppTokenFailure(err) (reason + optional server `hint`),
          or extractAppTokenValidationReason / extractAppTokenValidationHint with new AuthTokenExpiredError(...),
          then call onAuthError(err) from the catch block.

          Example:
            <MyComponent appToken={appToken} onAuthError={(err) => setAuthExpired(err)} />
        */}
        <h1 className="text-2xl font-bold">App</h1>
      </main>

      {authExpired && (
        <AuthExpiredModal authError={authExpired} onClose={() => setAuthExpired(null)} />
      )}
    </>
  )
}

export default App
