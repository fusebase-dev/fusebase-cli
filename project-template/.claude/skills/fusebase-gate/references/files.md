---
version: "1.9.0"
mcp_prompt: files
last_synced: "2026-04-22"
title: "Fusebase Gate Files Flows"
category: specialized
---
# Fusebase Gate Files Flows

> **MARKER**: `mcp-files-loaded` — When this marker is present in context, MCP prompts for this topic may skip conceptual sections and use API reference only.

> **VERSION CHECK**: If operations fail unexpectedly, load MCP prompt `files` for latest content.

---
## Fusebase Gate Files Flows

These operations prepare short-lived Azure Blob upload URLs, create either short-lived or stable public read URLs, support explicit multipart completion for Azure block blobs, and delete previously prepared org-scoped files.

## Relevant Operations

- prepareFileUpload: create a short-lived direct-upload URL plus required request headers, visibility metadata, and an optional stable public URL.
- getFileDownloadUrl: create either a short-lived read URL or a stable public URL for a previously uploaded org-scoped blob.
- startMultipartFileUpload: create a short-lived block-blob upload URL plus a short-lived signed `uploadId` for multipart completion, visibility metadata, and an optional stable public URL.
- completeMultipartFileUpload: commit the block ids staged for a previously started multipart upload.
- deleteFile: delete a previously uploaded org-scoped blob by `fileId`.

## Working Rules

- `prepareFileUpload` and `startMultipartFileUpload` accept optional `visibility: "private" | "public"`. Omit it for private files. Use `public` only when the service is configured with a public Azure Blob container or CDN-backed base URL.
- `prepareFileUpload` does not upload bytes. It only returns a short-lived SAS URL for the client to upload directly to Azure Blob Storage.
- `getFileDownloadUrl` does not stream file bytes through Gate. It returns either a short-lived read-only SAS URL (`access: "temporary"`, the default) or a stable public URL (`access: "public"`) so the client can read directly from Azure Blob Storage or a configured public base URL.
- `startMultipartFileUpload` returns the same kind of short-lived SAS blob URL, but the client should use it with Azure block staging (`BlockBlobClient.stageBlock` or equivalent) instead of a one-shot upload.
- For multipart uploads, stage every part against the returned `uploadUrl`, keep the exact base64 block ids you used, then send those ids in order to `completeMultipartFileUpload`.
- Treat `uploadId` as an opaque server-signed token. Do not decode, modify, or rebuild it on the client.
- `completeMultipartFileUpload` does not upload bytes; it only commits the already staged block ids.
- Persist the returned `fileId` exactly as returned. Public and private reads/deletes also rely on the returned `visibility` value because Gate is not storing a separate file record yet.
- `getFileDownloadUrl` and `deleteFile` both take `fileId` in the request body so blob-like identifiers with `/` are preserved correctly.
- `getFileDownloadUrl` accepts optional `disposition: "inline" | "attachment"` for temporary reads. Use `attachment` when you want the browser to download the file instead of rendering it inline. Stable public URLs do not support forced `attachment` behavior.
- Stable `publicUrl` values are appropriate for blog posts, `<img src>`, and other long-lived embeds. Temporary read URLs are appropriate for protected or expiring access.
- Use the returned `method`, `headers`, and `uploadUrl` exactly for one-shot direct uploads. Multipart staging uses the same `uploadUrl`, but the Azure Blob client handles the block-specific requests.
- Gate enforces practical size limits before talking to Azure: `filename` max 255 characters, `folder` max 512 characters, `contentType` max 255 characters, and `fileId` max 1,024 characters.
- Gate also rejects composed blob paths that exceed Azure naming limits or have too many path segments for safe Azure Blob usage.
- Upload URLs, temporary read URLs, and multipart `uploadId` values are intentionally short-lived; request a fresh response instead of retrying with an expired token.
- Stable public URLs only work when the configured public container or CDN origin is actually publicly reachable. Gate does not probe public reachability on every request.
- `deleteFile` only works for files inside the requested org scope. Do not reuse a `fileId` from another org.

## Access Model

- Download flows require `files.read` and org access.
- Upload, multipart, and delete flows require `files.write` and org access.
- Gate generates the delegated upload URL, but the actual file bytes go straight from the client to Azure Blob Storage.
- Gate generates the delegated download URL, but the actual file bytes come straight from Azure Blob Storage to the client.
---

## Version

- **Version**: 1.9.0
- **Category**: specialized
- **Last synced**: 2026-04-22
- **Priority rule**: If the MCP prompt has a higher version, follow the prompt's API Reference as source of truth.
