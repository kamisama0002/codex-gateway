# Task 2 Report: Abort Managed Runtime Requests And First-Thread Creation

## Status

Implemented the Task 2 browser-side cancellation and managed-runtime deadline behavior. The focused unit suite, full unit suite, Task 2 lint/format checks, and E2E TypeScript check pass. The containerized E2E scenario could not be executed from this Windows shell because the repository's POSIX runner is not launched by `pnpm test:e2e`. Full `pnpm lint` is blocked by two pre-existing Task 1 TypeScript errors outside this task's allowed files.

## TDD Evidence

### RED: broker abort and managed deadline selection

Command:

```text
..\..\node_modules\.bin\vitest.cmd run app/stores/gateway-realtime/request-broker.test.ts app/stores/gateway/thread-open/transport.test.ts
```

Observed before production changes:

```text
Test Files  2 failed (2)
Tests       2 failed | 1 passed (3)
request-broker: expected undefined to be an instance of RealtimeRequestError
transport: expected [undefined, undefined, undefined] to equal three { timeoutMs: 130000 } options
```

The SSH control case passed while the managed-runtime case failed, proving the timeout test distinguished the requested host behavior.

### RED: timeout listener cleanup found during self-review

Command:

```text
..\..\node_modules\.bin\vitest.cmd run app/stores/gateway-realtime/request-broker.test.ts
```

Observed before routing timeout settlement through shared cleanup:

```text
Test Files  1 failed (1)
Tests       1 failed | 1 passed (2)
expected removeEventListener to be called 2 times, but got 1
```

The initial test ordering also produced a handled-late rejection warning. The test was corrected to attach its rejection expectation before advancing fake timers; production cleanup then changed independently.

### GREEN

Focused command after implementation:

```text
..\..\node_modules\.bin\vitest.cmd run app/stores/gateway-realtime/request-broker.test.ts app/stores/gateway/thread-open/transport.test.ts
```

Result:

```text
Test Files  2 passed (2)
Tests       4 passed (4)
```

## Changes

- Added `signal?: AbortSignal` to realtime request options. Abort now works while waiting for readiness and while a request is pending, rejects with `RealtimeRequestError.reason === "aborted"`, and removes the timer, abort listener, and pending request entry. Timeout settlement also uses the same cleanup path. A response received after cancellation has no pending request to resolve.
- Added a shared browser request option selector used by thread start, thread activation, and turn start. Managed host `2000000000` receives `timeoutMs: 130000`; SSH hosts receive no timeout override and retain the unchanged 31-minute broker default.
- Thread creation accepts a signal through the thread-view action and transport. Intentional cancellation returns `null` without setting a user-visible gateway error.
- First-thread composer submission owns an `AbortController`. While creation is pending, the primary button remains enabled, exposes the localized cancellation label, and shows the stop icon. Clicking it aborts only `thread.start`. Draft text, attachments, and references are not cleared unless thread creation succeeds, and cancellation exits before `turn.start`.
- Successful creation commits the selected thread and starts `navigation.listThreads()` in the background, so sidebar refresh cannot delay the first turn.
- Extended `new-thread-composer.spec.ts` with a real App Server cancellation case. It pauses the real remote `codex app-server` with `SIGSTOP`, cancels the browser request, resumes with `SIGCONT`, waits for the real late `thread.started` frame, then checks that the new-thread view and draft remain and no `turn.start` was sent. It does not inject fake App Server state or protocol responses.
- Added matching Chinese and English cancellation labels.

## Verification

Passing checks:

```text
Full unit: 59 test files passed, 249 tests passed
Focused unit after final component refactor: 2 test files passed, 4 tests passed
E2E TypeScript: vue-tsc -p tests/e2e/tsconfig.json --noEmit (exit 0)
Task 2 oxlint: exit 0
Task 2 oxfmt --check: all 15 matched files use the correct format
git diff --check: exit 0
```

One intermediate full-unit run timed out at the unrelated 5-second supervisor test `packages/agent-runtime-manager/src/image-policy.test.ts:125`. The exact isolated test then passed (`1 passed`, 2.29 seconds), and the subsequent full rerun passed all 59 files / 249 tests in 5.72 seconds.

Standard `pnpm lint` did not complete because the baseline Task 1 file has errors outside Task 2 scope:

```text
server/utils/gateway/project-files/project-file-references.test.ts(49,16): error TS7006: Parameter 'path' implicitly has an 'any' type.
server/utils/gateway/project-files/project-file-references.test.ts(49,22): error TS7006: Parameter 'callback' implicitly has an 'any' type.
[ELIFECYCLE] Command failed with exit code 2.
```

Standard focused E2E command attempted both before and after implementation:

```text
pnpm test:e2e -- tests/e2e/new-thread-composer.spec.ts
$ tests/e2e/run-in-containers.sh "--" "tests/e2e/new-thread-composer.spec.ts"
'tests' is not recognized as an internal or external command,
operable program or batch file.
[ELIFECYCLE] Command failed with exit code 1.
```

This failure occurs at the Windows shell entrypoint before Docker or Playwright starts, so no E2E result is claimed.

## Self-Review

- Requirement values are exact: host ID `2000000000`, browser deadline `130000`, global broker default still `31 * 60_000`.
- No server cancellation protocol message or fake App Server response was added.
- Abort cleanup is centralized for resolve, reject, timeout, disconnect, and intentional cancellation; late response dispatch finds no pending entry.
- The abort detector is based on the typed error reason rather than message text, preventing user-visible suppression of unrelated failures.
- The composer controller prioritizes pending thread cancellation before turn interruption or submission. Enter remains guarded while creation is pending, while the primary button remains clickable for cancellation.
- The creation flag is cleared immediately after successful `thread.start`, before `turn.start`; a later click cannot abort an already-settled creation request.
- Existing ChatComposer and ComposerShell prop plumbing was retained but renamed to `creatingFirstThread` for the cancellation state; no additional component state was introduced.
- Only Task 2 files and this required report are staged. Pre-existing untracked plan/spec files remain untouched and excluded.

## Concerns

- The real containerized cancellation E2E is authored and type-checked but unexecuted on this Windows host because the mandated POSIX runner does not start. It must be run in the supported Docker/POSIX environment.
- Repository-wide lint remains red until the parent task fixes the two Task 1 TS7006 errors listed above.
- The full unit suite contains a timing-sensitive supervisor test that timed out once at 5 seconds; its isolated rerun and the final complete rerun passed.

## Fix Round 1

### Review Findings Addressed

- Late errors for intentionally aborted requests are now suppressed without changing ordinary orphan-error behavior. The broker retains at most 256 intentional-abort request IDs. A matching late success or error consumes the ID; a second unmatched error returns to `{ delivered: false, notify: true }` and remains globally visible.
- `waitForReady(timeoutMs, signal?)` now owns cancellation in the connection layer. Aborting removes the waiter from `readyWaiters`, clears its 15-second timer, removes its listener, and rejects immediately. The broker converts that rejection back to the distinguishable `RealtimeRequestError.reason === "aborted"` contract.
- Attachment upload is disabled during first-thread creation. The primary action ignores upload state while creation is pending, stays enabled, and continues to show the cancellation icon and label.
- The real cancellation E2E now also asserts that the attachment button is disabled while the real App Server request is paused.

### RED Evidence

Command:

```text
..\..\node_modules\.bin\vitest.cmd run app/stores/gateway-realtime/request-broker.test.ts app/stores/gateway-realtime/connection.test.ts
```

Observed before Fix Round 1 production changes:

```text
Test Files  2 failed (2)
Tests       2 failed | 1 passed (3)
late error: expected { delivered: true, notify: false }, received { delivered: false, notify: true }
unready abort: expected rejection to equal AbortSignal.reason, received undefined
```

The unready-abort failure occurred before the timer/listener assertions, and the late-error failure directly exercised the return contract consumed by `server-message-handlers.ts`.

### GREEN And Verification

```text
Focused unit: 3 test files passed, 5 tests passed
Full unit: 60 test files passed, 250 tests passed
Task 2 oxlint: exit 0
E2E TypeScript: vue-tsc -p tests/e2e/tsconfig.json --noEmit (exit 0)
Task 2 oxfmt --check: exit 0
git diff --check: exit 0
```

`pnpm lint` ran the complete typecheck successfully and then stopped in global `lint:ox` on four Task 1 findings outside the allowed Task 2 files:

```text
server/utils/gateway/project-files/project-file-references.ts:130:42: prefer-promise-reject-errors
server/utils/gateway/project-files/project-file-references.ts:133:20: prefer-promise-reject-errors
server/utils/gateway/project-files/project-file-references.test.ts:40:56: no-unsafe-type-assertion
server/utils/gateway/project-files/project-file-references.test.ts:48:56: no-unsafe-type-assertion
```

The standard repository format check remains blocked by pre-existing formatting in `nuxt.config.ts`, `playwright.config.ts`, and `tailwind.config.ts`. Task 2's targeted format check passes. The focused E2E still cannot start from this Windows shell because `pnpm test:e2e` cannot execute `tests/e2e/run-in-containers.sh`; no Playwright/Docker result is claimed.

### Fix Round 1 Self-Review

- The intentional-abort registry is bounded, insertion ordered, and consumption based; it is not an unbounded tombstone map.
- Only request IDs created and aborted while pending are recorded. Readiness-stage aborts have no request ID and leave no tombstone.
- A late success consumes the tombstone in `resolveRequest`; a late server error consumes it in `rejectRequest` and returns the existing handler's suppressing `{ delivered: true, notify: false }` contract.
- Every connection waiter exit (ready, disconnect, timeout, abort) clears timer/listener/set ownership through `clearReadyWaiter`.
- No server protocol cancellation message, fake response, draft clearing, or change to the 31-minute default was introduced.

### Fix Round 1 Concerns

- If more than 256 intentionally aborted requests remain unanswered simultaneously, the oldest request ID is evicted and a much later error for it can surface as an orphan error. This is the explicit bounded-memory tradeoff requested by review.
- The real E2E assertion is authored and type-checked but remains unexecuted on this Windows host due to the POSIX runner entrypoint.
- Global lint and global format remain red only in the task-external files listed above; they were not modified.
