---
version: "1.14.0"
mcp_prompt: files
last_synced: "2026-09-17"
title: "Fusebase Gate Files Flows"
category: specialized
---
# Fusebase Gate Files Flows

> **MARKER**: `mcp-files-loaded` — When this marker is present in context, MCP prompts for this topic may skip conceptual sections and use API reference only.

> **VERSION CHECK**: If operations fail unexpectedly, load MCP prompt `files` for latest content.

---
## Fusebase Gate Files Flows

This reference covers only Gate file operations and their auth/scope behavior. For the canonical low-level upload lifecycle, shared terminology, relative display URL normalization, and file descriptor construction, use `file-upload/references/upload-lifecycle.md`.

## Relevant Operations

- createTempStoredFileUpload: presign one PUT that uploads a whole file. Use it for anything small enough to send in a single request; use the multipart pair only when the file needs parts.
- startMultipartFileUpload: start a public file-service multipart upload and return direct PUT metadata.
- completeMultipartFileUpload: finish the file-service multipart upload from ETags and create the stored-file record. Gate maps file-service `storedFile.uuid` to response `storedFileUUID`; `fileId` is the same stored-file id alias. Use `storedFileUUID` for notes attachments. The returned `readUrl` is the public file URL.
- deleteFile: delete a file-service stored file by `storedFileUUID`.
- createBucketAttachment: turn an uploaded temp stored file into a bucket-service attachment in the organization's `app` bucket, so the file shows up in the organization file listing next to note and portal files. Needs a token issued for an app.
- updateBucketAttachment: rename a bucket attachment or replace its `attributes` and `accessPrincipals`.
- listBucketAttachments: list the organization's files from every source in one list — app uploads, note attachments and portal files — with their source, uploader, size, attributes and access.

## Working Rules

- `createTempStoredFileUpload` requires only `name`. Send the bytes with one PUT to `uploadUrl`, using exactly the headers it returns in `headers` (`content-type` alone) and nothing else. The returned `tempStoredFileName` is then the input for whatever creates the record, for example `createBucketAttachment`.
- Upload a file into the app's own storage in two steps: `createTempStoredFileUpload` (or the multipart pair with `saveStoredFile: false`), then `createBucketAttachment` with the returned `tempStoredFileName`. Gate creates the attachment id, reads the app from the token, and puts the file in the organization `app` bucket.
- `attributes` is free key/value metadata on the file (max 50 keys, 255 chars per key and value), for example the uploader email or a category. `accessPrincipals` is who may see the file: `{roles, userIds, groupIds}`, where `groupIds` are organization group global ids (`listOrgGroups`). Leave `accessPrincipals` out to show the file to everyone who can see the organization bucket.
- `updateBucketAttachment` replaces the whole `attributes` object when it is present, and `accessPrincipals: null` clears every restriction. Fields you do not send stay as they are.
- `listBucketAttachments` returns `{items, total}`. Each item carries `target` (the source bucket), `userId` (the uploader — resolve the email and role with the org-users operations), `size` in bytes, `attributes`, `accessPrincipals` and, for organization members, the bucket `permissions`. Narrow it with `targets` (for example `app` or `note`), `sizeFrom` and `attributes`, page it with `limit` (max 100) and `offset`. `attributes` is a JSON object of strings sent as a string, for example `attributes: '{"source": "file-manager"}'`; every pair must match the file exactly, and `total` follows the same filter. A malformed one is a 400. Gate resolves the caller's organization role and groups itself, so an app token and a user session for the same person see the same files, and a client only sees what its access principals allow.
- `completeMultipartFileUpload` accepts `saveStoredFile: false` to finish the upload without creating the stored-file record. The response then has `storedFileCreated: false`, null `fileId`/`storedFileUUID`, and `tempStoredFileName` to hand on.
- `startMultipartFileUpload` requires `filename` and byte `size`; `contentType` defaults to `application/octet-stream`, and `folder` defaults to `apps`.
- Gate never handles upload bytes. PUT the file bytes directly to the returned `uploadUrl` using the returned `method`.
- **Presigned URL headers rule**: the `headers` the upload operation returns are authoritative — send exactly those and nothing else. `createTempStoredFileUpload` returns `content-type`: the URL signs `host` alone, so that header is unsigned but still required, and it is what the stored object ends up with. When an operation returns no headers (multipart `uploadUrl` / `partsUrls` signed as `X-Amz-SignedHeaders=host`), send a bare PUT and add nothing that is not listed in `X-Amz-SignedHeaders`.
- In browser code, do not let the browser add `Content-Type` on its own: send an `ArrayBuffer`/raw bytes body rather than a typed `Blob`, and set the header only when the operation returned it. The bucket CORS policy allows `content-type` in the preflight; any other header fails the PUT as an opaque network error.
- A cross-origin browser `PUT` can still preflight because `PUT` is not a CORS simple method. Keep requested headers aligned with the presigned URL and bucket CORS policy.
- Capture the direct PUT response ETag, strip wrapping quotes if present, and send it to `completeMultipartFileUpload` as `parts: [{ etag, partNumber: 1 }]` for one-part uploads.
- Treat the temp upload name as `tempStoredFileName` in guidance and handoffs. Follow `tools_describe`/SDK schema for the exact request field name required by the current Gate contract.
- `completeMultipartFileUpload` creates the stored-file record after file-service finish succeeds unless `saveStoredFile` is false. Persist `storedFileUUID` as the canonical stored-file id, plus `publicFileName` and `readUrl`.
- Use the returned Gate `readUrl` for reads or image `src`. If another upload flow returns a relative `file.url` such as `/uuid/name.ext`, do not render or persist it as a browser href directly; normalize it through the file-upload display URL rule before saving descriptors or rendering existing descriptors.
- Use the returned `storedFileUUID` with notes `addWorkspaceNoteAttachment` to attach the file to a note.
- `deleteFile` calls file-service as `DELETE /storedfiles/{uuid}`. Use the `storedFileUUID` returned by completion, not `tempStoredFileName`.
- Do not send block ids, storage-provider-specific headers, a `Content-Type` the upload operation did not return, visibility, public URL, or read access mode fields.
- Do not describe dashboard `files` column payloads here; after Gate completion, hand off the file descriptor or `readUrl` to the owning skill.

## Access Model

- Upload, multipart, and delete flows require `files.write` and org access.
- Gate delegates upload URLs to file-service and returns `readUrl` from the completion flow; actual bytes never flow through Gate.

## Hard rules (attachments / app storage)

- **Never** store file bytes in isolated SQL (base64/`bytea`/data URL) as an alternative to this flow. SQL holds only `storedFileUUID` + `readUrl` (+ small metadata). No MVP exception — see MCP prompt **`isolatedSql`**.
- Needing **`files.write`** is **not** a reason to put attachments in the database. Sync permissions (`fusebase app update <appId> --sync-gate-permissions`) instead of changing storage architecture.
- **Visitor / anonymous / public-link apps:** browser visitor tokens usually **cannot** call `files.write` (org access). Broker the upload on the **app feature backend** with `process.env.FBS_FEATURE_TOKEN` (service token that already has `files.write`), then return `storedFileUUID` / `readUrl` to the client. Do not invent SQL blob storage because the skill looked browser-only.
---

## Version

- **Version**: 1.14.0
- **Category**: specialized
- **Last synced**: 2026-09-17
- **Priority rule**: If the MCP prompt has a higher version, follow the prompt's API Reference as source of truth.
