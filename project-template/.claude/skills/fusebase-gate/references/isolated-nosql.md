---
version: "1.2.1"
mcp_prompt: isolatedNoSql
last_synced: "2026-04-05"
title: "Fusebase Gate Isolated NoSQL Stores"
category: specialized
---
# Fusebase Gate Isolated NoSQL Stores

> **MARKER**: `mcp-isolated-nosql-loaded` — When this marker is present in context, MCP prompts for this topic may skip conceptual sections and use API reference only.

> **VERSION CHECK**: If operations fail unexpectedly, load MCP prompt `isolatedNoSql` for latest content.

---
## Fusebase Gate Isolated NoSQL Stores

These prompts cover the `nosql/mongodb_atlas` isolated store path.

## Engine And Environment

- The engine name is `mongodb_atlas`.
- In local development the same contract can be backed by a local isolated Mongo server such as `local_isolated_mongo`.
- Treat the tool surface as a portable document API, not as Atlas-specific cloud administration.

## Preferred Workflow

1. Initialize the stage.
2. Create a collection if needed.
3. Use put/get/query/count/delete document operations.
   - Use `getIsolatedStoreNoSqlStats` when you need one aggregated view of collections, document counts, and size hints.
   - For large seeds or migrations, prefer `importIsolatedStoreNoSqlDocuments` with NDJSON instead of repeated per-document writes.
4. Create a checkpoint and wait for its success response before doing risky mutations.
5. For restore, first list revisions, find the desired human-readable label, and then pass the matching `revision.globalId` as `revisionId`.

## Document Rules

- Document identity is controlled by the `documentId` path parameter.
- `putIsolatedStoreNoSqlDocument` upserts by `_id`; the path `documentId` wins over any `_id` inside the payload.
- `putIsolatedStoreNoSqlDocument` request bodies use the shape `{ "document": { ... } }`, not a flat document at the root.
- `importIsolatedStoreNoSqlDocuments` expects NDJSON: one JSON object per line, each with a non-empty string `_id` field.
- `importIsolatedStoreNoSqlDocuments` defaults to unordered bulk writes for better throughput; set `ordered=true` only when strict write order matters.
- Collection names use safe identifiers only.

## Query Rules

- Supported filter operators are `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, and `exists`.
- `query` defaults to `limit=100`; max `limit=500`.
- Max filters: `20`.
- Max sort fields: `5`.
- Use `countIsolatedStoreNoSqlDocuments` together with the same filters when you need pagination totals.

## Snapshot Rules

- Physical checkpoint and restore require `mongodump` and `mongorestore` on the host where `fusebase-gate` runs, or explicit `ISOLATED_MONGO_MONGODUMP_BIN` and `ISOLATED_MONGO_MONGORESTORE_BIN` paths.
- NoSQL checkpoints create physical `mongodump --archive --gzip` snapshots and store a `file://` URL in `snapshotRef`.
- NoSQL checkpoint metadata can include `snapshotStats` for previewing collections, document counts, and size hints before restore.
- NoSQL restore clears the dedicated stage database and runs `mongorestore`.
- Restore only from revisions that already have a physical `file://` snapshot.

## SQL / postgres counterpart

For **`sql` / `postgres`** stores (migrations, row APIs, drift), use MCP **`isolatedSql`** + **`isolatedSqlMigrationDiscipline`** and repo **`docs/isolated-sql-stores.md`**.
---

## Version

- **Version**: 1.2.1
- **Category**: specialized
- **Last synced**: 2026-04-05
- **Priority rule**: If the MCP prompt has a higher version, follow the prompt's API Reference as source of truth.
