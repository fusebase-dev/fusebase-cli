---
version: "1.0.0"
mcp_prompt: apps
last_synced: "2026-08-28"
title: "FuseBase Apps And Work Agents"
category: specialized
---
# FuseBase Apps And Work Agents

> **MARKER**: `mcp-apps-loaded` — When this marker is present in context, MCP prompts for this topic may skip conceptual sections and use API reference only.

> **VERSION CHECK**: If operations fail unexpectedly, load MCP prompt `apps` for latest content.

---
## FuseBase Apps And Work Agents

Use these operations for organization-scoped integration between published FuseBase App APIs and FuseBase Work agents. The two directions use different Gate operation families; do not confuse them.

## Work Agent Calling A FuseBase App

- Use `findPublishedApps` to resolve an App by name when its id is not already known.
- Use `listAppApiOperations` or `getPublishedAppApiManifest` to inspect the App's published API contract before choosing an operation. Never invent an endpoint or request shape.
- Use `invokePublishedAppApiOperation` to call the selected operation through Gate. Gate preserves the caller's organization and owner-delegated App access; the App API does not need to be public.
- Treat `productId`, `appId`, and operation ids as opaque values returned by Gate. If several Apps match a name, ask for disambiguation instead of guessing.

## FuseBase App Calling A Work Agent

- This is an asynchronous backend workflow. An App backend lists agents, creates a task, and polls for completion; browser code must not receive the invocation credential.
- Call `listPaperclipCallableAgents` first and select an agent from the response. Do not guess an agent id from its display name.
- Call `createPaperclipAgentTask` with the selected `agentId`, a concise `title`, and the full task in `description`.
- Always supply a stable `externalRef` derived from the App's own job or request id. Retrying the same logical job with the same value is idempotent and returns `reused: true` instead of creating a duplicate task.
- Poll `getPaperclipAgentTask` with the returned task id until the task reaches a terminal status. Read human-readable output from `comments` and structured or file output from `workProducts`; `latestRun` can be null even when the task is complete.
- Use bounded polling with backoff. Persist the task id in the App so a page reload or worker restart resumes the existing task instead of creating another one.

## Authentication And Organization Boundary

- App-to-agent calls require a user-bound, organization-scoped Gate token for the same organization as the Work company.
- Listing agents and reading task results require `paperclip_agents.read`. Creating a task requires `paperclip_agents.execute`.
- Keep tokens carrying `paperclip_agents.execute` in the App backend or secret store. Never embed them in frontend bundles, return them from an App endpoint, or print them in logs.
- Gate and Paperclip both enforce the organization boundary. A caller cannot select an agent or retrieve a task from another organization.
- The reverse bridge is feature-flagged. A `404` while `app_agent_invocation` is disabled means the integration is unavailable in that environment, not that the agent id should be retried.

## Failure Handling

- `401` means the credential is absent or invalid. `403` means its permission or organization scope is insufficient. `404` can mean the feature is disabled or the organization-scoped agent/task does not exist.
- Surface a failed task's status and run error to the App. Do not report success merely because task creation returned `200`.
- Before implementing either direction, inspect the exact operation contract with `tools_describe` or `sdk_describe`; request and response schemas are the source of truth.
---

## Version

- **Version**: 1.0.0
- **Category**: specialized
- **Last synced**: 2026-08-28
- **Priority rule**: If the MCP prompt has a higher version, follow the prompt's API Reference as source of truth.
