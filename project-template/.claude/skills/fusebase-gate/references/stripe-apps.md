---
version: "1.0.0"
mcp_prompt: stripeApps
last_synced: "2026-04-06"
title: "Fusebase Gate Stripe App And Agent Integration"
category: specialized
---
# Fusebase Gate Stripe App And Agent Integration

> **MARKER**: `mcp-stripe-apps-loaded` — When this marker is present in context, MCP prompts for this topic may skip conceptual sections and use API reference only.

> **VERSION CHECK**: If operations fail unexpectedly, load MCP prompt `stripeApps` for latest content.

---
## Fusebase Gate Stripe App And Agent Integration

Use these rules when Stripe operations are called from application code, a backend or BFF, or an agent acting on behalf of one organization.

## Current Gate Stripe Surface

- Gate currently exposes an org-scoped Stripe billing facade, not a generic Stripe passthrough.
- Current Stripe operation ids are: `getStripeOauth`, `updateStripeMode`, `findStripeProduct`, `createStripeProduct`, `updateStripeProduct`, `deleteStripeProduct`, `getStripePaymentLink`, and `getStripePaymentState`.
- `getStripeOauth` returns the connected `stripeAccountId` and current `liveMode`.
- `updateStripeMode` changes the connected account between test and live API modes only. It does not copy products or prices between modes.

## App Integration Rules

- Do not expose raw Stripe platform secret keys to the browser or to an agent.
- Do not build a frontend flow that calls Stripe directly for Gate-managed billing objects if your app relies on Gate product records, checkout links, or webhook-backed payment state.
- Frontend code should usually call your backend or BFF, and that backend should call Gate.
- Backend and agent calls should use org-scoped Gate credentials with only the billing permissions they need.
- Prefer short-lived, org-scoped tokens for agents instead of broad human session reuse.

## Stripe Object Identity

- Treat `stripeAccountId` as the source-of-truth connected account id for product and checkout calls.
- Treat app-owned `kind` and `kindId` as stable identifiers for the commercial object in your system. Those values must remain stable across checkout and later payment-state reads.
- If the app changes a product materially, use `updateStripeProduct` or delete plus create. Do not assume in-place Stripe product editing is reflected in Gate billing records.

## Recommended Runtime Flow

1. Call `getStripeOauth` for the org.
2. If needed, switch mode with `updateStripeMode` and refresh UI from the returned `oauth.liveMode`.
3. Find or create the Gate-managed Stripe product using stable `kind` and `kindId`.
4. Use `getStripePaymentLink` to obtain the Stripe-hosted checkout URL.
5. After checkout or webhook processing, use `getStripePaymentState` before unlocking the entitlement.

## Access Model

- Read-only Stripe inspection needs `billing.read` plus org access.
- Mode switching, product writes, deletion, and checkout-link generation need `billing.write` plus org access.
- If a Stripe call fails, debug org scope, billing permissions, connection state, and `liveMode` before changing app payload semantics.

## Reference

- For a longer app-facing guide, use the generated reference copied from `docs/stripe-for-apps-and-agents.md` when it is available in the MCP skill bundle.
---

## Version

- **Version**: 1.0.0
- **Category**: specialized
- **Last synced**: 2026-04-06
- **Priority rule**: If the MCP prompt has a higher version, follow the prompt's API Reference as source of truth.
