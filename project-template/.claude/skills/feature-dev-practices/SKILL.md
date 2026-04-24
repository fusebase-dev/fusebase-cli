---
name: feature-dev-practices
description: "Practical guide for building Fusebase Apps features. Use when: (1) Creating a new feature, (2) Setting up project structure, Vite config, or authentication, (3) Building or registering features, (4) Configuring permissions or public access, (5) Navigating between features, (6) Fetching user details, (7) Troubleshooting build issues."
---

# Feature Dev Practices

## Always Scaffold First

Run `fusebase scaffold --template spa --dir features/<name>` before writing any feature files. This generates the canonical React + Vite + Tailwind v4 + shadcn/ui project structure. For features needing a backend, also run `fusebase scaffold --template backend --dir features/<name>`. Customize from there — never recreate boilerplate by hand.

## Multi-User by Default

**Every feature is multi-user.** Multiple users access the same deployed feature simultaneously, each with their own identity (feature token). Never design for a single user.

**Rules:**
- **Per-user state** (OAuth tokens, preferences, selections) must be stored **per-user** — use httpOnly cookies (set by the server, scoped to the user's browser) or dashboard rows keyed by user ID
- **Shared env vars / Fusebase secrets** are global — they are the **same for all users**. Never use them for per-user credentials or settings
- **In-memory backend variables** are shared across all requests from all users — never store per-user data in module-level variables
- When integrating third-party APIs with OAuth, each user must go through their own auth flow and get their own tokens

- **Stable partition keys only:** when storing per-user rows, the partition key must come from a **stable identity** (`userId`, `orgUserId`, email if immutable), not from session/token artifacts.
- **Never use token-derived keys** (e.g. `ft:*`, JWT fragments, rotating session IDs) as persistent `user_key`/partition keys — they change between sessions and split one user's data into multiple buckets.
- **Recommended format:** normalize once in backend (`user:<userId>`) and reuse the same key for both read and write paths.

**Ask yourself:** "If two users open this feature at the same time, will they interfere with each other?" If yes, the design is wrong.


## Project Structure

Features are React/Vite apps in `features/`:

```
features/
  my-feature/
    package.json
    vite.config.ts
    src/
      App.tsx
      main.tsx
```

Use existing features in `features/` as reference when building new ones.

### Vite Config: Ignore Logs Directory

`fusebase dev start` writes debug logs to `<feature-dir>/logs/`. Tell Vite's file watcher to ignore this directory so it doesn't trigger unnecessary reloads:

```ts
// vite.config.ts
export default defineConfig({
  server: {
    watch: {
      ignored: ['**/logs/**'],
    },
  },
  // ...rest of config
});
```

**Always include this in every feature's `vite.config.ts`.**

### Vite Config: Do NOT add inline `css.postcss`

Do **NOT** add a `css.postcss` block in `vite.config.ts`. An inline `css` config — even with an empty `plugins` array — **overrides** the external `postcss.config.js` entirely, silently disabling Tailwind and all other PostCSS plugins.

```ts
// ❌ BROKEN — overrides postcss.config.js, Tailwind never runs
export default defineConfig({
  css: {
    postcss: {
      plugins: [],
    },
  },
});
```

```ts
// ✅ CORRECT — no css.postcss block; Vite picks up postcss.config.js automatically
export default defineConfig({
  plugins: [react()],
  // ...rest of config
});
```

PostCSS plugins (`@tailwindcss/postcss`, `autoprefixer`) belong in `postcss.config.js` only.

### Backend (Optional)

Features may optionally include a `backend/` subfolder for a backend API (REST + WebSockets). **Do not add a backend unless the feature genuinely needs backend logic** — most features work fine with the Dashboard SDK alone. See skill **feature-backend** for when and how to add one. The backend is served at `/api`.

## Authentication

<% if (it.flags?.includes("portal-specific-features")) { %>
Features run as the main window. The platform provides a feature token via `window.FBS_FEATURE_TOKEN` (with `fbsfeaturetoken` cookie fallback when needed).
<% } else { %>
Features run as the main window. The platform sets a `fbsfeaturetoken` cookie automatically.
<% } %>

**Startup flow:**

<% if (it.flags?.includes("portal-specific-features")) { %>
1. Read feature token on app load from `window.FBS_FEATURE_TOKEN` first; if missing, fall back to `fbsfeaturetoken` cookie
<% } else { %>
1. Read feature token on app load: check `fbsfeaturetoken` cookie first, fall back to `window.FBS_FEATURE_TOKEN` if the cookie is absent
<% } %>
2. Render app once token is available (show loading state until then)
3. Pass token via `x-app-feature-token` for direct SDK / Fusebase proxy calls
4. For calls to the app's own backend (`/api/*`), rely on the same-origin cookie and make backend handlers read `x-app-feature-token` or fallback to `fbsfeaturetoken`

**All features MUST handle token expiration** (`AppTokenValidationError` / 401). See skill **handling-authentication-errors** for the implementation pattern.

## User Details

<% if (it.flags?.includes("portal-specific-features")) { %>
Fetch auth context:

```typescript
type AuthContextResponse = {
  user?: {
    id: number
    email: string
  }
  org?: {
    globalId: string
  }
  runtimeContext?: {
    portalId?: string
    workspaceId?: string
  }
}

const response = await fetch('https://app-api.{FUSEBASE_HOST}/v4/api/auth/context', {
  headers: { 'x-app-feature-token': featureToken },
})
const authContext: AuthContextResponse = response.ok ? await response.json() : {}
const user = authContext.user ?? null
// authenticated: { id: 4124, email: "testemail@gmail.com" }
// anonymous visitor on a public feature: null (user field is missing)
// portal/workspace context (if available): authContext.runtimeContext
```

Important for public features:

- A visitor feature token may be valid even when `/auth/context` returns no `user`
- Missing `user` means "not authenticated", not "session expired"
- `/auth/context` should not throw just because the visitor is anonymous
<% } else { %>
Fetch current user:

```typescript
const response = await fetch('https://app-api.{FUSEBASE_HOST}/v4/api/users/me', {
  headers: { 'x-app-feature-token': featureToken },
})
const user = response.ok ? await response.json() : null
// authenticated: { id: 4124, email: "testemail@gmail.com" }
// anonymous visitor on a public feature: null
```

Important for public features:

- A visitor feature token may be valid even when `/users/me` returns 401
- In that case, treat the result as `user: null`, not as "session expired"
<% } %>
- Show the login/auth form for anonymous visitors
- Only show a "Session Expired" modal for actual `AppTokenValidationError` flows

See skill **handling-authentication-errors** for the exact 401 handling rules.

## Navigation

Use standard browser navigation (React Router, etc.) since features run as the main window. For routing setup, see skill **feature-routing**.

## UI Framework

Use **shadcn/ui**. For design and UX guidance (layout, tokens, components, accessibility), see skill **app-ui-design**.

## Building Features

```bash
cd features/my-feature
npm run build
```

### devDependencies Missing

If `npm run build` fails because vite/typescript are not found, npm may be running in production mode (`NODE_ENV=production` — common in VS Code / Claude Code). Fix:

```bash
npm install --include=dev
```

### Typecheck at project root

From the repo root, `npm run typecheck` runs `tsc` for each feature (see root `package.json`). It catches strict TypeScript issues that ESLint does not, including the same failures as `tsc` inside `fusebase deploy`’s build. Claude Code Stop hooks run it after lint.

## Registering Features

After creating a feature, register it via `fusebase feature create` from the project root:

```bash
fusebase feature create --name <name> --subdomain <subdomain> --path <path> --dev-command <command> --build-command <command> --output-dir <dir>
```


**Execute this command automatically** after writing the feature code — do not ask the user to run it manually.

### Access Principals

Use `--access` to control who can access the feature. Principals are comma-separated:

```bash
# Public (visitor) access
fusebase feature create --name <name> --access=visitor
fusebase feature update <featureId> --access=visitor

# Org role access (guest, client, member, manager, owner)
fusebase feature update <featureId> --access=orgRole:member
fusebase feature update <featureId> --access=orgRole:member,orgRole:client

# Combine visitor and org roles
fusebase feature update <featureId> --access=visitor,orgRole:member
```

### Permissions

Use `--permissions` with `fusebase feature create` when the feature is first registered. Only use `fusebase feature update --permissions` when changing permissions on an already-registered feature. Use MCP to discover dashboard/view IDs. See skill **fusebase-cli** for permission format and examples.

## Getting Feature URLs

```bash
fusebase feature list
```

Lists all features with their deployed URLs. Use this to get actual URLs — do NOT hardcode or guess them.

**Always use the full subdomain URL** (read `FUSEBASE_APP_HOST` from `.env`, e.g. `https://my-feature.{FUSEBASE_APP_HOST}/`), never relative paths. Each feature is served from its own subdomain root — see skill **feature-routing**.

## Cross-Feature Navigation

Use standard browser navigation (`<a>`, `window.location`) with full feature URLs obtained from `fusebase feature list`.
