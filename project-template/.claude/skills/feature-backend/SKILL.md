---
name: feature-backend
description: "Guide for adding a backend layer (REST API + WebSockets) to Fusebase Apps features. Use when: (1) A feature needs a server-side API beyond the Dashboard SDK, (2) Adding REST endpoints or WebSocket support, (3) Setting up the backend/ folder structure. The backend is OPTIONAL — only add when the feature genuinely requires server-side logic."
---

# Feature Backend

## Multi-User Architecture

**Features are always multi-user.** The backend serves requests from many users concurrently. Every design decision must account for this.

**Per-user vs. shared state:**

| Storage | Scope | Use for |
|---------|-------|---------|
| httpOnly cookies | Per-user (per browser) | OAuth tokens, user preferences, session data |
| Dashboard rows (keyed by user ID) | Per-user (persistent) | User settings, saved state |
| Fusebase secrets / env vars | Shared (all users) | API keys, service-account credentials |
| In-memory variables | Shared (all users, lost on restart) | Short-lived caches only |

**Common mistakes:**
- ❌ Storing a user's OAuth token in an env var or in-memory config → all users share one token
- ❌ Storing a user's preference in a module-level variable → last user's preference wins for everyone
- ❌ Using env vars for per-user settings or selections → same value for everyone
- ✅ Store per-user data in cookies or dashboard rows keyed by user
- ✅ Use env vars only for credentials/config shared across all users (e.g. OAuth client ID/secret)


## When to Add a Backend

A backend is **optional**. Most features work fine with the Dashboard SDK alone (client-side calls to the dashboard service). Only add `backend/` when the feature genuinely needs:

- Custom business logic (aggregations, validations, workflows)
- Real-time push via WebSockets
- Server-side API composition or proxying
- Background processing or scheduled tasks
- Operations that cannot run in the browser (secrets, heavy computation)

**Do NOT add a backend** just for CRUD on dashboard data — use the Dashboard SDK directly from the SPA.

## Structure

```
features/my-feature/
  package.json              ← SPA deps (unchanged)
  vite.config.ts
  src/                      ← SPA code
  backend/                  ← backend (only if needed)
    package.json            ← backend-only deps
    tsconfig.json
    src/
      index.ts              ← entrypoint
      routes/               ← route handlers
      ws/                   ← WebSocket handlers (if needed)
```

Key points:

- `backend/` has its **own `package.json`** — keeps backend deps (Hono, ws libs) out of the SPA bundle
- **No code is shared between SPA and backend** — each side defines its own types independently. Do not create a `shared/` directory
- **Backends are not shared among features** — only the feature that owns the `backend/` folder can access it. Each feature must have its own backend if it needs one; one feature cannot call another feature's backend.
- The SPA `package.json` remains unchanged — no backend deps leak in

## Framework: Hono

Use **Hono** for the backend. It is TypeScript-first, lightweight, and has built‑in WebSocket support. It runs on Node.js and Bun.

### backend/package.json

```json
{
  "name": "my-feature-server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup src/index.ts --format esm --out-dir dist",
    "start": "node dist/index.js",
    "lint": "eslint . --max-warnings 0"
  },
  "dependencies": {
    "hono": "^4.x",
    "@hono/node-server": "^1.x",
    "@hono/node-ws": "^1.x"
  },
  "devDependencies": {
    "tsx": "^4.x",
    "tsup": "^8.x",
    "typescript": "^5.x"
  }
}
```

### backend/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src"]
}
```

### backend/src/index.ts (minimal)

```typescript
import { Hono } from 'hono'
import { serve } from '@hono/node-server'

const app = new Hono().basePath('/api')

app.get('/health', (c) => c.json({ ok: true }))

// Add routes:
// import { itemsRoutes } from './routes/items'
// app.route('/items', itemsRoutes)

const port = Number(process.env.BACKEND_PORT) || 3001

serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on port ${port}`)
})

export default app
```

### Adding WebSockets

```typescript
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'

const app = new Hono().basePath('/api')

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

app.get('/ws', upgradeWebSocket((c) => ({
  onMessage(event, ws) {
    // handle incoming message
    ws.send(JSON.stringify({ echo: event.data }))
  },
  onClose() {
    console.log('Client disconnected')
  },
})))

const port = Number(process.env.BACKEND_PORT) || 3001
const server = serve({ fetch: app.fetch, port })
injectWebSocket(server)
```

## Routing: `/api` is Reserved for the Backend

When a feature has a backend, the `/api` path prefix is **reserved for the backend**. The SPA must not define client-side routes under `/api`.

- Backend routes: `/api/*` (REST endpoints, WebSocket upgrades)
- SPA routes: everything else (`/`, `/items/:id`, `/settings`, etc.)

## Dev Proxy

`fusebase dev start` automatically proxies `/api` HTTP requests and WebSocket upgrades to the backend dev server.

The `BACKEND_PORT` env var is assigned by `fusebase dev start` and injected into both the SPA and backend processes, allowing multiple features to run backends concurrently without port conflicts.

## fusebase.json Backend Config

When a feature has a backend, add the `backend` block to its entry in `fusebase.json`:

```json
{
  "features": [
    {
      "id": "feature-id",
      "path": "features/my-feature",
      "dev": { "command": "npm run dev" },
      "build": { "command": "npm run build", "outputDir": "dist" },
      "backend": {
        "dev": { "command": "npm run dev" },
        "build": { "command": "npm run build" },
        "start": { "command": "npm run start" }
      }
    }
  ]
}
```

`backend.path` is relative to the feature's `path`. `runtime` is `"node"` or `"bun"`.

## Deriving the Public Base URL from the Request

**NEVER hardcode `localhost` in callback/redirect URLs** (e.g. OAuth redirect URIs, webhook URLs, links sent to external services). A feature's backend runs behind a proxy — `localhost` only works during local dev and breaks in production.

Instead, derive the public base URL from the incoming request headers:

```typescript
/** Derive the public base URL from the incoming request. */
function getBaseUrl(req: Request): string {
  const url = new URL(req.url)
  const forwardedProto = req.headers.get('x-forwarded-proto')
  const forwardedHost =
    req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (forwardedHost) {
    const proto = forwardedProto ?? url.protocol.replace(':', '')
    return `${proto}://${forwardedHost}`
  }
  return url.origin
}
```

Usage example (OAuth redirect URI):

```typescript
app.get('/auth/url', (c) => {
  const baseUrl = getBaseUrl(c.req.raw)
  const redirectUri = `${baseUrl}/api/auth/callback`
  // Use redirectUri when building the OAuth authorization URL
})
```

This works in both environments:
- **Local dev**: resolves to `http://localhost:<port>` (via Fusebase dev server proxy forwarding host)
- **Deployed**: resolves to `https://<subdomain>.{FUSEBASE_APP_HOST}` (platform sets `x-forwarded-host` / `x-forwarded-proto`)


## Calling the Backend from the SPA

Use standard `fetch` with relative URLs. Same-origin requests automatically include the `fbsfeaturetoken` cookie, so the backend can authenticate on behalf of the user without depending on a custom header surviving the deployed platform proxy:

```typescript
// In SPA code
const res = await fetch('/api/items')
const data = await res.json()
```

If you still send `x-app-feature-token` from the SPA, treat it as a best-effort dev/proxy optimization only. Backend handlers must always support both sources:

```typescript
import { getCookie } from 'hono/cookie'

const featureToken =
  c.req.header('x-app-feature-token') || getCookie(c, 'fbsfeaturetoken')

if (!featureToken) {
  return c.json({ error: 'Missing feature token' }, 401)
}
```

### Gate security: fail closed for user-facing routes

When backend routes call Gate on behalf of the current user, keep auth in feature-token context only.

- Do not silently fall back to service-account/service-token auth in user-facing routes.
- On missing/invalid feature token or Gate auth rejection, return `401/403` and require re-auth/permission sync.
- Service-token usage is allowed only for explicitly system/admin routes, not as an automatic fallback path.

For WebSockets:

```typescript
const ws = new WebSocket(`wss://${window.location.host}/api/ws`)
ws.onmessage = (event) => {
  const msg: WsMessage = JSON.parse(event.data)
  // handle message
}
```


## Stateless Backend — No Filesystem Writes, No In-Memory Persistence

**The deployed backend is stateless.** The filesystem is ephemeral and in-memory state is lost on restart/redeployment. Do not rely on either for persistent data.

**NEVER:**
- Write to `.env`, JSON, or any local file to persist runtime state
- Use `fs.writeFileSync` / `fs.writeFile` for data that must survive restarts
- Store tokens, credentials, or user data on the local filesystem
- Use SQLite or file-based databases
- Store persistent state only in backend memory (lost on restart)

**Instead, use:**
- **httpOnly cookies** — for per-user credentials obtained at runtime (e.g. OAuth refresh tokens). The browser sends them automatically; the backend stays stateless. This is the **preferred approach** for user-specific tokens.
- **Fusebase dashboards** — for persistent runtime data shared across users (via Dashboard SDK in backend code)
- **Fusebase secrets** (env vars) — for shared credentials set at deploy time (API keys, service-account tokens). Not suitable for per-user or dynamically obtained tokens.
- **In-memory caches** — acceptable only for short-lived caches (e.g. access tokens derived from a refresh token in a cookie). Must be re-derivable from persistent source.

**Example — OAuth token flow (httpOnly cookie):**
When an OAuth callback returns a refresh token, store it in an httpOnly cookie:

```typescript
import { setCookie, getCookie } from 'hono/cookie'

// In the OAuth callback handler:
setCookie(c, 'oauth_refresh_token', tokens.refresh_token, {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/',
  maxAge: 60 * 60 * 24 * 365, // 1 year
})

// In API handlers — read token from cookie, fall back to env var:
const refreshToken = getCookie(c, 'oauth_refresh_token') ?? process.env.REFRESH_TOKEN ?? ''

// ❌ Wrong: writing to filesystem
writeFileSync('.env', `REFRESH_TOKEN=${tokens.refresh_token}`)

// ❌ Wrong: relying solely on in-memory state
config.refreshToken = tokens.refresh_token  // lost on restart
```

## Dev Workflow

1. `cd features/my-feature/backend && npm install` — install backend deps
2. `fusebase secret create --feature <id> --secret "KEY:description"` — register secrets (if needed), set values via the printed URL
3. `fusebase dev start` — starts both SPA and backend; secrets are injected automatically as env vars

**No `.env` files or `dotenv` needed** — `fusebase dev start` injects secrets into the backend process.

## Checklist

Before adding a backend:

- [ ] Confirmed the feature **genuinely needs** backend logic (not just dashboard CRUD)
- [ ] Created `backend/` with its own `package.json` and `tsconfig.json`
- [ ] Set up Hono with `.basePath('/api')`
- [ ] Verified `fusebase dev start` proxies `/api` to backend (automatic when `backend` block exists in `fusebase.json`)
- [ ] Updated `fusebase.json` with `backend` block
- [ ] SPA does not define routes under `/api`
- [ ] No `.env` files or `dotenv` — secrets injected by `fusebase dev start`
