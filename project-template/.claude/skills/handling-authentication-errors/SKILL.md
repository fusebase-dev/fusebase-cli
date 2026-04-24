---
name: handling-authentication-errors
description: "Required implementation pattern for handling AppTokenValidationError (401) responses when feature tokens expire. Use when: 1. Building any Fusebase Apps feature that makes API calls, 2. Implementing authentication error handling, 3. Creating AuthExpiredModal components, 4. Setting up global error handlers in App.tsx. All features MUST implement this pattern to handle token expiration gracefully."
---

# Handling Authentication Errors

All features **MUST** handle `AppTokenValidationError` responses from the API. When the feature token expires, the API returns a 401 with this body:

```json
{
  "name": "AppTokenValidationError",
  "message": "Fail to validate app token",
  "reason": "expired"
}
```

## Implementation

### 1. Detect `AppTokenValidationError` in API calls

The error name may appear at different nesting levels depending on the SDK. Check all of them:

```typescript
function isAppTokenValidationError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const err = error as any
    const names = [err.name, err.data?.name, err.error?.name, err.body?.name]
    return names.includes('AppTokenValidationError')
  }
  return false
}
```

Create a custom `AuthTokenExpiredError` class. In every API call's catch block, check with the function above and throw `AuthTokenExpiredError` if matched; otherwise rethrow.

### 2. Show a "Session Expired" modal

When `AuthTokenExpiredError` is caught at the UI level, display a centered modal:

- **Title**: "Session Expired"
- **Message**: "Your authentication expired, please refresh the page to authenticate again."
- **Buttons**: "Refresh page" (calls `window.location.reload()`) and "Cancel" (closes modal)

Manage modal open/close state in `App.tsx` and pass an `onAuthError` callback to child components that make API calls.

<% if (it.flags?.includes("portal-specific-features")) { %>
## Critical: `/auth/context` Behavior

The `/auth/context` endpoint **MUST NOT** trigger `AuthTokenExpiredError` just because `user` is missing.

When a feature is **public**, anonymous visitors may receive an auth context with no `user` field. This is expected — it means "not authenticated", NOT "session expired". Throwing `AuthTokenExpiredError` here causes the Session Expired modal to appear immediately for every anonymous visitor.

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

export async function fetchAuthContext(
  featureToken: string
): Promise<AuthContextResponse> {
  try {
    const response = await fetch(
      'https://app-api.{FUSEBASE_HOST}/v4/api/auth/context',
      { headers: { 'x-app-feature-token': featureToken } }
    )
    if (!response.ok) return {} // Do NOT throw AuthTokenExpiredError here
    return await response.json()
  } catch {
    return {}
  }
}
```

### Rule of thumb

- **`/auth/context` with missing `user`** → treat as anonymous/guest
- **`/auth/context` request failure** → handle gracefully without forcing "Session Expired"
- **Dashboard/data API 401 with `AppTokenValidationError`** → throw `AuthTokenExpiredError` (session expired)
<% } else { %>
## Critical: `/users/me` Exception

The `/users/me` endpoint **MUST NOT** trigger `AuthTokenExpiredError`.

When a feature is **public**, anonymous visitors receive a 401 from `/users/me`. This is expected — it means "not authenticated", NOT "session expired". Throwing `AuthTokenExpiredError` here causes the Session Expired modal to appear immediately for every anonymous visitor.

```typescript
export async function fetchCurrentUser(
  featureToken: string
): Promise<{ id: number; email: string } | null> {
  try {
    const response = await fetch(
      'https://app-api.{FUSEBASE_HOST}/v4/api/users/me',
      { headers: { 'x-app-feature-token': featureToken } }
    )
    if (!response.ok) return null // Do NOT throw AuthTokenExpiredError
    return await response.json()
  } catch {
    return null
  }
}
```

### Rule of thumb

- **`/users/me` 401** → return `null` (user is anonymous/guest)
- **Dashboard/data API 401 with `AppTokenValidationError`** → throw `AuthTokenExpiredError` (session expired)
<% } %>
