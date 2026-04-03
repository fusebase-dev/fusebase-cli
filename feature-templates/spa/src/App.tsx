import { useState, useEffect } from 'react'
import { getFeatureToken } from './lib/api'
import { AuthExpiredModal } from './components/AuthExpiredModal'

function App() {
  const [featureToken, setFeatureToken] = useState<string | null>(null)
  const [authExpired, setAuthExpired] = useState(false)

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
          When an API call catches AppTokenValidationError, call setAuthExpired(true).

          Example:
            <MyComponent featureToken={featureToken} onAuthError={() => setAuthExpired(true)} />
        */}
        <h1 className="text-2xl font-bold">Feature App</h1>
      </main>

      {authExpired && <AuthExpiredModal onClose={() => setAuthExpired(false)} />}
    </>
  )
}

export default App
