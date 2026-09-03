# Cursor-style Sidebar Thread Lifecycle

- Date: 2026-09-01
- Status: approved for phase 1 implementation
- Scope: sidebar IA + `thread/archive` + `thread/unarchive` + `thread/delete`

## Goal

Phase 1 restyles the gateway sidebar toward Cursor Agents, and wires archive / unarchive / delete to the real Codex App Server. Chat timeline, composer, and workspace dock stay unchanged.

Visual language follows Cursor. Protocol and data follow gateway App Server:

- Archive hides a thread from the active list and keeps history.
- Unarchive restores it to the active list.
- Delete is a hard delete of the thread and spawned descendants.

## Out of scope

- Chat timeline / composer / workspace dock restyle (phases 2–3).
- Fork, rollback, review, heartbeat automations.
- Replacing Host → Project → Thread with Cursor repository grouping.
- Direct Delete on the active thread menu.

## UX

Active project thread rows:

- Context menu: Pin / Unpin, Rename, Archive.
- Archive has no confirmation.
- Denser rows than today (smaller vertical padding, same shadcn primitives).

Archived threads are **not** nested under a project folder and are **not** a separate sidebar section. Cursor exposes archive as a **filter on the repository list**.

- The host tree header has a filter menu, like Cursor's Repositories header.
- **Filters → Archived** toggles the same Host → Project tree between active and archived threads.
- Do not clone Cursor's Status / PR / Environment / Source filters; those are cloud-agent concepts.
- Turning the filter on loads `GET /api/threads?archived=true` for the selected host and groups results under each project.
- Archived row menu: Unarchive, Delete.
- Clicking an archived row unarchives, then opens it.
- Delete uses `AlertDialog`. Copy: deletion cannot be undone; subagent threads are also deleted. Default action is cancel.

Tree chrome follows Cursor's repository list: folder icon, no disclosure chevron, agent rows indented under the folder name, one-line title plus relative time, muted selected background. Empty projects show `No agents yet` / 暂无会话.

After archive or delete of the open thread:

- Remove it from the active list, pinned list, and recent list.
- Clear `threadId` from the URL and return to the project (new-thread composer).
- Close the browser thread subscription and drop the cached view.

## Backend

HTTP, same shape as rename:

- `POST /api/threads/archive` `{ hostId, threadId }`
- `POST /api/threads/unarchive` `{ hostId, threadId }` → `{ thread }`
- `POST /api/threads/delete` `{ hostId, threadId }`
- `GET /api/threads` accepts `archived` (`true` lists archived only; omitted/false lists active).

RPC mapping:

- Archive → `thread/archive`
- Unarchive → `thread/unarchive`
- Delete → `thread/delete`

After archive or delete:

- Close the thread controller.
- Delete the open snapshot so list overlay cannot resurrect it.
- Delete metadata only on hard delete.
- Unpin the thread in user config.
- Publish a user-scoped `thread.catalog.updated` realtime message to every authenticated page.

`GET /api/threads` must not overlay cached snapshots onto an archived listing.

## Frontend sync

`thread.catalog.updated` payload:

```ts
{
  type: "thread.catalog.updated";
  hostId: number;
  threadId: string;
  action: "archived" | "unarchived" | "deleted";
  thread: GatewayThread | null;
}
```

Every page applies the same local catalog mutation. Do not depend on thread-scoped `thread.event` for list updates. Existing `thread/archived` toasts stay, but they are not the sync path.

## Testing

- Unit: RPC params, snapshot removal, archived list overlay, catalog event shape.
- E2E against real App Server: archive removes the row; archived section restore; delete confirmation; current-thread route cleanup; second browser stays in sync.

## Success

- Active list never shows archived threads after a successful archive.
- Archived threads are reachable from the host-tree **Archived** filter, still grouped under Host → Project.
- Delete requires confirmation and then disappears from every list and URL.
- Two browsers on the same user see the same catalog change without a manual refresh.
