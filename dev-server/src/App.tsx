import { useState, useEffect, useCallback, useRef, SyntheticEvent } from 'react'
import './App.css'

interface Feature {
  id: string
  title: string
  description?: string
  devUrl?: string
}

function App() {
  const [features, setFeatures] = useState<Feature[]>([])
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [appId, setAppId] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const isTokenSentInitially = useRef(false)
  const [featureToken, setFeatureToken] = useState<string | null>(null)
  const [isTokenSent, setIsTokenSent] = useState(false)
  const [iframeLoadError, setIframeLoadError] = useState(false)
  const [manualDevUrl, setManualDevUrl] = useState('')
  const [isEditingUrl, setIsEditingUrl] = useState(false)

  useEffect(() => {
    fetchFeatures()
  }, [])

  // Listen for navigate messages from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data
      if (msg?.type === 'navigate' && typeof msg.path === 'string') {
        console.log('Received navigate message:', msg.path)

        if (/^https?:\/\//i.test(msg.path)) {
          console.log(
            'Navigate to the url. This navigation might be forbidden in production if url domain does not match the feature domain.',
            msg.path
          )
          document.location.href = msg.path;
          return;
        }

        // Update browser URL
        if (msg.replace) {
          window.history.replaceState({}, '', msg.path)
        } else {
          window.history.pushState({}, '', msg.path)
        }

        // Send route message back to iframe with the new path
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage(
            { type: 'route', path: msg.path, origin: window.location.origin },
            '*'
          )
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const sendToken = useCallback(() => {
    if (!iframeRef.current?.contentWindow) {
      console.debug('sendToken: No iframe contentWindow yet')
      return false
    }

    if (!featureToken) {
      console.debug('sendToken: No token available yet')
      return false
    }

    console.log('Sending feature token to iframe')
    iframeRef.current.contentWindow.postMessage(
      { type: 'featuretoken', token: featureToken },
      '*'
    )
    iframeRef.current.contentWindow.postMessage(
      { type: 'route', path: window.location.pathname, origin: window.location.origin },
      '*'
    )
    setIsTokenSent(true)
    return true
  }, [featureToken])

  // Fetch feature token when selected feature changes
  useEffect(() => {
    if (!selectedFeatureId || !orgId || !appId) {
      setFeatureToken(null)
      isTokenSentInitially.current = false
      setIsTokenSent(false)
      setIframeLoadError(false)
      return
    }

    // Reset states for new feature
    setIsTokenSent(false)
    setIframeLoadError(false)
    isTokenSentInitially.current = false

    const fetchToken = async () => {
      try {
        const response = await fetch(
          `/api/orgs/${orgId}/apps/${appId}/features/${selectedFeatureId}/tokens`,
          { method: 'POST' }
        )
        if (!response.ok) {
          console.error('Failed to fetch feature token:', response.status)
          return
        }

        const data = await response.json()
        setFeatureToken(data.token)
      } catch (error) {
        console.error('Error fetching feature token:', error)
      }
    }

    fetchToken()
  }, [selectedFeatureId, orgId, appId])

  // Multiple strategies to send token to iframe
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe || !featureToken) {
      return
    }

    // Strategy 1: If iframe is already loaded (cached), send immediately
    if (iframe.contentDocument?.readyState === 'complete') {
      console.log('Sending token on because iframe readyState is complete')
      sendToken()
      isTokenSentInitially.current = true
    }

    // Strategy 2: Listen for load event via addEventListener (more reliable)
    const sendTokenOnLoad = () => {
      console.log('Sending token on iframe load event')
      isTokenSentInitially.current = true
      sendToken()
    }

    iframe.addEventListener('load', sendTokenOnLoad)

    return () => {
      iframe.removeEventListener('load', sendTokenOnLoad)
    }
  }, [sendToken, featureToken])

  // Strategy 3: Timeout fallback in case load event doesn't fire
  useEffect(() => {
    if (!featureToken) {
      return
    }

    let timer: NodeJS.Timeout
    const timeout = () => {
      timer = setTimeout(() => {
        if (isTokenSentInitially.current) {
          return
        }
        const iframe = iframeRef.current
        if (!iframe) {
          console.debug('No iframe ref yet (timer)')
          return timeout()
        }
        if (iframe.contentWindow) {
          console.log('Sending token because iframe.contentWindow is available (timer)')
          sendToken()
          isTokenSentInitially.current = true
        } else {
          console.debug('Iframe not loaded yet (timer)')
          return timeout()
        }
      }, 500)
    }

    timeout()

    return () => {
      clearTimeout(timer)
    }
  }, [sendToken, featureToken])

  // 5 second timeout for iframe load error
  useEffect(() => {
    if (!selectedFeatureId || !featureToken || isTokenSent) {
      console.log(selectedFeatureId, featureToken, isTokenSent)
      return
    }

    const errorTimer = setTimeout(() => {
      if (!isTokenSentInitially.current) {
        console.log('ERROR!')
        setIframeLoadError(true)
      }
    }, 5000)

    return () => {
      clearTimeout(errorTimer)
    }
  }, [selectedFeatureId, featureToken, isTokenSent])

  const onIframeError = useCallback((event: SyntheticEvent) => {
    console.warn('Iframe failed to load:', event)
  }, [])



  const fetchFeatures = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/features')
      if (!response.ok) {
        throw new Error('Failed to fetch features')
      }
      const data = await response.json()
      setFeatures(data.features)

      if (data.features.length) {
        setOrgId(data.features[0].orgId)
        setAppId(data.features[0].appId)
      }

      setSelectedFeatureId(data.features[0].id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load features')
    } finally {
      setLoading(false)
    }
  }

  const applyManualDevUrl = () => {
    if (!manualDevUrl || !selectedFeatureId) return

    setFeatures(features.map(f =>
      f.id === selectedFeatureId
        ? { ...f, devUrl: manualDevUrl }
        : f
    ))
    setIsEditingUrl(false)
  }

  const selectedFeature = features.find(f => f.id === selectedFeatureId)

  if (loading) {
    return (
      <div className="app">
        <div className="loading">Loading features...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="app">
        <div className="error">
          <h2>Error</h2>
          <p>{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>Fusebase Dev</h1>
        </div>
        <div className="sidebar-content">
          {features.length > 1 && (
            <>
              <label htmlFor="feature-select" className="select-label">
                Select Feature
              </label>
              <select
                id="feature-select"
                className="feature-select"
                value={selectedFeatureId || ''}
                onChange={(e) => setSelectedFeatureId(e.target.value)}
              >
                {features.map((feature) => (
                  <option key={feature.id} value={feature.id}>
                    {feature.title}
                    {!feature.devUrl ? ' (no dev URL)' : ''}
                  </option>
                ))}
              </select>
            </>
          )}

          {selectedFeature && (
            <div className="feature-info">
              {features.length === 1 && (
                <h2 className="feature-title">{selectedFeature.title}</h2>
              )}
              {selectedFeature.description && (
                <p className="feature-description">{selectedFeature.description}</p>
              )}
              <div className="feature-url">
                <span className="url-label">Dev URL:</span>
                {isEditingUrl || !selectedFeature.devUrl ? (
                  <div className="url-input-container">
                    <input
                      type="text"
                      className="url-input"
                      value={manualDevUrl}
                      onChange={(e) => setManualDevUrl(e.target.value)}
                      placeholder="http://localhost:3000"
                      onKeyDown={(e) => e.key === 'Enter' && applyManualDevUrl()}
                    />
                    <button className="url-apply-btn" onClick={applyManualDevUrl}>
                      Apply
                    </button>
                    {selectedFeature.devUrl && (
                      <button className="url-cancel-btn" onClick={() => setIsEditingUrl(false)}>
                        Cancel
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="url-display">
                    <span className="url-value">
                      {selectedFeature.devUrl}
                    </span>
                    <button
                      className="url-edit-btn"
                      onClick={() => {
                        setManualDevUrl(selectedFeature.devUrl || '')
                        setIsEditingUrl(true)
                      }}
                      title="Edit URL"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="sidebar-footer">
          <p className="hint">
            Configure features development with <code>fusebase feature create</code>
          </p>
        </div>
      </aside>

      <main className="main-content">
        {selectedFeature?.devUrl ? (
          <div className="iframe-container">
            <iframe
              ref={iframeRef}
              key={selectedFeature.id}
              src={selectedFeature.devUrl}
              className="feature-iframe"
              title={selectedFeature.title}
              onError={onIframeError}
            />
            {!isTokenSent && (
              <div className="iframe-overlay">
                {iframeLoadError ? (
                  <div className="iframe-error">
                    <h3>⚠️ Feature Not Accessible</h3>
                    <p>Could not connect to the feature dev server.</p>
                    <p className="error-hint">
                      Make sure your dev server is running at:
                    </p>
                    <code className="error-url">{selectedFeature.devUrl}</code>
                    <p className="error-hint">
                      Check that the server is started and accessible.
                    </p>
                  </div>
                ) : (
                  <div className="iframe-loading">
                    <div className="spinner"></div>
                    <p>Loading feature...</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="no-preview">
            <h2>No Dev URL Configured</h2>
            <p>
              Run <code>fusebase feature create</code> to configure a development URL for this feature.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
