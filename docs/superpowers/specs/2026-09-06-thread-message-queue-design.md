# Thread Message Queue Design

## Goal

Match DSH's busy-composer behavior using Codex App Server as the queue source of truth. Plain Enter
while a Turn is active queues the message instead of steering it into the active Turn.

## Behavior

- Idle thread submission continues to call `turn/start`.
- Active thread submission calls `thread/queue/add` with the same text/image `UserInput` payload.
- `Cmd/Ctrl+Enter` while active explicitly calls `turn/steer`.
- Queued messages render in a compact dock attached above the composer. One message renders directly;
  multiple messages render behind a count header and can be expanded.
- A queued message can be edited or deleted. While a Turn is active it can also be steered immediately;
  while idle it can be started as the next Turn.
- The dock reloads from `thread/queue/list` after `thread/queue/changed`, reconnect and thread switch.
- App Server queue records are authoritative. Optimistic state exists only until the matching RPC
  response or notification triggers a fresh list.
- Queued messages enter the transcript only when App Server starts them.
- Queue operations stay scoped to the authenticated user's resolved Host and Thread.

## Visual Direction

Use the DSH queue dock structure with existing Gateway tokens and shadcn controls: a quiet tinted
surface inset inside the composer width, queue icon, single-line preview, and icon-only edit/delete/
steer-or-start actions with tooltips. It is not a card and adds no decorative animation.

## Error And Lifecycle Rules

- Failed queue admission restores the exact frozen composer draft.
- Failed edit/delete/steer/start leaves the authoritative queue row visible and reports the error.
- Stale queue responses are ignored after user/session/thread changes.
- Stop preserves queued messages. The user can edit, delete or start them later.
- Queue size and validation errors from App Server are shown without client-side invented limits.

## Verification

- Unit tests cover protocol parsing, submission routing, queue state replacement and DSH presentation.
- Realtime contract tests cover all queue request/response messages.
- A real container E2E starts a long Turn, queues another message, verifies it is not steered, edits it,
  and observes automatic execution after the active Turn completes.
