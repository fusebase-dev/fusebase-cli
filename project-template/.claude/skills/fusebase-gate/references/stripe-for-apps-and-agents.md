---
version: "1.0.0"
mcp_prompt: none
source: "docs/stripe-for-apps-and-agents.md"
last_synced: "2026-04-07"
title: "Stripe for apps and agents (Gate)"
category: specialized
---
# Stripe for apps and agents (Gate)

> **SOURCE**: This file is copied from `docs/stripe-for-apps-and-agents.md` in the fusebase-gate repo. Edit that file, then run `npm run mcp:skills:generate`.

---
# Gate Stripe For Apps And Agents

This guide explains what Fusebase Gate currently supports for Stripe, how app code should call it, and how an agent should be authorized.

## What Gate Supports Today

Gate currently exposes an org-scoped Stripe billing facade, not a generic Stripe passthrough.

Available Stripe operations:

- `getStripeOauth`
  Checks whether the org has a connected Stripe account and returns `stripeAccountId` plus `liveMode`.
- `updateStripeMode`
  Switches the connected Stripe account between test and live mode. This is a fast key-mode switch only. It does not copy products or prices between modes.
- `findStripeProduct`
  Finds a Gate-managed Stripe product or price by `stripeAccountId`, `kind`, `kindId`, or `mode`.
- `createStripeProduct`
  Creates a Gate-managed payment or subscription product.
- `updateStripeProduct`
  Replaces a product as delete plus create. Do not assume in-place Stripe edits.
- `deleteStripeProduct`
  Marks a Gate-managed product as deleted.
- `getStripePaymentLink`
  Creates or returns a Stripe-hosted checkout URL.
- `getStripePaymentState`
  Returns the latest webhook-backed active state for a buyer and product identity.

## What Gate Does Not Support Yet

- A generic Stripe API proxy
- Direct Stripe product administration outside the Gate `kind` and `kindId` model
- Stripe customer list endpoints
- Stripe invoice history endpoints
- Stripe subscription list endpoints
- Trial subscription creation through Gate

## Key Rules

- Always call `getStripeOauth` before product or checkout flows if the org may not be connected yet.
- Treat `stripeAccountId` as the source-of-truth connected Stripe account identifier.
- Use stable app-owned `kind` and `kindId` values. That is how Gate maps checkout and webhook-backed payment state back to your app concept.
- `buyerId` for `getStripePaymentLink` and `getStripePaymentState` must be a number. Pass `buyerId: user.id`, not `buyerId: String(user.id)`.
- For `mode: "subscription"`, send both `interval` and `intervalCount`.
- For `mode: "payment"`, omit `interval` and `intervalCount`.
- `updateStripeMode` only changes which Stripe API key mode is used for that connected account. It does not migrate existing Stripe catalog state.

## Common Checkout Mistake

If Gate returns a 400 with `body.buyerId: invalid_type`, the app probably sent `buyerId` as a string.

Use:

```ts
buyerId: user.id;
```

Do not use:

```ts
buyerId: String(user.id);
```

## MCP Prompt Groups

Current Stripe billing operations attach these MCP prompt groups:

- `authz`
- `sdk`
- `billing`
- `stripeApps`

## Permissions

Stripe operations are org-scoped and require org access plus billing permissions.

- `billing.read`
  `getStripeOauth`, `findStripeProduct`, `getStripePaymentState`
- `billing.write`
  `updateStripeMode`, `createStripeProduct`, `updateStripeProduct`, `deleteStripeProduct`, `getStripePaymentLink`

## Recommended Auth Model

### Frontend

Do not give the browser raw Stripe platform keys and do not use Gate internal auth from the browser.

Recommended pattern:

1. Browser authenticates into your app.
2. Browser calls your backend or BFF.
3. Your backend calls Gate using the current user context or a short-lived scoped token.
4. Your backend returns the result the UI needs, such as Stripe connection state, checkout URL, or payment state.

This keeps Stripe mode-switching and product management behind your application boundary.

### Backend Or BFF

Use the Gate SDK and call `BillingApi`.

Use a credential that is both:

- scoped to the target org
- limited to `billing.read` and or `billing.write` as needed

### Agent

For an agent, the safest pattern is:

1. Your backend mints or provides a short-lived Gate token for one org.
2. The token only includes the billing permissions the agent actually needs.
3. The agent calls Gate through the SDK or MCP.

Do not give the agent raw Stripe API secrets. Let Gate enforce org scope and billing permissions.

## SDK Example

```ts
import { BillingApi, createClient } from "@fusebase/fusebase-gate-sdk";

const client = createClient({
  baseUrl: process.env.GATE_BASE_URL!,
  auth: {
    token: process.env.GATE_TOKEN!,
  },
});

const billingApi = new BillingApi(client);
```

Check Stripe connection:

```ts
const oauth = await billingApi.getStripeOauth({
  path: { orgId },
  body: {},
});

if (!oauth.oauth?.stripeAccountId) {
  throw new Error("Org is not connected to Stripe");
}
```

Switch live or test mode:

```ts
const modeUpdate = await billingApi.updateStripeMode({
  path: { orgId },
  body: {
    stripeAccountId: oauth.oauth.stripeAccountId,
    liveMode: true,
  },
});
```

Create a one-time payment product:

```ts
const created = await billingApi.createStripeProduct({
  path: { orgId },
  body: {
    stripeAccountId: oauth.oauth!.stripeAccountId!,
    mode: "payment",
    amountCents: 1999,
    currency: "usd",
    title: "Premium Course",
    kind: "course",
    kindId: "course_123",
  },
});
```

Create a subscription product:

```ts
const created = await billingApi.createStripeProduct({
  path: { orgId },
  body: {
    stripeAccountId: oauth.oauth!.stripeAccountId!,
    mode: "subscription",
    amountCents: 9900,
    currency: "usd",
    title: "Pro Plan",
    kind: "plan",
    kindId: "plan_pro",
    interval: "month",
    intervalCount: 1,
  },
});
```

Get checkout URL:

```ts
const checkout = await billingApi.getStripePaymentLink({
  path: { orgId },
  body: {
    stripeAccountId: oauth.oauth!.stripeAccountId!,
    kind: "course",
    kindId: "course_123",
    buyerId: memberId, // number, not String(memberId)
    successUrl: "https://app.example.com/billing/success",
    cancelUrl: "https://app.example.com/billing/cancel",
    customerEmail: "member@example.com",
  },
});

window.location.href = checkout.url!;
```

Check webhook-backed payment state:

```ts
const state = await billingApi.getStripePaymentState({
  path: { orgId },
  body: {
    stripeAccountId: oauth.oauth!.stripeAccountId!,
    mode: "payment",
    kind: "course",
    kindId: "course_123",
    buyerId: memberId, // number, not String(memberId)
  },
});

if (state.active) {
  // unlock entitlement
}
```

## Recommended App Flows

### Stripe Setup Flow

1. Call `getStripeOauth`.
2. If `oauth` is `null`, show Stripe connection UI in your app.
3. If connected, use returned `stripeAccountId` and `liveMode` for display.

### Product And Checkout Flow

1. Call `getStripeOauth`.
2. Call `findStripeProduct`.
3. If missing, call `createStripeProduct`.
4. Call `getStripePaymentLink`.
5. Redirect the user to the Stripe-hosted checkout URL.
6. After return or webhook processing, call `getStripePaymentState`.

### Mode Switch Flow

1. Call `getStripeOauth`.
2. Show current `liveMode`.
3. If user confirms switch, call `updateStripeMode`.
4. Refresh UI from the returned `oauth.liveMode`.
5. Do not assume Gate copied test products to live or live products to test.

## Agent Pattern

If an agent only needs to inspect Stripe state:

- org-scoped token
- `billing.read`

If an agent needs to prepare checkout or manage products:

- org-scoped token
- `billing.write`

If an agent needs both:

- org-scoped token
- `billing.read`
- `billing.write`

Recommended constraints:

- one token per org
- short TTL
- no broader permissions than needed
- do not reuse a human session token if a narrower agent token can be minted

## MCP Tool Names

If the agent uses MCP instead of the SDK, the current Stripe tool ids are:

- `getStripeOauth`
- `updateStripeMode`
- `findStripeProduct`
- `createStripeProduct`
- `updateStripeProduct`
- `deleteStripeProduct`
- `getStripePaymentLink`
- `getStripePaymentState`

## When To Use Gate Vs Stripe Directly

Use Gate when the flow needs:

- org-scoped auth and permissions
- app-owned `kind` and `kindId`
- mode-aware Stripe account handling
- checkout creation
- webhook-backed payment state

Do not bypass Gate for the same commercial object if your app expects Gate billing webhooks and payment-state tracking to stay correct.

## Likely Next Additions

If app teams need more Stripe surface soon, these are the best next Gate additions:

- list Stripe catalog for the connected account
- list customers by org or member mapping
- list subscriptions for a member or customer
- list invoices with Stripe invoice links

Those should still be curated Gate operations rather than a raw Stripe passthrough.
---

## Version

- **Version**: 1.0.0
- **Category**: specialized
- **Last synced**: 2026-04-07
