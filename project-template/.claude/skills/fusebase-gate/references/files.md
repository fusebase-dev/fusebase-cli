---
version: "1.7.0"
mcp_prompt: files
last_synced: "2026-04-21"
title: "Fusebase Gate Files Flows"
category: specialized
---
# Fusebase Gate Files Flows

> **MARKER**: `mcp-files-loaded` — When this marker is present in context, MCP prompts for this topic may skip conceptual sections and use API reference only.

> **VERSION CHECK**: If operations fail unexpectedly, load MCP prompt `files` for latest content.

---
## Fusebase Gate Files Flows

These operations prepare short-lived Azure Blob upload URLs, create short-lived read-only Azure Blob download URLs, support explicit multipart completion for Azure block blobs, and delete previously prepared org-scoped files.

## Relevant Operations

- prepareFileUpload: create a short-lived direct-upload URL plus required request headers.
- getFileDownloadUrl: create a short-lived read-only download URL for a previously uploaded org-scoped blob.
- startMultipartFileUpload: create a short-lived block-blob upload URL plus a short-lived signed `uploadId` for multipart completion.
- completeMultipartFileUpload: commit the block ids staged for a previously started multipart upload.
- deleteFile: delete a previously uploaded org-scoped blob by `fileId`.

## Working Rules

- `prepareFileUpload` does not upload bytes. It only returns a short-lived SAS URL for the client to upload directly to Azure Blob Storage.
- `getFileDownloadUrl` does not stream file bytes through Gate. It returns a short-lived read-only SAS URL so the client can download directly from Azure Blob Storage.
- `startMultipartFileUpload` returns the same kind of short-lived SAS blob URL, but the client should use it with Azure block staging (`BlockBlobClient.stageBlock` or equivalent) instead of a one-shot upload.
- For multipart uploads, stage every part against the returned `uploadUrl`, keep the exact base64 block ids you used, then send those ids in order to `completeMultipartFileUpload`.
- Treat `uploadId` as an opaque server-signed token. Do not decode, modify, or rebuild it on the client.
- `completeMultipartFileUpload` does not upload bytes; it only commits the already staged block ids.
- The returned `fileId` is the Azure blob path. Persist it exactly as returned if you want to delete the file later.
- `getFileDownloadUrl` and `deleteFile` both take `fileId` in the request body so blob paths with `/` are preserved correctly.
- Use the returned `method`, `headers`, and `uploadUrl` exactly for one-shot direct uploads. Multipart staging uses the same `uploadUrl`, but the Azure Blob client handles the block-specific requests.
- Download URLs, upload URLs, and multipart `uploadId` values are intentionally short-lived; request a fresh response instead of retrying with an expired token.
- `deleteFile` only works for files inside the requested org scope. Do not reuse a `fileId` from another org.

## Access Model

- Download flows require `files.read` and org access.
- Upload, multipart, and delete flows require `files.write` and org access.
- Gate generates the delegated upload URL, but the actual file bytes go straight from the client to Azure Blob Storage.
- Gate generates the delegated download URL, but the actual file bytes come straight from Azure Blob Storage to the client.
---

## Version

- **Version**: 1.7.0
- **Category**: specialized
- **Last synced**: 2026-04-21
- **Priority rule**: If the MCP prompt has a higher version, follow the prompt's API Reference as source of truth.
