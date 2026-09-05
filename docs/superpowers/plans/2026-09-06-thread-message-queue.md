# Thread Message Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Queue ordinary composer submissions while a Codex Turn is active and expose the official App Server queue through a DSH-style dock.

**Architecture:** Add a typed `ThreadQueueService` over experimental `thread/queue/*` RPCs, carry queue operations over the existing page WebSocket, and keep a thread-scoped Pinia projection synchronized by `thread/queue/changed`. The composer routes plain Enter to queue while active and reserves `turn/steer` for accelerated Enter or the explicit queue action.

**Tech Stack:** Nuxt 4, Vue 3, Pinia, TypeScript, Zod, shadcn-vue, Codex App Server 0.151 JSON-RPC, Playwright/Vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-thread-message-queue-design.md`

## Global Constraints

- Codex App Server remains the queue source of truth; no local durable queue.
- Default Chinese and matching English copy are required.
- Browser traffic uses the existing single realtime WebSocket.
- Existing `turn/steer` remains available only through an explicit accelerated/action path.
- Make one final feature commit after all tasks; do not create a PR.

---

### Task 1: App Server Queue Protocol Boundary

**Files:**

- Modify: `shared/types/thread.ts`
- Modify: `shared/runtime/app-server.ts`
- Create: `server/utils/gateway/runtime/thread-queue.ts`
- Modify: `server/utils/gateway/runtime/broker.ts`
- Test: `shared/runtime/app-server.test.ts`
- Test: `server/utils/gateway/runtime/thread-queue.test.ts`

**Interfaces:**

- Produces: `QueuedSubmission`, `ThreadQueuePage`, queue response parsers.
- Produces: `ThreadQueueService.list/add/update/delete/reorder/start`.

- [x] **Step 1: Write failing parser and service tests**

Assert exact camelCase App Server responses, pagination, client message identity and all six RPC method/
parameter mappings.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `corepack pnpm exec vitest run shared/runtime/app-server.test.ts server/utils/gateway/runtime/thread-queue.test.ts`

Expected: failures for missing queue parsers/service.

- [x] **Step 3: Implement the protocol types, parsers and service**

Use these signatures:

```ts
export interface QueuedSubmission {
  id: string;
  input: Array<Record<string, unknown>>;
  clientUserMessageId: string;
}

export interface ThreadQueuePage {
  data: QueuedSubmission[];
  nextCursor: string | null;
}
```

All RPCs use `ControllerRegistry.withScopedSubscription` and the existing 120-second RPC timeout.

- [x] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2 and require zero failures.

### Task 2: Realtime Queue Contract

**Files:**

- Modify: `shared/types/realtime.ts`
- Modify: `shared/runtime/realtime/client-message-schema.ts`
- Modify: `shared/runtime/realtime/server-message-schema.ts`
- Create: `server/utils/gateway/realtime/handlers/thread-queue.ts`
- Modify: `server/utils/gateway/realtime/message-handlers.ts`
- Modify: `server/utils/gateway/realtime/message-dispatcher.ts`
- Modify: `app/stores/gateway-realtime/response-parsers.ts`
- Modify: `app/stores/gateway-realtime/server-message-handlers.ts`
- Test: `shared/runtime/realtime/client-message-schema.test.ts`
- Test: `shared/runtime/realtime/server-message-schema.test.ts`

**Interfaces:**

- Consumes: `ThreadQueueService` from Task 1.
- Produces: `thread.queue.list|add|update|delete|reorder|start` requests and typed responses.

- [x] **Step 1: Write failing realtime schema tests**

Use literal request/response fixtures and prove malformed IDs, empty input and cross-type responses are
rejected.

- [x] **Step 2: Run schema tests and verify RED**

Run: `corepack pnpm exec vitest run shared/runtime/realtime/client-message-schema.test.ts shared/runtime/realtime/server-message-schema.test.ts`

- [x] **Step 3: Implement queue handlers and dispatcher branches**

Resolve Host access with `requireWorkspaceHost`, invoke the broker, and reply to the requesting peer.
Do not broadcast RPC results; App Server's `thread/queue/changed` drives cross-browser invalidation.

- [x] **Step 4: Run schema tests and verify GREEN**

Run the command from Step 2 and require zero failures.

### Task 3: Queue State And Submission Routing

**Files:**

- Create: `app/stores/gateway-thread-queue/index.ts`
- Create: `app/stores/gateway-thread-queue/transport.ts`
- Create: `app/stores/gateway-thread-queue/index.test.ts`
- Modify: `app/stores/gateway/event-handlers/thread-events.ts`
- Modify: `app/stores/gateway/domain-events.ts`
- Modify: `app/stores/gateway/domain-subscribers/thread-projections.ts`
- Modify: `app/stores/gateway-thread-turns/submission.ts`
- Modify: `app/stores/gateway-thread-turns/actions.ts`
- Modify: `app/composables/composer/useComposerTurnSubmit.ts`
- Modify: `app/composables/composer/useComposerController.ts`
- Test: `app/stores/gateway-thread-turns/submission.test.ts`
- Test: `app/composables/composer/useComposerTurnSubmit.test.ts`

**Interfaces:**

- Produces: `loadQueue`, `queueMessage`, `editQueuedMessage`, `deleteQueuedMessage`,
  `steerQueuedMessage`, `startQueuedMessage` and `queueForThread`.
- Produces: `sendTurn(..., { delivery?: "default" | "steer" })`, where default queues if active.

- [x] **Step 1: Write failing routing and state tests**

Assert that active default submission calls queue add and never inserts a transcript item or calls
`turn/steer`; accelerated submission calls steer; idle submission still starts a Turn; stale queue loads
cannot replace the selected thread's state.

- [x] **Step 2: Run focused tests and verify RED**

Run: `corepack pnpm exec vitest run app/stores/gateway-thread-queue/index.test.ts app/stores/gateway-thread-turns/submission.test.ts app/composables/composer/useComposerTurnSubmit.test.ts`

- [x] **Step 3: Implement queue projection and delivery routing**

Build `UserInput` with the existing `buildUserInput` semantics, reload on `thread/queue/changed`, and
clear/restores drafts only after the queue RPC outcome is known.

- [x] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2 and require zero failures.

### Task 4: DSH Queue Dock

**Files:**

- Create: `app/components/chat/composer/ComposerQueueDock.vue`
- Modify: `app/components/chat/composer/ComposerShell.vue`
- Modify: `app/components/chat/ChatComposer.vue`
- Modify: `app/components/chat/composer/ComposerToolbar.vue`
- Modify: `i18n/locales/zh.json`
- Modify: `i18n/locales/en.json`
- Test: `tests/e2e/thread-queue.spec.ts`

**Interfaces:**

- Consumes: queue projection/actions from Task 3.
- Produces: a DSH-style dock with edit, delete, steer/start and count disclosure.

- [x] **Step 1: Add a failing component/E2E fixture assertion**

Assert a running plain-Enter submission appears in `data-testid="composer-queue-dock"`, the timeline
has no steered bubble, and icon actions have accessible labels.

- [x] **Step 2: Verify the assertion is RED**

Run the narrowest existing Vitest/component fixture; reserve the container E2E for Task 5.

- [x] **Step 3: Implement the dock and accelerated gesture**

Plain Enter calls default delivery. `Ctrl+Enter`/`Meta+Enter` calls explicit steer while active. Reuse
shadcn Button/Tooltip/Collapsible primitives and Lucide Queue, Pencil, Trash, Send and Play icons.

- [x] **Step 4: Run focused UI tests and verify GREEN**

Run only the component/unit files changed by this task.

### Task 5: Real Queue E2E And Delivery

**Files:**

- Complete: `tests/e2e/thread-queue.spec.ts`
- Update: `docs/app-server-interface-coverage.zh-CN.md`

**Interfaces:**

- Verifies all prior tasks against a real Nuxt server, SSH target and Codex App Server.

- [x] **Step 1: Run the real queue E2E and verify initial failure**

Use the repository container runner with `tests/e2e/thread-queue.spec.ts`. The first run must fail at
the missing behavior before production implementation is accepted.

- [x] **Step 2: Complete only integration fixes exposed by the E2E**

Do not replace App Server with mocks or add timing sleeps; wait on queue notifications and real Turn
state.

- [x] **Step 3: Run final focused verification**

Run queue/parser/submission unit tests, Nuxt and E2E typechecks, oxlint, changed-file formatting,
`git diff --check`, the real queue E2E, and production build.

- [ ] **Step 4: Commit, push and deploy**

Create one feature commit, push `HEAD:dev`, deploy the exact remote `dev` commit to CentOS 10, rebuild
only `codex-gateway`, and verify HTTP health. Do not restart Runtime Manager or long-lived Agent
containers.
