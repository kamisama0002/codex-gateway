# Chat Anti-Stall Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent silent or excessively long conversation waits and make disconnect, progress, and cancellation explicit.

**Architecture:** Add bounded waits at the Provider, SFTP, and managed-runtime request boundaries. Keep the existing thread/App Server state model, but make pending first-thread creation abortable and expose connection plus active phase state in the main conversation.

**Tech Stack:** Nuxt 4, Vue 3, Pinia, TypeScript, Vitest, Playwright, H3, Web Streams

**Spec:** `docs/superpowers/specs/2026-09-05-chat-anti-stall-design.md`

## Global Constraints

- Provider streams have a 120000 ms idle timeout that resets on every chunk; no total turn deadline.
- Managed-runtime thread start, activation, and turn start use 130000 ms; legacy SSH keeps the 31-minute default.
- Remote file-reference SFTP operations use 30000 ms per operation.
- Cancelling first-thread creation preserves the draft and never sends its turn.
- Do not add fake App Server state or modify `third_party/openai-codex`.
- New UI copy must be present in both `i18n/locales/zh.json` and `i18n/locales/en.json`.
- Use only focused tests for this feature; do not run the unrelated full E2E suite.

---

### Task 1: Bound Backend Streaming And File Validation

**Files:**

- Modify: `server/utils/gateway/providers/provider-proxy.ts`
- Modify: `server/utils/gateway/providers/provider-proxy.test.ts`
- Modify: `server/utils/gateway/project-files/project-file-references.ts`
- Create: `server/utils/gateway/project-files/project-file-references.test.ts`

**Interfaces:**

- `ProviderProxyOptions.streamIdleTimeoutMs?: number`
- `validateProjectFileReferences(host, project, references, { timeoutMs? })`

- [ ] Add a Provider test whose 200 SSE body emits one chunk and then remains silent; the next read must reject with `provider_stream_timeout` after the configured idle interval.
- [ ] Add SFTP tests whose open/realpath/stat callback never returns; each must reject with `file_reference_timeout` using a short injected timeout.
- [ ] Run the tests and confirm they fail because no stream/SFTP idle deadlines exist.
- [ ] Implement a Web Stream wrapper that resets one idle timer for every `read()` and cancels the upstream reader on timeout.
- [ ] Apply the wrapper only to streaming Provider responses and apply the bounded wait to SFTP open, realpath, and stat.
- [ ] Re-run both test files and commit the task.

### Task 2: Abort Managed Runtime Requests And First-Thread Creation

**Files:**

- Modify: `app/stores/gateway-realtime/request-broker.ts`
- Create: `app/stores/gateway-realtime/request-broker.test.ts`
- Modify: `app/stores/gateway-realtime/request-errors.ts`
- Modify: `app/stores/gateway/thread-open/transport.ts`
- Create: `app/stores/gateway/thread-open/transport.test.ts`
- Modify: `app/stores/gateway-thread-view/actions/thread-open.ts`
- Modify: `app/composables/composer/useComposerTurnSubmit.ts`
- Modify: `app/composables/composer/useComposerController.ts`
- Modify: `app/components/chat/ChatComposer.vue`
- Modify: `app/components/chat/composer/ComposerShell.vue`
- Modify: `app/components/chat/composer/ComposerToolbar.vue`
- Modify: `app/stores/gateway-thread-turns/transport.ts`
- Modify: `i18n/locales/zh.json`
- Modify: `i18n/locales/en.json`
- Modify: `tests/e2e/new-thread-composer.spec.ts`

**Interfaces:**

- Realtime request options gain `signal?: AbortSignal`.
- Managed request timeout helper returns `130000` for host `2000000000`, otherwise `undefined`.
- `startThread` context accepts `signal?: AbortSignal`.

- [ ] Add unit tests showing an aborted realtime request rejects immediately and ignores a late response.
- [ ] Add transport tests showing managed hosts receive 130000 ms while SSH hosts keep the broker default.
- [ ] Extend the new-thread E2E to delay `thread.start`, cancel from the primary action, preserve the draft, and observe no `turn.start`.
- [ ] Run the tests and confirm the missing abort/deadline behavior fails.
- [ ] Implement signal cleanup in the request broker and silent handling for intentional aborts.
- [ ] Pass signals through thread creation, make submitting creation the primary cancel action, and stop disabling that button.
- [ ] Start the sidebar refresh without awaiting it so it cannot delay first-turn submission.
- [ ] Apply the managed timeout to managed thread start/activate/turn start requests.
- [ ] Re-run focused unit/E2E tests and commit the task.

### Task 3: Show Main-Pane Connection And Active Wait State

**Files:**

- Modify: `app/components/chat/AgentWorkspacePane.vue`
- Modify: `app/components/thread/ThreadRuntimeNotice.vue`
- Modify: `i18n/locales/zh.json`
- Modify: `i18n/locales/en.json`
- Modify: `tests/e2e/realtime-protocol-recovery.spec.ts`
- Modify: `tests/e2e/thread-request-notifications.spec.ts`

**Interfaces:**

- Reuse `RealtimeConnectionIndicator` in the main pane.
- `ThreadRuntimeNotice` derives elapsed seconds from its current thread/phase lifecycle.

- [ ] Add focused assertions that the main pane displays reconnecting state and that ordinary running state is visible with elapsed time.
- [ ] Run the focused tests and confirm the assertions fail.
- [ ] Render the existing connection indicator in the main pane and include `running` in the runtime notice.
- [ ] Add a one-second elapsed timer that resets when thread or phase changes and stops on unmount.
- [ ] Re-run focused tests and commit the task.

### Task 4: Reproduce And Fix Scroll Anchoring

**Files:**

- Test: `tests/e2e/thread-scroll-behavior.spec.ts`
- Modify only if reproduced: `app/components/thread/VirtualTimelineViewport.vue`
- Modify only if reproduced: `app/components/common/chat-virtualizer/*`

- [ ] Run only the two historically failing detached/upward-scroll cases on the current branch.
- [ ] If they pass, record that no production change is required.
- [ ] If either fails, capture the exact anchor delta and write the smallest failing unit test in `tests/unit/chat-virtualizer-anchoring.test.ts`.
- [ ] Implement the smallest anchor compensation fix and re-run the unit plus two E2E cases.
- [ ] Commit only if code or tests changed.

### Task 5: Reproduce And Fix New-Thread Selection Race

**Files:**

- Test: `tests/e2e/realtime-multi-client.spec.ts`
- Modify only if reproduced: `app/stores/gateway-thread-view/actions/thread-open.ts`
- Modify only if reproduced: `app/stores/gateway/thread-open/view-state.ts`
- Modify only if reproduced: `app/stores/gateway-navigation/*`

- [ ] Run the multi-client test through the background-thread selection assertion on the current branch.
- [ ] If it passes after Task 2's non-blocking catalog refresh, record that no additional production change is required.
- [ ] If it fails, add a focused regression assertion for the competing selection source.
- [ ] Fix ownership so a stale catalog/restore result cannot replace the newly created thread selection.
- [ ] Re-run the focused E2E and commit only if additional changes are required.

### Task 6: Integrated Verification

**Files:**

- Review all files changed by Tasks 1-5.

- [ ] Run all new/changed unit tests.
- [ ] Run Nuxt typecheck, E2E TypeScript typecheck, oxlint, and changed-file formatting checks.
- [ ] Run focused containerized E2E for new-thread cancellation, reconnect status, Provider failure, scroll anchoring, and multi-client selection.
- [ ] Run `git diff --check` and a final code review before PR/deployment.
