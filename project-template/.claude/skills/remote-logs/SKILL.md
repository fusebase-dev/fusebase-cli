---
name: remote-logs
description: "Use when debugging a deployed feature backend. Explains how to fetch build logs and runtime logs using the `fusebase remote-logs` command. Only applicable to features with a backend/ folder. For local development, use dev-debug-logs skill instead."
---

# Remote Logs

**This skill applies only to features with a `backend/` folder.** Frontend-only features do not produce remote logs.

When a feature backend has been deployed using `fusebase deploy`, you can fetch logs from the cloud:

1. **Build logs** - Output from the container image build process
2. **Runtime logs** - Live stdout/stderr and system logs from the running backend

## Important Distinction

| Context | Command | What It Reads |
|---------|---------|---------------|
| **Local development** | `fusebase dev start` | Log files in `<feature>/logs/dev-*/` |
| **Deployed backend** | `fusebase remote-logs` | Cloud build and runtime logs |

If the feature is running locally via `fusebase dev start`, use the **dev-debug-logs** skill instead.

## Commands

### Build Logs

Fetch build/deployment logs from the most recent deploy:

```bash
fusebase remote-logs build <featureId>
```

Output includes:
- Build status (`in_progress`, `failed`, `finished`)
- Full build log (Dockerfile execution, npm install, etc.)
- Deploy job ID for reference

### Runtime Logs

Fetch live logs from the running backend:

```bash
# Default: last 100 console (stdout/stderr) entries
fusebase remote-logs runtime <featureId>

# Specify tail count (0-300)
fusebase remote-logs runtime <featureId> --tail 200

# Get system logs instead of console logs
fusebase remote-logs runtime <featureId> --type system
```

Options:
- `--tail <n>` - Number of log entries (0-300, default: 100)
- `--type <type>` - Log type: `console` (stdout/stderr) or `system` (service/infrastructure logs)

## When to Use Each Log Type

### Build Logs

Use for:
- Failed deployments (`status: failed`)
- Dockerfile issues
- npm install failures
- Build-time errors and warnings
- Deployment timing issues

### Runtime Logs (console)

Use for:
- Application startup errors
- HTTP request handling issues
- Unhandled exceptions/rejections
- `console.log` debug output from the backend
- Server crash diagnostics

### Runtime Logs (system)

Use for:
- Container health check failures
- Container restart events
- Resource limits (CPU/memory) issues
- Infrastructure events
- Networking/ingress problems

## Prerequisites

1. Feature **must have a `backend/` folder** — frontend-only features do not produce remote logs
2. Feature must be deployed via `fusebase deploy`
3. Deployment must have completed successfully (for runtime logs)
4. API key configured via `fusebase auth`

## Error Messages

| Error | Meaning | Fix |
|-------|---------|-----|
| "No deploy found for AppFeature" | Feature has never been deployed | Run `fusebase deploy` first |
| "No successful deploy found" | Latest deploy failed | Check build logs, fix, redeploy |
| "Missing resource information" | Deploy metadata incomplete | Redeploy the feature |

## Example Debug Flow

1. Deploy fails → Check build logs:
   ```bash
   fusebase remote-logs build
   ```

2. App crashes on startup → Check runtime console logs:
   ```bash
   fusebase remote-logs runtime --tail 50
   ```

3. Container keeps restarting → Check system logs:
   ```bash
   fusebase remote-logs runtime --type system
   ```

4. No obvious errors → Check more log entries:
   ```bash
   fusebase remote-logs runtime --tail 300
   ```
