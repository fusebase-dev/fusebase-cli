---
name: file-upload
description: "Guide for uploading files to Fusebase, including handling files less than 50MB and large multi-chunk uploads. Use it when: 1. Implementing file uploads in features, 2. Building file URLs for display (building correct file URL)"
---

# File Upload

First create a Temp File, then convert it to a Stored File.

## Create a Temp File

### Files less than 50MB

For files less than 50MB, send this request:

POST https://app-api.{FUSEBASE_HOST}/v3/api/web-editor/file/v2-upload

Put the file in the `file` field (multipart/form-data).
Set the `folder` field to `apps`.

Response:

```
{
    "name": "notes/119/1766749985-f5Ai3b/file.docx",
    "type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "filename": "file.docx",
    "size": 16511
}
```

Use the `name` field to create a Stored File (see below).

### Files larger than 50MB

Initiate a multi-chunk upload:

POST https://app-api.{FUSEBASE_HOST}/v3/api/web-editor/file/v2-upload

Send multipart/form-data with fields:

- `action=start`
- `folder=apps`
- `name=FILE_NAME`
- `type=MIME_TYPE`
- `size=FILE_SIZE_IN_BYTES`

Response with chunk upload URLs:

```
{
    "id": "rTuydPY3YaUR5rZ1kk3",
    "partsUrls": ["https://s3-bucket.s3-eu-central-1.amazonaws.com/notes/119/1766750238-wqXiUD/recording.mov?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAJNDT6ZM5", ...],
    "partSize": 52428800,
    "tempStoredfileName": "notes/119/1766750238-wqXiUD/recording.mov"
}
```

Use `tempStoredfileName` to create a Stored File (see below).

Chunk the file and upload each chunk to the corresponding URL from `partsUrls` array via a `PUT` request with the chunk as the body.

After uploading all chunks, finish the upload:

POST https://app-api.{FUSEBASE_HOST}/v3/api/web-editor/file/v2-upload

with multipart/form-data fields:

- `action=finish`
- `parts=JSON_ARRAY_OF_UPLOADED_PARTS` (each part should have `etag` and `partNumber` fields)
- `uploadingId=ID_FROM_THE_START_RESPONSE`
- `tempStoredfileName=TEMP_STORED_FILE_NAME_FROM_THE_START_RESPONSE`

Here is the code example for chunking and uploading:

> **Chunk retry**: Each chunk should be retried up to 3 times on failure before aborting the whole upload. If any chunk ultimately fails, surface an error to the user — do not silently return null.

```typescript
const UPLOAD_URL =
  "https://app-api.{FUSEBASE_HOST}/v3/api/web-editor/file/v2-upload";
const CHUNK_RETRIES = 3;

async function uploadLargeFile(
  file: File,
  featureToken: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ tempStoredFileName: string } | null> {
  // Step 1: Start multipart upload
  const startForm = new FormData();
  startForm.append("action", "start");
  startForm.append("folder", "apps");
  startForm.append("name", file.name);
  startForm.append("type", file.type);
  startForm.append("size", String(file.size));

  const startRes = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { "x-app-feature-token": featureToken },
    body: startForm,
  });
  if (!startRes.ok) return null;
  const { id, partsUrls, partSize, tempStoredfileName } = await startRes.json();

  // Step 2: Upload all chunks in parallel (S3 pre-signed URLs), with per-chunk retry
  const progress = new Array(partsUrls.length).fill(0);

  const uploadChunk = async (
    url: string,
    index: number,
  ): Promise<{ etag: string; partNumber: number }> => {
    const chunk = file.slice(index * partSize, (index + 1) * partSize);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < CHUNK_RETRIES; attempt++) {
      try {
        const res = await fetch(url, { method: "PUT", body: chunk });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const etag = JSON.parse(res.headers.get("etag") ?? '""');
        if (!etag) throw new Error("Missing etag");

        if (onProgress) {
          progress[index] = chunk.size;
          onProgress(
            progress.reduce((a, b) => a + b, 0),
            file.size,
          );
        }

        return { etag, partNumber: index + 1 };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw new Error(
      `Chunk ${index} failed after ${CHUNK_RETRIES} attempts: ${lastError?.message}`,
    );
  };

  // All chunks run in parallel; if any chunk exhausts retries, Promise.all rejects
  const parts = await Promise.all(
    partsUrls.map((url: string, i: number) => uploadChunk(url, i)),
  );

  // Step 3: Finish the multipart upload
  const finishForm = new FormData();
  finishForm.append("action", "finish");
  finishForm.append("parts", JSON.stringify(parts));
  finishForm.append("uploadingId", id);
  finishForm.append("tempStoredfileName", tempStoredfileName);

  const finishRes = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { "x-app-feature-token": featureToken },
    body: finishForm,
  });
  if (!finishRes.ok) return null;

  return await finishRes.json();
}
```

## Create a Stored File

After creating a Temp File, create a Stored File with this request:

POST https://app-api.{FUSEBASE_HOST}/v4/api/bucket-files/create-relative

With JSON body:

```
{
  "tempStoredFileName": "NAME_FROM_THE_TEMP_FILE",
  "folder": "apps"
}
```

Response:

```json
{
  "bucket": {
    "globalId": "string",
    "userId": 0,
    "workspaceId": "string",
    "target": "string",
    "targetId": "string",
    "groupId": "string",
    "activeItems": 0,
    "clock": 0,
    "deleted": true
  },
  "attachment": {
    "globalId": "string",
    "bucketId": "string",
    "userId": 0,
    "workspaceId": "string",
    "filename": "string",
    "storedFileUUID": "string",
    "kind": "file",
    "type": "string",
    "size": 0,
    "extra": {},
    "clock": 0,
    "deleted": true,
    "updatedAt": 0,
    "createdAt": 0,
    "noteServiceAttachment": true
  },
  "file": {
    "globalId": "string",
    "bucketId": "string",
    "target": "task",
    "targetId": "string",
    "portalId": "string",
    "orgId": "string",
    "workspaceId": "string",
    "taskListId": "string",
    "commentThreadId": "string",
    "filename": "string",
    "type": "image",
    "format": "string",
    "userId": 0,
    "size": 0,
    "createdAt": 0,
    "deleted": true,
    "url": "string",
    "extra": {},
    "breadcrumbs": [
      {
        "type": "portal",
        "name": "string",
        "url": "string"
      }
    ],
    "permissions": {
      "allowAll": true,
      "rejectAll": true,
      "allowUserIds": [1],
      "rejectUserIds": [2]
    }
  }
}
```

Use `attachment.storedFileUUID` as the Stored File ID in other requests.

## Displaying file URLs

The `file.url` in the bucket-files response is a relative URL. Construct the full URL to display or use the file.

## Base URL (prefix) for relative file URLs

Prepend base URL https://app.{FUSEBASE_HOST}/box/file to relative file URLs.

Example:

```typescript
function buildFileHref(url: string): string {
  const base = "https://app.{FUSEBASE_HOST}/box/file";

  return base + url;
}
```
