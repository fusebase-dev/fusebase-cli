---
version: "1.2.0"
mcp_prompt: billing
last_synced: "2026-04-07"
title: "Fusebase Gate Billing And Stripe Flows"
category: specialized
---
# Fusebase Gate Billing And Stripe Flows

> **MARKER**: `mcp-billing-loaded` — When this marker is present in context, MCP prompts for this topic may skip conceptual sections and use API reference only.

> **VERSION CHECK**: If operations fail unexpectedly, load MCP prompt `billing` for latest content.

---
## Fusebase Gate Billing And Stripe Flows

These operations manage organization-scoped Stripe setup, Stripe-backed products, checkout links, and webhook-backed payment state through Gate.

## Relevant Operations

- getStripeOauth: verify whether the organization has a connected Stripe OAuth account.
- updateStripeMode: switch the connected Stripe account between test and live API modes without copying Stripe products or prices.
- findStripeProduct: look up the current Stripe product/link by Stripe account, mode, or kind identity.
- createStripeProduct: create a one-time payment or subscription product.
- updateStripeProduct: replace a product by deleting the old record and creating a new one.
- deleteStripeProduct: mark an existing product as deleted.
- getStripePaymentLink: create or retrieve a checkout URL for a buyer.
- getStripePaymentState: read the latest active state stored from Stripe webhook processing.

## Working Rules

- Always use `getStripeOauth` before product or checkout flows when the org may not be connected to Stripe yet.
- Use `updateStripeMode` when you need a fast live/test API key switch for an existing Stripe connection. Do not assume products or prices are copied across modes.
- Treat `stripeAccountId` as the source-of-truth Stripe connection identifier for product and checkout calls.
- Use stable `kind` and `kindId` values from your own system so webhook-backed payment state can be mapped back to your product or entitlement.
- `buyerId` for `getStripePaymentLink` and `getStripePaymentState` must be a numeric buyer identifier. Pass `buyerId: user.id`, not `buyerId: String(user.id)`.
- For `mode: "subscription"`, send both `interval` and `intervalCount`.
- For `mode: "payment"`, omit `interval` and `intervalCount`.
- `updateStripeProduct` is implemented as delete plus create. Do not assume Stripe products are edited in place.
- Use `getStripePaymentLink` to obtain the redirect URL. The user still pays on Stripe-hosted checkout.
- Use `getStripePaymentState` after checkout or webhook processing to confirm whether the buyer is currently active.

## Access Model

- Read flows require `billing.read` and org access.
- Stripe mode switching, product creation, replacement, deletion, and checkout-link generation require `billing.write` and org access.
- If billing-service rejects a call, investigate org access, token permissions, and Stripe connection state before changing payload shape.
---

## Version

- **Version**: 1.2.0
- **Category**: specialized
- **Last synced**: 2026-04-07
- **Priority rule**: If the MCP prompt has a higher version, follow the prompt's API Reference as source of truth.
