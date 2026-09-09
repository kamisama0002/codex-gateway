# Managed Runtime Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the existing Gateway terminal UI to open an interactive non-root PTY in each authenticated user's managed Agent Runtime container.

**Architecture:** Gateway keeps the browser on its existing realtime WebSocket and chooses SSH or managed-runtime transport server-side. Runtime Manager authenticates a dedicated signed WebSocket and owns the Docker Exec TTY lifecycle; shared strict schemas define every terminal frame.

**Tech Stack:** Nuxt 4, TypeScript 6, ws, dockerode, xterm.js, Zod, Vitest, Playwright, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-09-managed-runtime-terminal-design.md`

## Global Constraints

- Browser traffic remains on the single Gateway realtime WebSocket.
- Browser never receives Manager URLs, Manager credentials, runtime IDs, container IDs, or Docker access.
- Docker Exec always uses `10001:10001`, `TERM=xterm-256color`, and `/workspace` or a descendant.
- SSH terminals retain their current behavior.
- Browser preview and tmux remain unavailable on managed Runtime hosts.
- No new dependencies.
- Tests follow RED -> GREEN and no secret/container identifier is logged or returned.

---

### Task 1: Shared Runtime Terminal Wire Contract

**Files:**
- Modify: `packages/agent-runtime-contracts/src/schemas.ts`
- Modify: `packages/agent-runtime-contracts/src/index.ts`
- Create: `packages/agent-runtime-contracts/src/terminal.test.ts`

**Interfaces:**
- Produces `runtimeTerminalOpenSchema`, `runtimeTerminalClientMessageSchema`, and `runtimeTerminalServerMessageSchema`.
- Produces corresponding inferred TypeScript types.

- [x] **Step 1: Write failing schema tests**

Test literal valid frames and rejection of unknown fields, `cwd` outside `/workspace`, zero/oversized dimensions, and input above 64 KiB.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm test:unit -- packages/agent-runtime-contracts/src/terminal.test.ts
```

Expected: FAIL because the schemas are not exported.

- [x] **Step 3: Implement strict schemas**

Use Zod discriminated unions. Normalize cwd in consumers, but reject values that are not `/workspace` or prefixed by `/workspace/` at the wire boundary.

- [x] **Step 4: Verify GREEN**

Run the Step 2 command and `pnpm --filter @codex-gateway/agent-runtime-contracts typecheck`.

---

### Task 2: Runtime Manager Docker Exec PTY WebSocket

**Files:**
- Modify: `packages/agent-runtime-manager/src/docker-engine.ts`
- Modify: `packages/agent-runtime-manager/src/docker-engine.test.ts`
- Modify: `packages/agent-runtime-manager/src/lifecycle-service.ts`
- Modify: `packages/agent-runtime-manager/src/http-server.ts`
- Create: `packages/agent-runtime-manager/src/runtime-terminal.ts`
- Create: `packages/agent-runtime-manager/src/runtime-terminal.test.ts`

**Interfaces:**
- `DockerodeEngine.openTerminal(containerId, input)` returns a stream, resize function, exit-code inspection, and close function.
- `RuntimeLifecycleService.openTerminal(request, input)` checks runtime identity/running state before delegating.
- `attachRuntimeTerminal(server, options)` owns the signed WebSocket protocol and Docker stream cleanup.

- [x] **Step 1: Write failing Docker engine and WebSocket tests**

Assert Docker Exec receives TTY/stdin/stdout/stderr, user `10001:10001`, workspace cwd, TERM, and shell fallback. Assert HMAC upgrade authentication, required first open frame, output/input forwarding, resize, close, stale generation rejection, and stable errors.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm test:unit -- packages/agent-runtime-manager/src/docker-engine.test.ts packages/agent-runtime-manager/src/runtime-terminal.test.ts
```

Expected: FAIL because the PTY and WebSocket APIs do not exist.

- [x] **Step 3: Implement Docker PTY and Manager WebSocket**

Reuse `HmacRequestAuthenticator`; use a five-second initial-frame timer; use `StringDecoder` for Docker output; ensure socket/stream listeners and timers are removed on every close path.

- [x] **Step 4: Verify GREEN**

Run the Step 2 command and:

```bash
pnpm --filter @codex-gateway/agent-runtime-manager build
pnpm --filter @codex-gateway/agent-runtime-manager typecheck
```

---

### Task 3: Gateway Managed Terminal Transport

**Files:**
- Modify: `server/utils/gateway/runtime-manager/client.ts`
- Modify: `server/utils/gateway/runtime-manager/client.test.ts`
- Modify: `server/utils/gateway/runtime-manager/runtime-service.ts`
- Modify: `server/utils/gateway/runtime-manager/runtime-service.test.ts`
- Create: `server/utils/gateway/terminal/managed-terminal-channel.ts`
- Create: `server/utils/gateway/terminal/managed-terminal-channel.test.ts`
- Modify: `server/utils/gateway/terminal/terminal-manager.ts`
- Create: `server/utils/gateway/terminal/terminal-manager.test.ts`
- Modify: `server/utils/gateway/realtime/handlers/terminal.ts`

**Interfaces:**
- `RuntimeManagerClient.terminalTarget(placement)` returns a fresh signed WebSocket target.
- `ManagedRuntimeService.terminalTarget(userId)` resolves only that user's placement and node.
- `ManagedTerminalChannel.open(target, input)` adapts Manager frames to the common terminal channel.
- `TerminalManager.openManaged(...)` registers the managed channel with existing output/session behavior.

- [x] **Step 1: Write failing target, ownership, adapter, and session tests**

Assert fresh HMAC nonces, user placement selection, no IDs/secrets in snapshots, ready handshake, output/input/resize/close mapping, and user-scoped session access.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm test:unit -- server/utils/gateway/runtime-manager/client.test.ts server/utils/gateway/runtime-manager/runtime-service.test.ts server/utils/gateway/terminal
```

Expected: FAIL because managed terminal target/channel methods do not exist.

- [x] **Step 3: Implement the managed branch**

Branch on `MANAGED_RUNTIME_HOST_ID` before reading SSH host secrets. Resolve the authenticated user's terminal target, open the adapter, and reuse the existing session snapshot/event bus. Keep SSH code unchanged behind the common channel interface.

- [x] **Step 4: Verify GREEN**

Run the Step 2 command.

---

### Task 4: Enable Managed Runtime Terminal In The UI

**Files:**
- Modify: `shared/runtime/realtime/client-message-schema.ts`
- Modify: `shared/runtime/realtime/client-message-schema.test.ts`
- Modify: `app/composables/workspace/useWorkspaceLaunchActions.ts`
- Modify: `app/components/chat/workspace-tools/tool-catalog.ts`
- Modify: `app/components/chat/workspace-tools/tool-catalog.test.ts`
- Modify: `app/components/chat/workspace-dock/WorkspaceDock.vue`
- Modify: `i18n/locales/zh.json`
- Modify: `i18n/locales/en.json`

**Interfaces:**
- `WorkspaceToolCatalogInput` separates `canOpenTerminal` from `canOpenBrowser`.
- Managed host accepts `terminal.*` but continues to reject `browser.*`.

- [x] **Step 1: Write failing schema and tool-catalog tests**

Assert managed `terminal.open` parses successfully, managed `browser.open` still fails, terminal item is enabled while browser remains disabled, and ordinary remote hosts retain both tools.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm test:unit -- shared/runtime/realtime/client-message-schema.test.ts app/components/chat/workspace-tools/tool-catalog.test.ts
```

Expected: FAIL because managed terminal is rejected and availability is combined.

- [x] **Step 3: Implement availability split and managed cwd defaults**

Managed host terminals default to `/workspace`; project/thread cwd is used only when it is under `/workspace`. Keep browser and tmux disabled.

- [x] **Step 4: Verify GREEN**

Run the Step 2 command.

---

### Task 5: Focused Container E2E And Release Verification

**Files:**
- Create: `tests/e2e/managed-runtime-terminal.spec.ts`
- Modify only if required: `tests/e2e/run-in-containers.sh`

**Interfaces:**
- E2E opens a real managed user Runtime and terminal through Gateway's realtime WebSocket.

- [ ] **Step 1: Write the failing E2E**

Provision/start a managed Runtime, open a project terminal, send `pwd` and `id -u`, resize it, and close it. Assert output contains `/workspace` and UID `10001`, then assert the container stays healthy and no container ID/Manager secret appears in browser messages.

- [ ] **Step 2: Run focused E2E**

```bash
pnpm test:e2e -- tests/e2e/managed-runtime-terminal.spec.ts
```

Expected after implementation: PASS. This wrapper still builds the real Gateway/Manager test services but runs only the new Playwright spec.

- [ ] **Step 3: Run final static checks**

```bash
pnpm lint
git diff --check
```

Document any unrelated pre-existing lint failure separately; all changed files must pass targeted oxlint, formatting, and type checks.

- [ ] **Step 4: Commit, publish, and deploy**

Commit source, push the configured branch, build/push new Runtime Manager and Gateway images to `hub.exdmp.cn:8099/agent/super-ai-docker`, update both runtime nodes and the Gateway Compose release, then run an online terminal smoke test through Dinky SSO.
