# Upload Lifecycle

This reference is the canonical source for the Fusebase file upload lifecycle.
Use the same terminology everywhere: `tempStoredFileName`, `storedFileUUID`, `readUrl`, `relative url`, and `file descriptor`.

## Canonical Flow

1. Create a temp file and capture `tempStoredFileName`.
2. Create a stored file from `tempStoredFileName` and capture `storedFileUUID`.
3. Build or read the display URL:
   - `readUrl` is an absolute URL returned by Gate completion flows.
   - `relative url` is a stored file path that must be prefixed before display.
4. Pass a file descriptor to the next layer.

## Create A Temp File

For files smaller than 50 MB, send multipart/form-data to:

`POST https://app-api.{FUSEBASE_HOST}/v3/api/web-editor/file/v2-upload`

Required fields:

- `file`: the file bytes
- `folder`: `apps`

The response includes `name`; treat it as `tempStoredFileName`.

For files 50 MB or larger, use multipart upload against the same endpoint:

1. Start with `action=start`, `folder=apps`, `name`, `type`, and `size`.
2. Upload each chunk to the returned part URL with `PUT`.
3. Finish with `action=finish`, uploaded `parts`, `uploadingId`, and `tempStoredFileName`.

Each chunk should be retried up to 3 times before failing the upload.

## Create A Stored File

After temp upload, create the stored file:

`POST https://app-api.{FUSEBASE_HOST}/v4/api/bucket-files/create-relative`

JSON body:

```json
{
  "tempStoredFileName": "NAME_FROM_TEMP_STEP",
  "folder": "apps"
}
```

The response includes `attachment.storedFileUUID` and file metadata. Use `storedFileUUID` as the stored file id in downstream APIs.

Gate note: file-service stored-file JSON uses `uuid`; Gate file operations expose that same value as `storedFileUUID` and may also return `fileId` as an alias. In guidance and handoffs, prefer `storedFileUUID`.

## Display URLs

If the upload API returns a `relative url`, prepend:

`https://app.{FUSEBASE_HOST}/box/file`

If Gate returns `readUrl`, use it as-is for reads, links, or image `src`.

## File Descriptor

A file descriptor is the object passed to downstream features after upload. Include fields returned by the stored-file response when available:

- `name`
- `url`
- `type`
- `size`
- `globalId`
- `bucketId`
- `userId`
- `workspaceId`
- `storedFileUUID`
- `kind`

The dashboard adapter uses this descriptor inside a `files` column value. Gate adapters may also expose `fileId`, `publicFileName`, and `readUrl`; those are Gate operation outputs, not a separate lifecycle.

## Handoffs

- Dashboard `files` column: use `fusebase-dashboards`; pass the file descriptor to `batchPutDashboardData`.
- Gate MCP/SDK upload operations: use `fusebase-gate`; it owns `startMultipartFileUpload`, `completeMultipartFileUpload`, `deleteFile`, and their auth/scope rules.
