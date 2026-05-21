---
version: "1.0.0"
mcp_prompt: fusebaseAuth
last_synced: "2026-05-21"
title: "Fusebase Auth For AI Apps"
category: specialized
---
# Fusebase Auth For AI Apps

> **MARKER**: `mcp-fusebase-auth-loaded` — When this marker is present in context, MCP prompts for this topic may skip conceptual sections and use API reference only.

> **VERSION CHECK**: If operations fail unexpectedly, load MCP prompt `fusebaseAuth` for latest content.

---
## Fusebase Auth For AI Apps

These operations help AI Apps add Fusebase account registration, login, logout, password restore, challenge/MFA completion, and optional org onboarding without calling auth-form directly from the browser.

## Relevant Operations

- `registerFusebaseUser` — visitor-safe email/password registration. Creates a Fusebase account through auth-form and returns a `sessionId` plus `userId` when registration succeeds. It does not add org membership.
- `registerFusebaseOrgMember` — protected registration plus org provisioning. Creates the Fusebase account, then adds the new user to the path `orgId`. Requires `org.members.write` and org access. Use this only on registration, not on login.
- `loginFusebaseUser` — visitor-safe email/password login. Returns `sessionId` plus `userId`, or a challenge. Never provisions org membership.
- `completeFusebaseAuthChallenge` — completes auth-form challenges such as CAPTCHA, OTP, mail OTP, two-factor, and MFA states returned by register/login.
- `requestFusebasePasswordRestore` — sends restore email through auth-form. It returns a generic `{ ok: true }` and must not be used for account enumeration.
- `checkFusebasePasswordRestoreKey` and `resetFusebasePassword` — validate and complete password reset through user-service restore sessions.
- `logoutFusebaseUser` — returns the app-domain cookies that the app must clear. Gate cannot delete cookies for an AI App host.

## Architecture Rules

- All calls to auth-form must go through a backend or Gate operation. Do not `fetch()` auth-form directly from the SPA because the app host and auth host are different origins and CORS/session cookies will not behave correctly.
- The returned `sessionId` is credential material. A server/BFF should set it as an app-domain cookie such as `eversessionid` with `httpOnly`, `secure`, `sameSite=Lax`, and `path=/` where possible.
- After register, login, or challenge success, route the user to the returned `redirectPath`. Always keep redirect paths relative (`/dashboard`, `/tasks/123`) and reject absolute URLs or `//host` forms.
- Use `registerFusebaseOrgMember` only for a brand-new registration flow. Do not add org membership during ordinary login because login must not mutate roles or downgrade existing access.
- For app access decisions after auth or provisioning, check the user's actual org/app access before unlocking protected content. Do not treat a successful write as a substitute for an access check.

## Org Onboarding

- `registerFusebaseOrgMember` path is `/:orgId/auth/fusebase/register-member`; the org comes from the path, not from user input in the body.
- Default org role is `client`. Send `orgRole` only when the app intentionally grants another role and the caller has permission to do so.
- The operation uses `org.members.write`; expose it only through a trusted app backend or a properly scoped feature token. Do not build an unauthenticated public form that can choose arbitrary org ids or roles.
- If auth-form returns a challenge during registration, complete the challenge first and retry the registration flow as appropriate. Membership is added only after an authenticated registration response includes a `userId`.

## Challenge, 2FA, And MFA

- `loginFusebaseUser` and `registerFusebaseUser` can return `status: "challenge_required"` with `challenge.type` and `challenge.state` instead of a session.
- Render the required challenge UI, then call `completeFusebaseAuthChallenge` with `{ state, answer }`.
- OTP/MFA challenge success returns `status: "authenticated"` and a session. A failed or reissued challenge can return another `challenge_required` response.
- Never log passwords, challenge answers, or session ids. Flow ids are fine for diagnostics; credential values are not.

## Password Restore

- `requestFusebasePasswordRestore` forwards `email` as auth-form `login` and may pass `customAuthUrl`, `portalId`, and `workspaceId` when the app needs branded restore routing.
- The restore request intentionally returns only `{ ok: true }`. The UI should always show generic copy such as "If an account exists, we sent instructions."
- Use `checkFusebasePasswordRestoreKey` for the reset screen and `resetFusebasePassword` to set the new password. These depend on `USER_SERVICE_URL` being configured for Gate.

## Google Auth

- Google auth is still an auth-form redirect/OpenID flow, not a Gate JSON credential exchange. Use auth-form's Google/OpenID route or embedded auth-form template with Fusebase's configured Google Client ID.
- After the redirect flow produces a Fusebase session, the AI App should persist the app-domain session cookie and route to the requested relative path using the same redirect rules as email/password login.
- Do not introduce a second Google Client ID in the AI App unless the Fusebase auth-form/OpenID configuration has explicitly been changed to trust it.

## Common Pitfalls

- Do not put these app routes under `/api/auth/*` in generated app backends; deployed platform proxies may reserve that prefix. Prefer `/api/account/*` or another app-owned prefix.
- Do not confuse Fusebase platform cookies with app-domain cookies. The app must own its fallback session cookie on its own domain.
- Do not call org provisioning from login. If a user already has a stronger role, a login-time provisioning call can accidentally change the intended access model.
- Do not expose `sessionId` to localStorage. Prefer server-set cookies; if a pure SPA has to handle it, keep the lifetime short and document the tradeoff.
---

## Version

- **Version**: 1.0.0
- **Category**: specialized
- **Last synced**: 2026-05-21
- **Priority rule**: If the MCP prompt has a higher version, follow the prompt's API Reference as source of truth.
