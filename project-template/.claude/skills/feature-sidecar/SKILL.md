---
name: feature-sidecar
description: "Guide for managing sidecar containers alongside feature backends. Use when: (1) A feature backend needs auxiliary services like headless browsers, caches, or other tools, (2) Adding/removing/listing sidecar containers, (3) Configuring sidecar networking, env vars, or resource tiers."
---

# Feature Sidecar Containers

Sidecars are pre-built Docker images deployed alongside a feature backend in the same network namespace (sharing localhost). They enable auxiliary services that the backend communicates with over HTTP or other protocols on localhost.

## Prerequisites

1. Feature must have a `backend/` folder configured in `fusebase.json`

## Use Cases

| Sidecar | Image Example | Port | Purpose |
|---------|---------------|------|---------|
| Headless browser | `browserless/chrome:latest` | 9222 | Web scraping, PDF generation, screenshots |
| Lightweight browser | `nicholasgriffintn/lightpanda:latest` | 9222 | Fast page parsing |
| Redis cache | `redis:7-alpine` | 6379 | Caching, queues, pub/sub |
| Image processor | `dpokidov/imageproxy:latest` | 8080 | Image resizing/optimization |

## CLI Commands

### Add a Sidecar

```bash
fusebase sidecar add \
  --feature <featureId> \
  --name <name> \
  --image <dockerImage> \
  [--port <port>] \
  [--tier small|medium|large] \
  [--env KEY=VALUE ...]
```

Example:

```bash
fusebase sidecar add \
  --feature my-scraper \
  --name chromium \
  --image browserless/chrome:latest \
  --port 9222 \
  --tier medium \
  --env MAX_CONCURRENT_SESSIONS=5 \
  --env CONNECTION_TIMEOUT=30000
```

### Remove a Sidecar

```bash
fusebase sidecar remove --feature <featureId> --name <name>
```

### List Sidecars

```bash
fusebase sidecar list --feature <featureId>
```

## Configuration Format

Sidecars are stored in `fusebase.json` under each feature's `backend.sidecars` array:

```json
{
  "features": [
    {
      "id": "my-scraper",
      "path": "features/my-scraper",
      "backend": {
        "dev": { "command": "npm run dev" },
        "build": { "command": "npm run build" },
        "start": { "command": "npm run start" },
        "sidecars": [
          {
            "name": "chromium",
            "image": "browserless/chrome:latest",
            "port": 9222,
            "tier": "medium",
            "env": {
              "MAX_CONCURRENT_SESSIONS": "5"
            }
          }
        ]
      }
    }
  ]
}
```

## Networking

Sidecars share the backend's network namespace — all containers communicate via `localhost`:

```typescript
// Backend code calling a sidecar
const browser = await fetch("http://localhost:9222/json/version");
const redis = await fetch("http://localhost:6379");
```

Each sidecar should expose a different port. The `port` field is informational for documentation; the actual port is determined by the sidecar image configuration.

**Port 3000 is reserved for the backend app** — do not configure sidecars to listen on port 3000. If a sidecar image defaults to port 3000 (e.g. `browserless/chrome`), override it via environment variables. For example, browserless uses `PORT` env var:

```bash
fusebase sidecar add --feature my-scraper --name chromium \
  --image browserless/chrome:latest --port 9222 \
  --env PORT=9222
```

## Resource Tiers

Each sidecar can have its own resource tier:

| Tier | CPU | Memory |
|------|-----|--------|
| small | 0.5 | 1Gi |
| medium | 1 | 2Gi |
| large | 2 | 4Gi |

Default tier is `small` if not specified. Choose based on the sidecar's workload — headless browsers typically need `medium` or `large`.

## Environment Variables

Sidecar env vars are isolated — they are NOT shared with the backend or other sidecars. Use them for sidecar-specific configuration:

```bash
fusebase sidecar add --feature my-feature --name redis --image redis:7 \
  --env REDIS_MAXMEMORY=256mb --env REDIS_MAXMEMORY_POLICY=allkeys-lru
```

Backend secrets (created via `fusebase secret create`) are NOT injected into sidecars.

## Limitations

- **Max 3 sidecars per feature** — enforced by the CLI and API
- **Pre-built images only** — sidecars use existing Docker images, no custom builds from source
- **Sidecar names must be unique** within a feature
- **Sidecars do not run locally** — `fusebase dev start` does not start sidecar containers. For local development, run the sidecar image manually with Docker
- **Port 3000 is reserved** — the backend app listens on port 3000; sidecars must not bind to it or they will crash with `EADDRINUSE`
- **No shared volumes** — sidecars and backend communicate only via network

## Debugging

### View All Container Logs

```bash
fusebase remote-logs runtime <featureId>
```

Output includes logs from all containers, prefixed by name:

```
[api]: Server started on port 3001
[chromium]: Browser ready on port 9222
```

### Filter to a Specific Container

```bash
# Backend logs only
fusebase remote-logs runtime <featureId> --container api

# Specific sidecar
fusebase remote-logs runtime <featureId> --container chromium
```

### Sidecar Not Available

If a sidecar fails to start, logs will show:

```
[chromium]: (sidecar not available)
```

Check the system logs for container startup issues:

```bash
fusebase remote-logs runtime <featureId> --type system
```

## Deployment

Sidecars are deployed automatically with `fusebase deploy`. The CLI reads the sidecar config from `fusebase.json` and passes it to the deploy API. No additional steps are needed.

```bash
fusebase deploy
# Output includes:
# Deploying feature "my-scraper" with sidecars: chromium
```

## Checklist

- [ ] Feature has a `backend/` folder and `backend` block in `fusebase.json`
- [ ] Added sidecar(s) via `fusebase sidecar add`
- [ ] Verified sidecar count is at most 3
- [ ] Backend code uses `localhost:<port>` to communicate with sidecars
- [ ] Tested sidecar locally with Docker (optional but recommended)
- [ ] Deployed and verified with `fusebase remote-logs runtime`
