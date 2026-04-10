---
version: "1.0.0"
mcp_prompt: notes
last_synced: "2026-04-10"
title: "Fusebase Gate Notes Operations"
category: specialized
---
# Fusebase Gate Notes Operations

> **MARKER**: `mcp-notes-loaded` — When this marker is present in context, MCP prompts for this topic may skip conceptual sections and use API reference only.

> **VERSION CHECK**: If operations fail unexpectedly, load MCP prompt `notes` for latest content.

---
## Fusebase Gate Notes Operations

These operations manage workspace note folders, workspace notes, note reads, and note creation flows exposed by Gate.

## Relevant Operations

- listWorkspaceNoteFolders lists visible non-portal note folders for a workspace.
- listWorkspaceNotes lists visible non-portal notes for a workspace folder.
- getWorkspaceNote returns one workspace note together with markdown content.
- createWorkspaceNoteFolder creates a workspace note folder.
- createWorkspaceNote creates a workspace note and can optionally append initial content after creation.

## Identity And Scoping Rules

- Treat `orgId` and `workspaceId` as required path inputs for every notes operation.
- Treat `workspaceId`, `parentId`, and `noteId` as opaque ids. Reuse values returned by previous responses instead of inventing them.
- When `parentId` is omitted for list or create flows, Gate defaults to the workspace root folder id `default`.

## Read Flow Rules

- Use `listWorkspaceNoteFolders` before browsing nested folders when the caller does not already know a folder id.
- `listWorkspaceNotes` returns notes for one parent folder at a time. Omit `parentId` to read the root folder.
- `getWorkspaceNote` is the operation that returns note body content through `note.md`.
- Portal-shared and trashed notes are filtered out from these workspace note list operations.

## Create Flow Rules

- `createWorkspaceNoteFolder` requires a non-empty `title` and optionally accepts `parentId`.
- `createWorkspaceNote` requires a non-empty `title` and optionally accepts `parentId`, `content`, and `format`.
- `format` is only valid when `content` is provided.
- `format` defaults to `text`. Use `html` only when you are intentionally sending html content for the initial paste step.
- `createWorkspaceNote` returns note summary metadata, not the final note body. Call `getWorkspaceNote` afterward when you need the resulting markdown.

## Access Model

- Note reads require `notes.read` and org access.
- Note creation requires `notes.write` and org access.
- If note-service or editor-server writes fail, verify caller permissions and workspace scope before assuming a schema mismatch.

## Working Rules

- Always inspect the exact contract with `tools_describe` or `sdk_describe` before integration work.
- For root note creation or listing, prefer omitting `parentId` instead of inventing a folder id.
- If the caller needs note content after create, follow `createWorkspaceNote` with `getWorkspaceNote`.
---

## Version

- **Version**: 1.0.0
- **Category**: specialized
- **Last synced**: 2026-04-10
- **Priority rule**: If the MCP prompt has a higher version, follow the prompt's API Reference as source of truth.
