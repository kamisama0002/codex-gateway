# Task 3 Report: Main Conversation Connection And Active Wait State

## Status

Implemented the Task 3 main-pane realtime feedback and active runtime notice. The main conversation now reuses the existing `RealtimeConnectionIndicator`; `running` now renders in `ThreadRuntimeNotice` with localized description and active-phase elapsed seconds. No connection store or WebSocket behavior was added.

## TDD Evidence

### RED

Added focused E2E assertions before production edits:

- `realtime-protocol-recovery.spec.ts` closes the real browser realtime socket and requires `realtime-connection-indicator` under `chat-main-pane` to display its reconnecting state.
- `thread-request-notifications.spec.ts` selects a real Pinia-backed running thread and requires the running title, the localized running description, and elapsed text to advance from zero to one second.

The mandated focused E2E command was attempted before the implementation:

```text
pnpm test:e2e -- realtime-protocol-recovery.spec.ts thread-request-notifications.spec.ts
```

It could not reach Docker or Playwright from this Windows shell because `pnpm` tried to execute the POSIX runner directly:

```text
$ tests/e2e/run-in-containers.sh "--" "realtime-protocol-recovery.spec.ts" "thread-request-notifications.spec.ts"
'tests' is not recognized as an internal or external command,
operable program or batch file.
```

Therefore the focused assertions are authored and E2E-type-checked, but no false RED or GREEN E2E result is claimed from this host.

## Changes

- Rendered `RealtimeConnectionIndicator` in `AgentWorkspacePane` so its existing disconnected, reconnecting, recovered, retry, and cleanup behavior is visible in the main conversation without adding a state store or second WebSocket path.
- Extended `ThreadRuntimeNotice` to make ordinary `running` visible, retaining its existing running title and adding matching Chinese and English descriptions.
- Added a one-second elapsed counter for every active runtime phase. Its watcher resets to zero and restarts when `threadId` or `phase` changes; unmount clears its interval. Existing approval/input, retry, and provider-error precedence remains intact.
- Added `threadRuntimeElapsed` and `threadRunningDescription` to both `zh.json` and `en.json`.

## Verification

Passing checks:

```text
pnpm test:unit: 60 test files passed, 250 tests passed
pnpm typecheck: exit 0 (includes vue-tsc -p tests/e2e/tsconfig.json --noEmit)
pnpm lint: exit 0
pnpm exec oxfmt --check [Task 3 files]: exit 0
git diff --check: exit 0
```

The focused container E2E command above remains unexecuted because the required POSIX script cannot start under the current Windows `pnpm` shell. No host Playwright substitute was used because project instructions require the containerized real SSH/app-server path.

## Self-Review

- The main-pane component imports the existing indicator directly; it does not read or duplicate realtime state.
- The runtime notice keeps the existing category-error and retry description precedence. Approval and input still use their existing title, description, warning tone, and controls.
- The elapsed watcher observes both required identity inputs, clears any prior interval before replacement, only starts for active phases with a thread, and is also cleared on unmount.
- Changed production files, locale files, and focused tests exactly match the Task 3 brief. Pre-existing untracked plan/spec files are excluded.

## Concerns

- The real focused E2E scenarios require a supported POSIX/Docker host to execute. They are type-checked but not browser-executed on this Windows shell.
- The exact RED run was blocked at the same POSIX entrypoint before the assertions could execute; this is an environment limitation rather than a behavioral test result.

## Fix Round 1

### Review Finding Addressed

The initial browser E2E only proved that a running notice rendered from zero to one second. It could not prove timer reset after a thread or phase transition, or cleanup after component disposal. The timer lifecycle now resides in the small `useThreadRuntimeElapsed` composable, which `ThreadRuntimeNotice` consumes without changing stores or realtime behavior.

### RED

Before adding the composable, added `app/components/thread/useThreadRuntimeElapsed.test.ts` with real Vue refs, `watch`, and `effectScope`, using fake timers only to control elapsed time. The focused command failed as expected because the new production module did not yet exist:

```text
pnpm test:unit -- app/components/thread/useThreadRuntimeElapsed.test.ts
Error: Cannot find module './useThreadRuntimeElapsed'
Test Files  1 failed | 60 passed (61)
```

### GREEN And Verification

`useThreadRuntimeElapsed` starts one one-second interval only for an active phase, clears the previous interval and resets the counter whenever `threadId` or `phase` changes, and registers `onScopeDispose` cleanup. The unit test exercises four observable outcomes:

- active running phase increments from zero to one after a second;
- changing phase resets elapsed time to zero;
- changing thread ID resets elapsed time to zero;
- stopping the owning Vue scope prevents further increments.

Passing checks:

```text
pnpm test:unit -- app/components/thread/useThreadRuntimeElapsed.test.ts: 61 test files passed, 254 tests passed
pnpm lint: exit 0
git diff --check: exit 0
```

### Fix Round 1 Self-Review

- `ThreadRuntimeNotice` no longer owns a second timer lifecycle; it consumes the composable return ref.
- The composable uses the shared `isActiveThreadRuntimePhase` predicate, keeping its active-phase definition aligned with gateway runtime projection.
- Tests use actual Vue watcher and scope disposal behavior rather than mocked watcher calls or implementation-only timer assertions.
- Existing E2E assertions remain unchanged for the real main-pane reconnect and running-notice surfaces. The pending CentOS E2E execution remains owned by the parent task.
