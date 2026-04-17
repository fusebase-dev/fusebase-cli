import { useState, useEffect } from 'react'
import { AuthTokenExpiredError, getFeatureToken } from './lib/api'
import { AuthExpiredModal } from './components/AuthExpiredModal'

function App() {
  const [featureToken, setFeatureToken] = useState<string | null>(null)
  const [authExpired, setAuthExpired] = useState<AuthTokenExpiredError | null>(null)

  useEffect(() => {
    setFeatureToken(getFeatureToken())
  }, [])

  if (!featureToken) {
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
          Feature content goes here.
          Pass featureToken to child components that make API calls.
          On AppTokenValidationError, map with extractAppTokenValidationReason and throw new AuthTokenExpiredError(reason),
          then call onAuthError(err) from the catch block.

          Example:
            <MyComponent featureToken={featureToken} onAuthError={(err) => setAuthExpired(err)} />
        */}
        <h1 className="text-2xl font-bold">Feature App</h1>
      </main>

      {authExpired && (
        <AuthExpiredModal authError={authExpired} onClose={() => setAuthExpired(null)} />
      )}
    </>
  )
}

export default App
