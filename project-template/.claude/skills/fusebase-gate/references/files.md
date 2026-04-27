---
version: "1.9.0"
mcp_prompt: files
last_synced: "2026-04-27"
title: "Fusebase Gate Files Flows"
category: specialized
---
# Fusebase Gate Files Flows

> **MARKER**: `mcp-files-loaded` — When this marker is present in context, MCP prompts for this topic may skip conceptual sections and use API reference only.

> **VERSION CHECK**: If operations fail unexpectedly, load MCP prompt `files` for latest content.

---
## Fusebase Gate Files Flows

These operations use the internal file-service upload lifecycle. Gate starts a public file-service multipart upload, clients PUT bytes directly to returned part URLs, and Gate completes the upload by creating a stored-file record plus public read URL.

## Relevant Operations

- prepareFileUpload: start a file-service upload and return the first direct PUT URL, required headers, `uploadId`, and `tempStoredfileName` for a one-part upload.
- startMultipartFileUpload: start the same file-service multipart upload flow and return direct PUT metadata.
- completeMultipartFileUpload: finish the file-service multipart upload from ETags and create the stored-file record. The returned `fileId`/`storedFileUUID` is what notes attachments use; the returned `downloadUrl` is the public file URL.
- getFileDownloadUrl: build a public read URL from the `publicFileName` returned by upload completion.
- deleteFile: delete a file-service stored file by stored-file UUID.

## Working Rules

- `prepareFileUpload` and `startMultipartFileUpload` require `filename` and byte `size`; `contentType` defaults to `application/octet-stream`, and `folder` defaults to `apps`.
- Gate never handles upload bytes. PUT the file bytes directly to the returned `uploadUrl` using the returned `method` and `headers`.
- Capture the direct PUT response ETag, strip wrapping quotes if present, and send it to `completeMultipartFileUpload` as `parts: [{ etag, partNumber: 1 }]` for one-part uploads.
- Send `uploadId` as the path parameter and `tempStoredfileName` in the completion body exactly as returned by start/prepare.
- `completeMultipartFileUpload` always creates the stored-file record after file-service finish succeeds. Persist the returned `storedFileUUID`/`fileId`, `publicFileName`, and `downloadUrl`.
- Use the returned `downloadUrl` for reads. Use the returned stored-file UUID with notes `addWorkspaceNoteAttachment` to attach the file to a note.
- `getFileDownloadUrl` does not call file-service presigned URL APIs. It builds the public URL from `fileName`, which should be the completion response `publicFileName`.
- `deleteFile` calls file-service as `DELETE /storedfiles/{uuid}`. Use the stored-file UUID returned by completion, not a temp stored-file name.
- Do not send block ids, storage-provider-specific headers, visibility, public URL, or read access mode fields.

## Access Model

- Public URL builder flows require `files.read` and org access.
- Upload, multipart, and delete flows require `files.write` and org access.
- Gate delegates upload URLs to file-service and builds read URLs from public file-service object names; actual bytes never flow through Gate.
---

## Version

- **Version**: 1.9.0
- **Category**: specialized
- **Last synced**: 2026-04-27
- **Priority rule**: If the MCP prompt has a higher version, follow the prompt's API Reference as source of truth.
