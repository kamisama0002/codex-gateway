# Capabilities, MCP, and Conversation Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a runtime-neutral capability catalog with Codex Skills/Plugins/Apps/MCP adapters, per-user MCP OAuth, and fixed platform APIs/UI for Fork, Archive, Unarchive, Rollback, and Review.

**Architecture:** Platform capability definitions and assignments are stored independently from runtime-specific DTOs. A Codex capability adapter reads and reconciles desired state inside each user's App Server container. Browser actions call fixed Gateway endpoints; Codex RPC names remain behind the runtime driver. User MCP OAuth state and tokens are encrypted and scoped to exactly one user/runtime/server.

**Tech Stack:** Nuxt 4/Nitro, TypeScript 6, Pinia, node:sqlite, Zod 4, existing Gateway RPC/realtime broker, shadcn-vue, Vitest, Playwright with real App Server Docker runtimes.

**Spec:** `docs/superpowers/specs/2026-08-31-dual-runtime-agent-platform-design.md`

## Global Constraints

- Administrators install, uninstall, upgrade, enable, disable, and assign capabilities.
- Ordinary users can view/use only assigned capabilities and can manage only their own MCP OAuth.
- Capability authorization defaults to deny and is rechecked server-side at use time.
- Browser APIs never accept arbitrary App Server method names or raw installation arguments.
- MCP access/refresh tokens and plugin secrets are encrypted and never returned to the browser.
- Capability reconciliation is idempotent and isolated per user Runtime.
- Rollback requires explicit confirmation and audit; Review uses a separate View Model.
- Codex-specific code stays behind `CodexCapabilityAdapter` and `CodexConversationActions`.
- All visible text is added in Chinese and English.
- Relevant completion gates are `pnpm test:unit`, `pnpm lint`, `pnpm test:e2e`, and `git diff --check`.

---

### Task 1: Persist the runtime-neutral capability catalog and assignments

**Files:**
- Modify: `server/utils/gateway/storage/migrations.ts`
- Create: `shared/types/capabilities.ts`
- Modify: `shared/types.ts`
- Create: `server/utils/gateway/capabilities/capability-store.ts`
- Create: `server/utils/gateway/capabilities/capability-store.test.ts`
- Create: `server/utils/gateway/http/validation/capabilities.ts`

**Interfaces:**
- Produces: `CapabilityKind`, `PlatformCapability`, `CapabilityAssignment`, `EffectiveCapability`.
- Produces: `capabilityStore.listForAdmin`, `listEffectiveForUser`, `upsert`, `assign`, `unassign`.
- Creates: `capabilities`, `capability_assignments`, `runtime_capability_syncs`.

- [ ] **Step 1: Write failing default-deny and scope tests**

```ts
it("does not expose an unassigned capability to an ordinary user", () => {
  store.upsert(skillCapability("sales-analysis"));
  expect(store.listEffectiveForUser({ userId: 2, projectIds: [10], roles: ["user"] }))
    .toEqual([]);
});

it("combines role, user, and project grants without crossing users", () => {
  store.assign({ capabilityId: "sales-analysis", subjectType: "project", subjectId: "10" });
  expect(store.isAllowed({ capabilityId: "sales-analysis", userId: 2, projectIds: [10] })).toBe(true);
  expect(store.isAllowed({ capabilityId: "sales-analysis", userId: 3, projectIds: [11] })).toBe(false);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm exec vitest run server/utils/gateway/capabilities/capability-store.test.ts`

Expected: FAIL because catalog types, tables, and store do not exist.

- [ ] **Step 3: Add migrations and strict shared types**

Use the approved kinds:

```ts
export type CapabilityKind =
  | "skill"
  | "plugin"
  | "app"
  | "mcp"
  | "tool"
  | "agent"
  | "handoff"
  | "guardrail";
```

Store runtime-specific identifiers in validated metadata JSON, not in common columns.

- [ ] **Step 4: Implement deterministic effective authorization**

Assignments support `user`, `role`, and `project`. Disabled capabilities always deny. The effective result includes the matching assignment scopes for audit and UI explanation.

- [ ] **Step 5: Verify and commit**

Run:

```text
pnpm exec vitest run server/utils/gateway/capabilities/capability-store.test.ts
pnpm typecheck
```

Commit:

```text
git add server/utils/gateway/storage/migrations.ts server/utils/gateway/capabilities server/utils/gateway/http/validation/capabilities.ts shared
git commit -m "feat: add runtime-neutral capability catalog"
```

---

### Task 2: Implement the Codex capability adapter

**Files:**
- Create: `server/utils/gateway/capabilities/runtime-capability-adapter.ts`
- Create: `server/utils/gateway/capabilities/codex-capability-adapter.ts`
- Create: `server/utils/gateway/capabilities/codex-capability-adapter.test.ts`
- Create: `server/utils/gateway/runtime/app-server-extensions.ts`
- Modify: `server/utils/gateway/runtime/broker.ts`
- Modify: `shared/runtime/app-server.ts`

**Interfaces:**
- Produces: `RuntimeCapabilityAdapter.readActualState`, `planChanges`, `applyChange`.
- Produces: `CodexCapabilityAdapter` mappings for Skills, Plugins, Apps, MCP.
- Adds Broker methods for the exact generated App Server request types.

- [ ] **Step 1: Write failing desired/actual diff tests**

```ts
it("plans only the missing plugin install", async () => {
  const desired = [plugin("sales-tools", { enabled: true })];
  const actual = snapshot({ plugins: [] });
  expect(adapter.planChanges(desired, actual)).toEqual([
    { type: "plugin.install", capabilityId: "sales-tools" },
  ]);
});
```

Also test no-op reconciliation, disabled Skill config, removed Plugin, installed App, MCP reload, and unsupported method capability.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm exec vitest run server/utils/gateway/capabilities/codex-capability-adapter.test.ts`

Expected: FAIL because runtime adapter and extension service are missing.

- [ ] **Step 3: Add typed App Server extension service**

Implement exact methods:

```text
skills/list
skills/config/write
plugin/list
plugin/read
plugin/install
plugin/uninstall
app/list
app/read
app/installed
mcpServerStatus/list
mcpServer/oauth/login
config/mcpServer/reload
```

Parse every response with generated DTOs plus Zod boundary validation.

- [ ] **Step 4: Implement pure plan generation and one-change execution**

`planChanges` is side-effect free. `applyChange` handles one typed operation and returns `applied | skipped | failed` with a safe message. It does not loop or write sync state.

- [ ] **Step 5: Verify and commit**

Run:

```text
pnpm exec vitest run server/utils/gateway/capabilities/codex-capability-adapter.test.ts
pnpm lint
```

Commit:

```text
git add server/utils/gateway/capabilities server/utils/gateway/runtime/app-server-extensions.ts server/utils/gateway/runtime/broker.ts shared/runtime/app-server.ts
git commit -m "feat: add codex capability adapter"
```

---

### Task 3: Reconcile capability desired state into user runtimes

**Files:**
- Create: `server/utils/gateway/capabilities/reconciler.ts`
- Create: `server/utils/gateway/capabilities/reconciler.test.ts`
- Create: `server/utils/gateway/capabilities/sync-store.ts`
- Modify: `server/utils/gateway/runtime-manager/runtime-service.ts`
- Create: `server/api/admin/runtime-syncs/index.get.ts`
- Create: `server/api/admin/runtime-syncs/[userId].post.ts`

**Interfaces:**
- Consumes: capability store, Runtime service, Runtime capability adapter.
- Produces: `reconcileUserRuntime(userId, reason): CapabilitySyncResult`.
- Persists: generation, desired hash, actual hash, operation results, safe error, timestamps.

- [ ] **Step 1: Write failing idempotency and isolation tests**

```ts
it("does not repeat operations after the desired hash is already applied", async () => {
  await reconciler.reconcileUserRuntime(1, "startup");
  await reconciler.reconcileUserRuntime(1, "background");
  expect(adapter.applyCalls).toHaveLength(1);
});
```

Also prove user A failure does not mutate user B sync state.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm exec vitest run server/utils/gateway/capabilities/reconciler.test.ts`

Expected: FAIL because reconciler and sync store do not exist.

- [ ] **Step 3: Implement serialized per-user reconciliation**

Acquire a per-user mutex, require Runtime `ready` or `syncing_capabilities`, read actual state, compute deterministic hashes, apply operations sequentially, re-read actual state, and persist the final result.

- [ ] **Step 4: Hook initial sync into Runtime startup**

A newly started container cannot transition from `syncing_capabilities` to `ready` until reconciliation succeeds. Background/admin sync failures preserve the last usable configuration and set a per-capability error without stopping unrelated runtimes.

- [ ] **Step 5: Add admin sync APIs and verify**

Only admins can list all users or trigger a target-user sync. A user may see their own safe sync status through `/api/capabilities` but cannot trigger raw operations.

Run:

```text
pnpm exec vitest run server/utils/gateway/capabilities
pnpm lint
```

- [ ] **Step 6: Commit**

```text
git add server/utils/gateway/capabilities server/utils/gateway/runtime-manager/runtime-service.ts server/api/admin/runtime-syncs
git commit -m "feat: reconcile capabilities into user runtimes"
```

---

### Task 4: Add capability APIs and settings UI

**Files:**
- Create: `server/api/capabilities/index.get.ts`
- Create: `server/api/admin/capabilities/index.get.ts`
- Create: `server/api/admin/capabilities/index.post.ts`
- Create: `server/api/admin/capabilities/[id].patch.ts`
- Create: `server/api/admin/capabilities/[id].delete.ts`
- Create: `server/api/admin/capabilities/[id]/assignments.post.ts`
- Create: `app/components/settings/CapabilitySettingsTab.vue`
- Create: `app/components/settings/settings-dock/SettingsDockCapabilityPanel.vue`
- Modify: `app/components/settings/settings-dock/types.ts`
- Modify: `app/components/settings/settings-dock/panel-registry.ts`
- Modify: `app/components/settings/settings-dock/useSettingsDock.ts`
- Create: `app/stores/gateway-capabilities/index.ts`
- Modify: `i18n/locales/zh-CN.json`
- Modify: `i18n/locales/en.json`
- Create: `tests/e2e/capability-permissions.spec.ts`

**Interfaces:**
- Produces: user capability catalog DTO with `allowed`, `requiresUserAuth`, and sync status.
- Produces: admin CRUD/assignment DTOs.
- Produces: Settings Dock capability panel with Skills/Plugins/Apps/MCP tabs.

- [ ] **Step 1: Write failing UI/API E2E**

Assert an ordinary user sees only assigned capabilities and no install/uninstall controls. Assert admin sees all capabilities, can assign one, and the user's page updates after reload.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test:e2e -- capability-permissions.spec.ts`

Expected: FAIL because routes, store, and panel do not exist.

- [ ] **Step 3: Implement fixed APIs**

Admin mutations accept platform capability fields and assignment subjects only. Runtime-specific install arguments are created server-side from validated capability metadata.

- [ ] **Step 4: Implement the Settings Dock panel**

Reuse existing Dock and shadcn-vue components. Keep separate focused components per tab if `CapabilitySettingsTab.vue` exceeds 500 lines. Show actual/desired/sync/auth state and safe error text.

- [ ] **Step 5: Verify responsive and bilingual UI**

Run:

```text
pnpm lint
pnpm test:e2e -- capability-permissions.spec.ts
```

Exercise desktop and mobile widths already present in the E2E project; do not add PWA behavior.

- [ ] **Step 6: Commit**

```text
git add server/api/capabilities server/api/admin/capabilities app/components/settings app/stores/gateway-capabilities i18n tests/e2e/capability-permissions.spec.ts
git commit -m "feat: add capability administration and catalog UI"
```

---

### Task 5: Add per-user MCP OAuth state and encrypted tokens

**Files:**
- Modify: `server/utils/gateway/storage/migrations.ts`
- Create: `server/utils/gateway/capabilities/mcp-oauth-store.ts`
- Create: `server/utils/gateway/capabilities/mcp-oauth-store.test.ts`
- Create: `server/utils/gateway/capabilities/mcp-oauth-service.ts`
- Create: `server/utils/gateway/capabilities/mcp-oauth-service.test.ts`
- Create: `server/api/capabilities/mcp/[id]/oauth/start.post.ts`
- Create: `server/api/capabilities/mcp/oauth/callback.get.ts`
- Create: `server/api/capabilities/mcp/[id]/oauth/revoke.post.ts`
- Modify: `app/stores/gateway-capabilities/index.ts`
- Modify: capability MCP tab component created in Task 4.

**Interfaces:**
- Creates: `user_mcp_credentials` and `mcp_oauth_states`.
- Produces: one-time state bound to user/runtime/MCP server with ten-minute expiration.
- Produces: encrypted token write/read/revoke and per-user Runtime reload.

- [ ] **Step 1: Write failing state-binding tests**

```ts
it("rejects an OAuth callback completed by another user", async () => {
  const state = service.begin({ userId: 1, runtimeId: "r1", mcpServerId: "sales" });
  await expect(service.complete({ userId: 2, state, code: "code" })).rejects.toMatchObject({
    statusCode: 403,
  });
});
```

Also test expiration, one-time consumption, replay, revocation, encrypted-at-rest token value, and user-scoped reload.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm exec vitest run server/utils/gateway/capabilities/mcp-oauth*.test.ts`

Expected: FAIL because OAuth store/service do not exist.

- [ ] **Step 3: Implement OAuth state and token storage**

Store only a state hash; send the raw random state to the browser. Encrypt access/refresh token JSON with existing AES-GCM helpers. Callback redirects to a fixed Gateway capability page and never reflects upstream token data.

- [ ] **Step 4: Integrate App Server OAuth and MCP reload**

Call `mcpServer/oauth/login` in the user's Runtime, persist completion only for the bound user, then call `config/mcpServer/reload`. If the provider uses an external callback, map it through the one-time state service.

- [ ] **Step 5: Verify and commit**

Run:

```text
pnpm exec vitest run server/utils/gateway/capabilities/mcp-oauth*.test.ts
pnpm lint
```

Commit:

```text
git add server/utils/gateway/storage/migrations.ts server/utils/gateway/capabilities/mcp-oauth* server/api/capabilities/mcp app/stores/gateway-capabilities app/components/settings
git commit -m "feat: isolate user mcp oauth credentials"
```

---

### Task 6: Persist and reconcile pending App Server requests

**Files:**
- Modify: `server/utils/gateway/storage/migrations.ts`
- Create: `server/utils/gateway/runtime/pending-request-store.ts`
- Create: `server/utils/gateway/runtime/pending-request-store.test.ts`
- Modify: `server/utils/gateway/runtime/pending-server-requests.ts`
- Modify: `server/utils/gateway/runtime/host-rpc-session.ts`
- Modify: `server/utils/gateway/realtime/server-request-response.ts`
- Modify: `shared/server-requests.ts`
- Modify: `shared/runtime/realtime/server-message-schema.ts`

**Interfaces:**
- Creates: `pending_agent_requests` keyed by user, runtime, thread, stable request fingerprint, and current connection request ID.
- Produces: `pendingRequestStore.record/rebind/resolve/expire/listForThread`.
- Guarantees: request parameters are encrypted, browser DTOs expose only the validated method-specific presentation, and stale connection IDs cannot be approved.

- [ ] **Step 1: Write failing persistence and stale-connection tests**

```ts
it("does not send an approval through a stale connection request id", async () => {
  store.record(requestFor({ connectionGeneration: 1, requestId: 10 }));
  store.markConnectionClosed("runtime-a", 1);
  await expect(service.respond({ userId: 1, fingerprint: "req-a", decision: "accept" }))
    .rejects.toMatchObject({ code: "PENDING_REQUEST_EXPIRED" });
  expect(rpc.responses).toEqual([]);
});
```

Also test encrypted parameter storage, cross-user denial, repeated request rebinding to a new connection/request ID, resolution, and expiration.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm exec vitest run server/utils/gateway/runtime/pending-request-store.test.ts`

Expected: FAIL because persistent pending-request storage does not exist.

- [ ] **Step 3: Implement the pending-request migration and store**

Derive a stable fingerprint from user/runtime/thread/method/item identity, not from connection request ID. Encrypt validated method-specific params with the existing AES-GCM helper. Persist status `pending | reconciling | resolved | expired` and connection generation.

- [ ] **Step 4: Persist receipt and resolution in the live RPC path**

On receipt, validate the known Server Request, persist it, then broadcast. On response, verify authenticated ownership and current connection generation before sending to App Server; update persisted state only after the response write succeeds.

- [ ] **Step 5: Reconcile after Gateway/App Server reconnect**

Mark outstanding requests `reconciling` when a connection closes. If App Server re-emits the same stable request, rebind it to the new request ID and make it actionable again. If Thread refresh completes without re-emission, mark it `expired` and show a retry-turn message; never auto-approve or replay the old response.

- [ ] **Step 6: Verify and commit**

Run:

```text
pnpm exec vitest run server/utils/gateway/runtime/pending-request-store.test.ts
pnpm lint
```

Commit:

```text
git add server/utils/gateway/storage/migrations.ts server/utils/gateway/runtime/pending-request-store* server/utils/gateway/runtime/pending-server-requests.ts server/utils/gateway/runtime/host-rpc-session.ts server/utils/gateway/realtime/server-request-response.ts shared/server-requests.ts shared/runtime/realtime/server-message-schema.ts
git commit -m "feat: persist and reconcile agent approvals"
```

---

### Task 7: Implement fixed Conversation Action services and APIs

**Files:**
- Create: `shared/types/conversation-actions.ts`
- Modify: `shared/types.ts`
- Create: `server/utils/gateway/runtime/conversation-actions.ts`
- Create: `server/utils/gateway/runtime/conversation-actions.test.ts`
- Create: `server/utils/gateway/runtime/conversation-mapping-store.ts`
- Create: `server/utils/gateway/runtime/conversation-mapping-store.test.ts`
- Modify: `server/utils/gateway/storage/migrations.ts`
- Modify: `server/utils/gateway/runtime/broker.ts`
- Create: `server/api/threads/fork.post.ts`
- Create: `server/api/threads/archive.post.ts`
- Create: `server/api/threads/unarchive.post.ts`
- Create: `server/api/threads/rollback.post.ts`
- Create: `server/api/threads/review.post.ts`
- Create: `server/utils/gateway/http/validation/conversation-actions.ts`

**Interfaces:**
- Produces: `ConversationActionService.fork/archive/unarchive/rollback/startReview`.
- Maps to: `thread/fork`, `thread/archive`, `thread/unarchive`, `thread/rollback`, `review/start`.
- Produces: platform-safe action results and audit events.
- Creates: `conversation_runtime_mappings` keyed by user, managed host, thread, runtime, and project, with optional parent thread ID.

- [ ] **Step 1: Write failing permission and RPC mapping tests**

```ts
it("does not call rollback before ownership and confirmation validation", async () => {
  await expect(service.rollback({ userId: 2, hostId: 1, threadId: "foreign", numTurns: 1, confirmed: true }))
    .rejects.toMatchObject({ statusCode: 404 });
  expect(rpc.requests).toEqual([]);
});
```

Test exact params for all five RPC methods, fork parent mapping, rollback bounds, archive idempotency, and review target validation.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm exec vitest run server/utils/gateway/runtime/conversation-actions.test.ts`

Expected: FAIL because action service and Broker methods are missing.

- [ ] **Step 3: Implement typed Broker methods**

Use generated request/response types and current Controller Registry. Archive/unarchive close or reacquire subscriptions correctly. Fork retains the new upstream subscription and returns the new Thread identity. Rollback refreshes the authoritative snapshot after success.

- [ ] **Step 4: Implement ownership, confirmation, and audit service**

Persist and resolve Thread ownership through `conversation_runtime_mappings`. Return 404 for foreign Thread mappings to avoid leaking existence. Rollback requires `confirmed: true` and `numTurns` within the supported positive bound.

- [ ] **Step 5: Add fixed routes and verify**

Every route reads `event.context.auth.user.id`, validates a known DTO, and calls one service method. No route accepts `method`, `containerId`, endpoint, token, or arbitrary params.

Run:

```text
pnpm exec vitest run server/utils/gateway/runtime/conversation-actions.test.ts
pnpm lint
```

- [ ] **Step 6: Commit**

```text
git add shared/types/conversation-actions.ts shared/types.ts server/utils/gateway/runtime/conversation-actions* server/utils/gateway/runtime/conversation-mapping-store* server/utils/gateway/runtime/broker.ts server/utils/gateway/storage/migrations.ts server/utils/gateway/http/validation/conversation-actions.ts server/api/threads
git commit -m "feat: add audited conversation actions"
```

---

### Task 8: Add Thread action UI and Review panel

**Files:**
- Create: `app/components/thread/ThreadActionsMenu.vue`
- Create: `app/components/thread/RollbackThreadDialog.vue`
- Create: `app/components/thread/ReviewStartDialog.vue`
- Create: `app/components/chat/workspace-dock/WorkspaceDockAgentReviewPanel.vue`
- Modify: `app/components/chat/workspace-dock/panel-registry.ts`
- Modify: `app/components/chat/workspace-dock/useWorkspacePanels.ts`
- Modify: `app/components/sidebar/thread-list/ThreadRow.vue`
- Modify: `app/components/chat/AgentWorkspacePane.vue`
- Create: `app/stores/gateway-conversation-actions/index.ts`
- Modify: `app/stores/gateway/thread-open/hydration.ts`
- Modify: `i18n/locales/zh-CN.json`
- Modify: `i18n/locales/en.json`
- Create: `tests/e2e/conversation-actions.spec.ts`

**Interfaces:**
- Consumes: fixed Thread action APIs and existing Gateway event bus.
- Produces: reusable action menu in sidebar and active Thread header.
- Produces: independent Agent Review workspace panel.

- [ ] **Step 1: Write failing action UI E2E**

Use a real App Server Thread. Verify action menu contains Fork, Archive, Rollback, Review; Rollback requires a second confirmation; Fork navigates to a different Thread; Archive removes the row; Review opens an independent panel.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test:e2e -- conversation-actions.spec.ts`

Expected: FAIL because actions and dialogs are absent.

- [ ] **Step 3: Implement Pinia action store**

Keep request state per `hostId:threadId:action`. On success, update through authoritative API/event refresh, not invented permanent timeline items. Errors use existing toast/error helpers.

- [ ] **Step 4: Implement shared menu and confirmation dialogs**

Reuse shadcn-vue context menu/dialog/button/input components. Rollback displays the exact number of turns affected. Archive and Unarchive labels reflect current list context.

- [ ] **Step 5: Implement Review panel mapping**

Store `PlatformReviewRun` separately from normal Thread history. Register a workspace panel with review status, summary, findings, and link back to source Thread.

- [ ] **Step 6: Verify desktop/mobile layout and commit**

Run:

```text
pnpm lint
pnpm test:e2e -- conversation-actions.spec.ts
```

Commit:

```text
git add app/components/thread app/components/chat app/components/sidebar/thread-list app/stores/gateway-conversation-actions app/stores/gateway/thread-open i18n tests/e2e/conversation-actions.spec.ts
git commit -m "feat: add thread lifecycle and review UI"
```

---

### Task 9: Verify real capability, OAuth, action, and restart isolation

**Files:**
- Create: `tests/e2e/capability-runtime-isolation.spec.ts`
- Create: `tests/e2e/mcp-oauth-isolation.spec.ts`
- Modify: `tests/e2e/docker-compose.yml`
- Modify: `tests/e2e/helpers/managed-runtime.ts`
- Modify: `docs/app-server-interface-coverage.zh-CN.md`

**Interfaces:**
- Proves: real two-user desired-state sync, user-scoped OAuth, fixed actions, restart persistence.
- Updates: interface coverage statuses only after verified implementation exists.

- [ ] **Step 1: Write failing two-user capability E2E**

Admin assigns one Skill/Plugin/MCP to user A but not user B. Start both containers and assert only A sees/uses the capability and only A's Runtime actual-state snapshot changes.

- [ ] **Step 2: Write failing OAuth isolation E2E**

Start OAuth as user A, attempt callback as user B, require rejection, then complete as A and verify only A's encrypted credential row and MCP reload state change.

- [ ] **Step 3: Run and verify RED**

Run:

```text
pnpm test:e2e -- capability-runtime-isolation.spec.ts mcp-oauth-isolation.spec.ts
```

Expected: FAIL until the complete capability and OAuth flows are wired into real containers.

- [ ] **Step 4: Complete real fixture configuration and restart checks**

Use deterministic local MCP/OAuth fixtures with real App Server containers. Restart Gateway and both Agent containers; verify desired state, user token ownership, Thread history, and action results persist.

- [ ] **Step 5: Update interface coverage from verified source and tests**

Change only methods now explicitly implemented and tested. Re-run the coverage extraction against the pinned generated contract and document source paths and commit.

- [ ] **Step 6: Run full verification**

Run:

```text
pnpm test:unit
pnpm lint
pnpm test:e2e
git diff --check
```

Expected: all tests pass with two real user containers and no cross-user state.

- [ ] **Step 7: Commit**

```text
git add tests/e2e docs/app-server-interface-coverage.zh-CN.md
git commit -m "test: verify isolated capability and thread workflows"
```
