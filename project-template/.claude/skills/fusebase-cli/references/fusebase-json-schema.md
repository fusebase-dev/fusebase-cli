# fusebase.json Schema

```json
{
  "orgId": "organization-id",
  "appId": "app-id",
  "features": [
    {
      "id": "feature-id",
      "path": "features/my-feature",
      "dev": {
        "command": "npm run dev"
      },
      "build": {
        "command": "npm run build",
        "outputDir": "dist"
      },
      "devUrl": "http://localhost:5173"
    }
  ]
}
```

## Field Descriptions

| Field | Required | Description |
|-------|----------|-------------|
| `orgId` | Yes | Your Fusebase organization ID |
| `appId` | Yes | The Fusebase App ID (create the app in Fusebase UI first) |
| `features` | Yes | Array of feature configurations |
| `features[].id` | Yes | The feature ID (must match ID in Fusebase) |
| `features[].path` | Yes | Relative path to the feature's source directory |
| `features[].dev.command` | No | Command to start the dev server (e.g., `npm run dev`) |
| `features[].build.command` | Yes | Command to build the feature for production |
| `features[].build.outputDir` | Yes | Directory containing build output (relative to feature path) |
<% if (it.server) { %>
| `features[].backend` | No | Backend config (only if the feature has a `backend/` folder). See skill **feature-backend**. |
| `features[].backend.dev.command` | No | Command to start the backend dev mode (e.g., `npm run dev`) |
| `features[].backend.build.command` | Yes (if backend) | Command to build the backend |
| `features[].backend.start.command` | Yes (if backend) | Command to start the built backend in production (e.g., `npm run start`) |
<% } %>

## Example fusebase.json

```json
{
  "orgId": "org_abc123",
  "appId": "app_xyz789",
  "features": [
    {
      "id": "feat_dashboard",
      "path": "features/dashboard",
      "dev": {
        "command": "npm run dev"
      },
      "build": {
        "command": "npm run build",
        "outputDir": "dist"
      }
    },
    {
      "id": "feat_settings",
      "path": "features/settings",
      "dev": {
        "command": "npm run dev -- --port 5174"
      },
      "build": {
        "command": "npm run build",
        "outputDir": "dist"
      }<% if (it.server) { %>,
      "backend": {
        "dev": { "command": "npm run dev" },
        "build": { "command": "npm run build" },
        "start": { "command": "npm run start" }
      }<% } %>
    }
  ]
}
```