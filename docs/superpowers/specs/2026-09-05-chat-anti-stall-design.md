# Chat Anti-Stall Experience Design

## Goal

Keep long-running Codex work possible while ensuring every user-visible wait either makes progress,
can be cancelled, or terminates with an actionable error.

## Confirmed Failure Modes

1. A Provider SSE stream can return headers and then remain silent forever because the request
   timeout is cleared before the stream finishes.
2. Managed-runtime thread start, activation, and turn start inherit the 31-minute legacy SSH
   deadline, so ordinary Agent operations can look frozen.
3. Remote file-reference SFTP operations have no deadline.
4. A WebSocket disconnect during an accepted turn is shown only in the sidebar while the main
   conversation keeps its previous running state.
5. Cancelling while a first thread is still being created only changes local status; it does not
   cancel the pending browser request.
6. Existing E2E artifacts show scroll anchoring failures and a new-thread selection race, but both
   must be reproduced on the current baseline before production code changes.

## Behavior

- Streaming responses use a 120-second idle timeout. Every received chunk resets the timeout;
  total turn duration remains unlimited.
- Managed-runtime thread start, activation, and turn start use a 130-second browser deadline.
  Legacy SSH hosts retain the 31-minute broker default.
- Remote file-reference SFTP open, realpath, and stat operations each fail after 30 seconds.
- The main conversation shows reconnecting/disconnected state as well as ordinary running state.
  Active states show elapsed wait time.
- While the first thread is being created, the primary action cancels the pending browser request,
  preserves the draft, and prevents the first turn from being sent. A late server response is
  ignored; a harmless empty thread may remain and is reused by existing new-conversation logic.
- The post-create sidebar refresh is background work and cannot delay the first turn.
- Scroll and multi-client selection code changes are allowed only after their existing E2E tests
  fail on this branch for the expected reason.

## Verification

- Unit tests cover Provider stream idle timeout, file-reference timeout, abortable realtime
  requests, and managed-host request deadlines.
- Focused browser tests cover cancelling first-thread creation, reconnect/running notices, scroll
  anchoring, and new-thread selection.
- Run typecheck, oxlint, formatting checks for changed files, and the focused containerized E2E
  cases. Do not run the unrelated full E2E suite.
