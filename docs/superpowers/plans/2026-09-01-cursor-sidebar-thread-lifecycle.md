# Phase 1 Implementation Plan: Cursor-style sidebar thread lifecycle

> Spec: `docs/superpowers/specs/2026-09-01-cursor-sidebar-thread-lifecycle-design.md`

## Backend

1. Extract list overlay so archived listings never resurrect open snapshots.
2. Add `threadSnapshotStore.delete` and `threadMetadataStore.delete`.
3. Add `thread.catalog.updated` hub + WS message.
4. Add lifecycle service mapping:
   - archive → `thread/archive`
   - unarchive → `thread/unarchive`
   - delete → `thread/delete`
5. HTTP routes `POST /api/threads/{archive,unarchive,delete}` and `GET /api/threads?archived=`.
6. Unpin on archive/delete through the existing user-config mutation path.

## Frontend

1. Navigation actions for archive / unarchive / delete / archived list.
2. Apply `thread.catalog.updated` on every page: prune lists, pins, recent activity, subscriptions, and the current route.
3. Cursor-style denser `ThreadRow` menus: active = Pin/Rename/Archive; archived = Unarchive/Delete.
4. Collapsed **已归档** section under the selected project.
5. Delete confirmation dialog. Clicking an archived row unarchives then opens.

## Verification

- `pnpm test:unit` for overlay, snapshot delete, RPC mapping, catalog events.
- `pnpm lint`
- Targeted `pnpm test:e2e` against real App Server.

## Phase 2

Spec: `docs/superpowers/specs/2026-09-01-cursor-chat-composer-design.md`

1. Composer chrome: compact bordered input, smaller send, denser toolbar/editor.
2. Timeline density: `max-w-3xl`, quieter user pills, unboxed assistant.
3. Desktop thread title bar from the real thread name.
4. Empty/new-thread: keep testids, drop card chrome.

## Phase 3

Spec: `docs/superpowers/specs/2026-09-01-cursor-workspace-dock-design.md`

1. Dock tab strip and group actions: shorter, quieter, no active-group glow.
2. Files explorer: denser header, tree rows, and open-file tabs.
3. Changes / review: compact toolbar and rows.
4. Terminal and browser: compact chrome, flush content.
