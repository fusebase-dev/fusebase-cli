---
version: "1.0.0"
mcp_prompt: appMagicLinks
last_synced: "2026-05-06"
title: "Fusebase Gate App Magic Link Operations"
category: specialized
---
# Fusebase Gate App Magic Link Operations

> **MARKER**: `mcp-app-magic-links-loaded` — When this marker is present in context, MCP prompts for this topic may skip conceptual sections and use API reference only.

> **VERSION CHECK**: If operations fail unexpectedly, load MCP prompt `appMagicLinks` for latest content.

---
## Fusebase Gate App Magic Link Operations

These operations expose one-click client onboarding for AI Apps. They mirror the portal magic-link flow but live on the app subdomain (`https://{featureSub}.{domain}/link?id=…&redirect=…`) and target the `nimbus-ai` storage layer through Gate.

## Relevant Operations

- `createAppMagicLink` — owner/admin invite flow. Creates a 24h magic link for an email and dispatches it via the `magic_link_app` mail template. Optionally provisions a brand-new user and adds a user principal to every feature of the app.
- `requestAppMagicLink` — visitor self-service flow. Visitor enters their email; Gate forwards to nimbus-ai which sends a magic link only when the email already has access under the app's current `accessPrincipals`. Always returns `{ ok: true }` so it cannot be used to enumerate emails or access state.
- `activateAppMagicLink` — visitor activation. Exchanges a magic-link `globalId` for a session token, a Gate feature token, and a Dashboard feature token, plus the `redirectPath` the SPA must navigate to.

## When To Use Each Flow

- Use `createAppMagicLink` when the caller is the app owner/admin and wants to invite a known client by email. This is the right call for proposal/invoice deep-link delivery (set `redirectPath` to the deep page).
- Use `requestAppMagicLink` from the app's own login form (the `/link` page or a sign-in screen) when a visitor types their email and asks for a magic link. Never call it from the owner-side admin UI.
- Use `activateAppMagicLink` from the SPA's `/link` route — the visitor lands on `/link?id={globalId}&redirect={path}`, the SPA calls activate, sets the session cookie, persists the feature token, and redirects.

## Identity And Scoping Rules

- `createAppMagicLink` is org-scoped: `orgId` and `appId` are required path inputs, and the caller must hold `app_magic_link.write` on that org plus org access.
- `requestAppMagicLink` is app-scoped by host: the `host` path param is the visitor's current hostname (`window.location.host`); Gate resolves it to an app feature.
- `activateAppMagicLink` is link-scoped: `globalId` is the random id from the email URL; possession of the id is the only credential.
- Treat `globalId`, `appId`, and `appFeatureId` as opaque strings. Reuse values returned by previous responses.
- The visitor endpoints intentionally run with `AuthModuleContract.accessVisitor()`: do not attach a session cookie or feature token before calling them.

## Invite Flow Rules (`createAppMagicLink`)

- Body fields: `email` (required), `redirectPath` (optional; defaults to `/`), `addToAccessPrincipals` (optional; defaults to true).
- `addToAccessPrincipals: true` provisions the user record if needed and appends `{ type: "user", id: <userId> }` to every feature of the app, de-duplicated. Use this when inviting a brand-new client.
- `addToAccessPrincipals: false` is only valid for emails that already have access. Sending it with an unknown email returns 404 — by design, so the caller does not silently dispatch a useless link.
- The response is `{ id, magicLinkUrl, expiresAt }`. `id` is the `globalId` and is also embedded inside `magicLinkUrl`.
- Mail dispatch errors are logged but do not roll the row back; the owner can still copy `magicLinkUrl` from the response.

## Self-Service Rules (`requestAppMagicLink`)

- Body fields: `email` (required), `redirectPath` (optional).
- Response is always `{ ok: true }`. Do not try to infer success/failure from the response — by design it cannot be used to enumerate.
- Apply per-IP rate limiting upstream of this call (e.g. CDN, ingress, or app-level middleware). nimbus-ai layers an internal per-`(orgId, appId, email)` 30-second cooldown so a typo-then-retry loop does not spam the inbox, but that is not a substitute for IP rate limiting.
- This endpoint never mutates `accessPrincipals` and never provisions users. Visitors who do not already have access stay unauthorized.

## Activation Rules (`activateAppMagicLink`)

- The SPA at `/link` reads `id` and `redirect` from the query string, then activates the link by issuing `POST {gateBaseUrl}/apps/magic-links/{id}/activate`. The bundled SPA template currently calls this endpoint directly via `fetch` so it stays usable before `@fusebase/fusebase-gate-sdk` exposes `AppMagicLinksApi.activateAppMagicLink`. Once that SDK ships, prefer `activateAppMagicLink({ path: { globalId: id } })` over hand-rolled fetches; the wire request is identical (the server already stored `redirectPath` on the link row at create time, so the client never sends it on activation).
- Successful response: `{ id, sessionToken, featureToken, dashboardToken, redirectPath, expiresAt, appFeatureId }`.
  - `sessionToken` — set as the `eversessionid` cookie on the app subdomain so subsequent calls authenticate.
  - `featureToken` — Gate feature token; persist via the existing scaffold convention (`postMessage`, cookie `fbsfeaturetoken`, etc.).
  - `dashboardToken` — dashboard-service feature token, scoped to the same app and target user. The bundled SPA persists it as the `fbsdashboardtoken` cookie so dashboard SDK calls (`@fusebase/dashboard-service-sdk`) can authenticate after activation; in the deployed app-wrapper flow it is bundled inside the gate feature token JWT, but the magic-link activation hands both tokens out as discrete strings.
  - `redirectPath` — relative path to navigate to after token persistence (`/` if the invite did not request a deep link).
  - `expiresAt` is included so the SPA can mirror the same expired UI without a second round-trip.
- Within the 24h TTL the link can be activated more than once (covers the "user opened the email twice" case).
- Failure modes are well-typed:
  - `404 NotFound` — link id does not exist or the row is soft-deleted.
  - `403 Forbidden` with `reason="expired"` — TTL elapsed; show the expired-link UI and offer a request-link flow.
  - `403 Forbidden` with `reason="revoked"` — the target user no longer has access at activation time (principals mutated after the link was issued); fall back to the same expired-link UI or show "this link is no longer valid".
- The SPA should branch on the `reason` field rather than the HTTP status alone so error copy stays stable as new reasons are added.

## Deep-Link Redirect Usage

- `redirectPath` is opaque to Gate; nimbus-ai stores it verbatim on the link row and returns it on activation.
- Always make `redirectPath` relative (`/proposals/abc`, `/invoices/123`). Absolute URLs would let the inviter point the activation to an unrelated origin.
- The SPA is responsible for sanitizing `redirectPath` before navigating (reject schemes, reject `//host…` patterns) — Gate does not enforce this.
- Pair `redirectPath` with the email subject the owner sends so the deep page matches the user's expectation ("View your proposal" → `/proposals/abc`).

## Expired-Link Handling

- Gate surfaces 403 with `reason=expired` exactly when `expiresAt < now()`. Show a clear message ("This link has expired") plus a button that re-runs the self-service flow (`requestAppMagicLink`) with the previously-attempted email and `redirectPath`.
- Do not retry the activate call automatically on 403 — the link is already dead. Trying again only confuses the user.
- For `reason=revoked`, do not offer the request-link flow blindly: the user's access was removed deliberately. Either show a generic "link is no longer valid" message or route them through the standard sign-in / request-access path.

## Access Model

- `createAppMagicLink` requires `app_magic_link.write` plus org access. Granted by default to `owner`, `manager`, `member`, and `guest` org roles via the existing `GATE_ALL_PERMISSIONS` set.
- `requestAppMagicLink` and `activateAppMagicLink` are visitor endpoints (no permission, no session). The policy is enforced inside nimbus-ai by re-evaluating `accessPrincipals` against the resolved user.

## Working Rules

- Always inspect the exact contract with `tools_describe` or `sdk_describe` before integration work — the request and response shapes are versioned independently from this prompt.
- For app templates that ship with a sign-in form, wire the form to `requestAppMagicLink` and the `/link` route to `activateAppMagicLink`. Never persist the magic link `id` past activation; treat it as single-flow credential material.
- For owner-side admin UI, prefer `createAppMagicLink` with `addToAccessPrincipals=true` for first-time invites and `addToAccessPrincipals=false` for re-invites of users who already have access.
- If activation fails, do not assume `accessPrincipals` is the wrong shape; re-read the `reason` field and follow the expired-link handling rules above.
---

## Version

- **Version**: 1.0.0
- **Category**: specialized
- **Last synced**: 2026-05-06
- **Priority rule**: If the MCP prompt has a higher version, follow the prompt's API Reference as source of truth.
