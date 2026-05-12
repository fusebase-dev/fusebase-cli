import { useState, useEffect } from 'react'
import { AuthTokenExpiredError, getFeatureToken } from './lib/api'
import { AuthExpiredModal } from './components/AuthExpiredModal'

function App() {
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
