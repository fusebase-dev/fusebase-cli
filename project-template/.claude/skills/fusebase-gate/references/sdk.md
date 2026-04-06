---
version: "1.4.0"
mcp_prompt: sdk
last_synced: "2026-04-06"
title: "Fusebase Gate SDK"
category: meta
---
# Fusebase Gate SDK

> **MARKER**: `mcp-sdk-loaded` — When this marker is present in context, MCP prompts for this topic may skip conceptual sections and use API reference only.

> **VERSION CHECK**: If operations fail unexpectedly, load MCP prompt `sdk` for latest content.

---
## Fusebase Gate SDK

Use the Gate SDK for runtime integration code. Use MCP tools for discovery, explanations, and one off execution during the conversation.

## Package

npm: `@fusebase/fusebase-gate-sdk`. For development, install from public npm:
`npm install @fusebase/fusebase-gate-sdk` (or the equivalent in your package manager).

## Discovery Workflow

1. Use sdk_search to find relevant methods by intent or keywords.
2. Use sdk_describe to inspect the exact client, method, and input or output schemas.
3. Use the generated SDK client for application code.

## Main SDK Clients

- HealthApi
- AccessApi
- BillingApi
- OrgUsersApi
- PortalsApi
- SystemApi
- TokensApi
- WorkspacesApi

## Current Service Focus

For organization membership flows, prefer OrgUsersApi methods such as listOrgUsers and addOrgUser.
For session-backed org access checks, use AccessApi.getMyOrgAccess instead of inferring access from listOrgUsers timing.
After sign-up, sign-in, or provisioning writes, re-check AccessApi.getMyOrgAccess before unlocking org content.
Treat `result: "invite"` from addOrgUser as pending membership rather than granted access.
Do not treat a custom /me or account endpoint as the source of truth unless it delegates to getMyOrgAccess.
For Stripe onboarding and product flows, start with BillingApi methods such as getStripeOauth, updateStripeMode, createStripeProduct, updateStripeProduct, deleteStripeProduct, getStripePaymentLink, and getStripePaymentState.
Use stable app-owned `kind` and `kindId` values in BillingApi so webhook-backed payment state can be checked later for the same entitlement.
For workspace discovery, use WorkspacesApi.listWorkspaces.
For portal discovery, use PortalsApi.listPortals.
For portal invite flows, inspect addOrgUser because portal magic links are returned there rather than through a separate Portal invite API.

## Usage Rules

- Do not guess client names or method names. Discover them through sdk_search or sdk_describe.
- Treat sdk_describe as the source of truth for params shape and response shape.
- Keep MCP and SDK roles separate: MCP is for discovery and execution in chat, SDK is for product code.
---

## Version

- **Version**: 1.4.0
- **Category**: meta
- **Last synced**: 2026-04-06
- **Priority rule**: If the MCP prompt has a higher version, follow the prompt's API Reference as source of truth.
