---
name: dev-debug-logs
description: "Use when debugging a feature through `fusebase dev start`, or when you need to inspect browser logs, proxied API traffic, frontend dev server output, or backend output captured by the local CLI. Explains where logs are written and which file to inspect for each symptom. This is for LOCAL DEVELOPMENT only - for deployed apps, use the remote-logs skill instead."
---

# Dev Debug Logs

> **Important**: This skill is for **local development** only. For logs from deployed feature backends, use the **remote-logs** skill with `fusebase remote-logs` command.

When a feature is run through:

```bash
fusebase dev start FEATURE_PATH
```

the CLI creates a per-session log directory inside the selected feature directory:

```text
<feature-dir>/logs/dev-<timestamp>/
```

with these files:

- `browser-logs.jsonl`
- `access-logs.jsonl`
- `backend-logs.jsonl`
- `frontend-dev-server-logs.jsonl`

Use this skill when debugging the local feature runtime. These logs are local development artifacts only.

## Which Log File To Read

### `browser-logs.jsonl`

Use for:

- `console.log` / `console.error` output from the browser
- uncaught browser errors
- unhandled promise rejections
- navigation/lifecycle events from the feature page

Important:

- It only works when the feature is opened through the CLI proxy started by `fusebase dev start`
- The CLI injects a browser debug script into proxied HTML pages automatically
- Records are JSON Lines; each line is one event

Typical fields:

- `timestamp`
- `type`
- `level`
- `message`
- `args`
- `error`
- `url`
- `pathname`

### `backend-logs.jsonl`

Use for:

- backend stdout/stderr captured during `fusebase dev start`
- runtime errors printed by a feature backend
- startup messages like port binding, env/config issues, and stack traces

Typical fields:

- `timestamp`
- `featureId`
- `line`

Important:

- If the feature defines a dedicated backend dev command, the CLI captures that process directly
- If frontend and backend are started together from one `dev.command` using tools like `concurrently`, the CLI attempts to capture the backend lane into this file as well
- This file is line-based output, not structured request logs

### `access-logs.jsonl`

Use for:

- requests made to `/api` through the local proxy
- request/response headers
- request/response bodies for small JSON/text payloads
- proxy failures between the CLI and the feature/frontend dev server

Typical record types:

- `request`
- `response`
- `proxy-error`

Important:

- Records include `requestId`
- The same request ID is also forwarded as `x-fusebase-dev-request-id`
- Use `requestId` to correlate request and response records for one `/api` call
- Headers and obvious secrets are redacted before writing

### `frontend-dev-server-logs.jsonl`

Use for:

- frontend dev server stdout/stderr captured during `fusebase dev start`
- Vite startup errors, port-binding issues, and plugin/build diagnostics printed by the frontend dev server
- frontend-side dev proxy messages emitted by the feature dev server

Typical fields:

- `timestamp`
- `featureId`
- `line`

Important:

- If the feature uses a dedicated backend via `feature.backend.dev.command`, this file contains the feature dev server output directly
- If frontend and backend are started together from one `dev.command` using tools like `concurrently`, the CLI attempts to exclude the detected backend lane from this file
- This file is line-based output, not structured browser events

## How To Use These Logs Together

For frontend/UI issues:

- Start with `browser-logs.jsonl`
- If the browser error looks related to Vite, module resolution, HMR, or frontend dev proxying, check `frontend-dev-server-logs.jsonl`
- If the browser error came from a failed `/api` call, inspect `access-logs.jsonl` and then check `backend-logs.jsonl` around the same time if a backend exists

For `/api` failures seen in the UI:

- Start with `browser-logs.jsonl` to confirm the browser-visible symptom
- Check `access-logs.jsonl` to correlate the request and response or a proxy error
- Check `frontend-dev-server-logs.jsonl` if the frontend dev server may be failing to proxy or compile
- Then inspect `backend-logs.jsonl` for the corresponding backend-side error or startup issue

For backend startup failures:

- Start with `backend-logs.jsonl`
- Check whether the backend printed startup errors, missing env vars, port conflicts, or stack traces
- If the browser is only showing a generic fetch failure, confirm the browser-visible symptom in `browser-logs.jsonl`

## Rules

- Use `fusebase dev start`; do not bypass the CLI with direct `npm run dev` if you need these logs
- Read the latest session directory under the selected feature directory's `logs/dev-<timestamp>/` for the current run
- **Vite watch**: Add `server.watch.ignored: ['**/logs/**']` to the feature's `vite.config.ts` so log writes don't trigger HMR reloads (see skill **feature-dev-practices**)
- Treat logs as debug artifacts, not as a source of truth for business data
- Do not assume secrets are fully removed; redaction is best-effort
