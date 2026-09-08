# Managed Runtime Browser Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing Gateway browser panel to the same persistent Chromium instance controlled by Codex through Playwright MCP inside each managed user Runtime.

**Architecture:** The existing per-user `agent-runtime` image owns Xvfb, Openbox, Chromium, x11vnc, noVNC/websockify, an authenticated Runtime browser proxy, Playwright MCP, and Codex App Server. Runtime Manager exposes trusted browser status/endpoint metadata, while Gateway reuses its preview ticket, iframe, HTTP, and WebSocket proxy infrastructure to reach the Runtime browser without publishing container ports.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Node.js 24, Dockerode, Codex App Server 0.153.4, Playwright MCP 0.0.80, Chromium, Xvfb, Openbox, x11vnc, noVNC, websockify, Vitest, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-09-08-managed-runtime-browser-bridge-design.md`

## Global Constraints

- Do not add a browser Sidecar container; all browser processes live in the existing per-user Agent Runtime.
- Keep Gateway and Runtime Manager separate; only Runtime Manager mounts Docker Socket.
- Keep Search MCP and SearXNG unchanged.
- Keep Runtime containers non-root, read-only-rootfs, `CapDrop=ALL`, non-privileged, and without host port bindings.
- Bind CDP, x11vnc, and raw noVNC upstream to loopback; expose only authenticated browser proxy port `6080/tcp` to the Runtime network.
- Persist Chromium data only under `/codex-home/browser-profile` with user `10001:10001` and mode `0700`.
- Use the existing Runtime capability token for Gateway-to-browser-proxy authentication; never expose it to browser code, URLs, cookies, logs, or Realtime messages.
- User and Agent may operate the same Chromium concurrently; do not add takeover or locking UI.
- Frontend states are limited to not started, loading, running, and failed/retry.
- Preserve unrelated changes in `server/utils/gateway/integrations/dataops-mcp-credential-service*`.

---

### Task 1: Define browser Runtime contracts and update the built-in capability

**Files:**
- Modify: `packages/agent-runtime-contracts/src/schemas.ts`
- Modify: `packages/agent-runtime-contracts/src/index.ts`
- Create: `packages/agent-runtime-contracts/src/schemas.test.ts`
- Modify: `server/utils/gateway/storage/mysql-schema.ts`
- Modify: `server/utils/gateway/storage/mysql-migrations.test.ts`
- Modify: `server/utils/gateway/storage/mysql-schema.test.ts`

**Interfaces:**
- Produces `RuntimeBrowserState = "not_started" | "starting" | "ready" | "failed"`.
- Produces `RuntimeBrowserStatus = { runtimeId: string; status: "absent" | "stopped" | "running"; browser: RuntimeBrowserState }`.
- Extends `ManagedRuntimeEndpoint` with `browserUrl: string`.
- Updates `org__browser` to run `playwright-mcp --cdp-endpoint http://127.0.0.1:9222 --output-dir /workspace/.agent/browser --caps vision,pdf`.

- [ ] **Step 1: Add failing contract tests**

Create tests that require:

```ts
expect(
  managedRuntimeEndpointSchema.parse({
    runtimeId: "runtime-a",
    websocketUrl: "ws://codex-runtime-a:4500",
    browserUrl: "http://codex-runtime-a:6080",
    serviceToken: "runtime-token",
  }),
).toMatchObject({ browserUrl: "http://codex-runtime-a:6080" });

expect(
  runtimeBrowserStatusSchema.parse({
    runtimeId: "runtime-a",
    status: "running",
    browser: "ready",
  }),
).toEqual({ runtimeId: "runtime-a", status: "running", browser: "ready" });
```

Extend MySQL migration assertions to require schema version `17` and browser capability args containing `--cdp-endpoint` while rejecting `--headless` and `--user-data-dir`.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm test:unit -- packages/agent-runtime-contracts/src/schemas.test.ts server/utils/gateway/storage/mysql-migrations.test.ts server/utils/gateway/storage/mysql-schema.test.ts
```

Expected: FAIL because browser contracts and migration 17 do not exist.

- [ ] **Step 3: Implement contracts and migration 17**

Add strict Zod schemas and exports. Add migration 17 that updates only the built-in `org__browser` definition to the CDP args and increments its capability version to `1.1.0`; do not overwrite user-created browser capabilities.

- [ ] **Step 4: Verify GREEN**

Run the Step 2 command and expect all selected tests to pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime-contracts/src/schemas.ts packages/agent-runtime-contracts/src/index.ts packages/agent-runtime-contracts/src/schemas.test.ts server/utils/gateway/storage/mysql-schema.ts server/utils/gateway/storage/mysql-migrations.test.ts server/utils/gateway/storage/mysql-schema.test.ts
git commit -m "feat(browser): define managed runtime browser contract"
```

### Task 2: Build the browser stack into Agent Runtime

**Files:**
- Modify: `docker/agent-runtime.Dockerfile`
- Modify: `docker/agent-runtime-entrypoint.sh`
- Modify: `docker/agent-runtime-policy.json`
- Modify: `docker/agent-runtime-tool-manifest.json`
- Create: `docker/agent-runtime-browser-supervisor.mjs`
- Create: `docker/agent-runtime-browser-proxy.mjs`
- Create: `docker/agent-runtime-browser-status.mjs`
- Create: `tests/unit/agent-runtime-browser-supervisor.test.ts`
- Create: `tests/unit/agent-runtime-browser-proxy.test.ts`
- Modify: `packages/agent-runtime-manager/src/image-policy.test.ts`

**Interfaces:**
- `agent-runtime-browser-supervisor.mjs` starts and supervises Xvfb, Openbox, Chromium, x11vnc, websockify/noVNC, browser proxy, and `agent-runtime-config.mjs`.
- `agent-runtime-browser-proxy.mjs` exposes `0.0.0.0:6080`, validates Bearer tokens against `CODEX_REMOTE_TOKEN_SHA256`, and proxies HTTP/WebSocket to `127.0.0.1:6081`.
- `agent-runtime-browser-status.mjs` prints one strict JSON object with browser state for Runtime Manager.

- [ ] **Step 1: Write failing supervisor and proxy tests**

Tests must verify constant-time digest comparison, missing/invalid Bearer rejection, HTTP header stripping, WebSocket upgrade authentication, process dependency order, restart delays `[1000, 2000, 5000, 10000]`, and that browser failure does not terminate the Codex child.

- [ ] **Step 2: Extend image policy tests**

Require installed commands and noVNC launcher path:

```ts
expect(requiredTools).toEqual(
  expect.arrayContaining(["Xvfb", "openbox", "x11vnc", "websockify"]),
);
expect(dockerfile).toContain("/usr/share/novnc/utils/novnc_proxy");
```

Require Dockerfile exposure of `4500` and `6080`, while production/E2E compose still has zero host bindings for Agent Runtime.

- [ ] **Step 3: Verify RED**

```bash
pnpm test:unit -- tests/unit/agent-runtime-browser-supervisor.test.ts tests/unit/agent-runtime-browser-proxy.test.ts packages/agent-runtime-manager/src/image-policy.test.ts
```

Expected: FAIL because scripts and image packages are missing.

- [ ] **Step 4: Implement the Runtime browser stack**

Install `xvfb`, `openbox`, `x11vnc`, `novnc`, and `websockify`. Configure Chromium with `DISPLAY=:99`, CDP loopback port `9222`, and `/codex-home/browser-profile`. Serve noVNC on loopback `6081`; expose only authenticated proxy `6080`.

- [ ] **Step 5: Verify GREEN and dry-run startup**

Run the Step 3 command, then:

```bash
node docker/agent-runtime-browser-supervisor.mjs --dry-run
```

Expected: JSON lists the exact child process order and contains no secret values.

- [ ] **Step 6: Commit**

```bash
git add docker/agent-runtime.Dockerfile docker/agent-runtime-entrypoint.sh docker/agent-runtime-policy.json docker/agent-runtime-tool-manifest.json docker/agent-runtime-browser-supervisor.mjs docker/agent-runtime-browser-proxy.mjs docker/agent-runtime-browser-status.mjs tests/unit/agent-runtime-browser-supervisor.test.ts tests/unit/agent-runtime-browser-proxy.test.ts packages/agent-runtime-manager/src/image-policy.test.ts
git commit -m "feat(browser): run persistent Chromium in agent runtime"
```

### Task 3: Expose browser endpoint and status through Runtime Manager

**Files:**
- Modify: `packages/agent-runtime-manager/src/contracts.ts`
- Modify: `packages/agent-runtime-manager/src/docker-engine.ts`
- Modify: `packages/agent-runtime-manager/src/docker-engine.test.ts`
- Modify: `packages/agent-runtime-manager/src/lifecycle-service.ts`
- Modify: `packages/agent-runtime-manager/src/lifecycle-service.test.ts`
- Modify: `packages/agent-runtime-manager/src/http-server.ts`
- Modify: `server/utils/gateway/runtime-manager/client.ts`
- Modify: `server/utils/gateway/runtime-manager/client.test.ts`

**Interfaces:**
- `DockerEngine.inspectBrowser(containerId: string): Promise<RuntimeBrowserState>` executes `/usr/local/lib/agent-runtime-browser-status.mjs` as user `10001:10001` and parses its JSON.
- `RuntimeLifecycleService.browserStatus({ runtimeId }): Promise<RuntimeBrowserStatus>` maps absent/stopped containers without exec and running containers through `inspectBrowser`.
- Runtime Manager serves `GET /v1/runtimes/{runtimeId}/browser`.
- `RuntimeManagerClient.browserStatus(runtimeId)` returns the shared contract.

- [ ] **Step 1: Write failing Docker and lifecycle tests**

Add assertions that managed containers expose both internal ports without `PortBindings`:

```ts
expect(createOptions.ExposedPorts).toEqual({ "4500/tcp": {}, "6080/tcp": {} });
expect(createOptions.HostConfig?.PortBindings).toBeUndefined();
```

Add lifecycle cases for absent, stopped, ready, starting, and failed browser states.

- [ ] **Step 2: Write failing HTTP/client tests**

Require:

```ts
await expect(client.browserStatus("runtime-a")).resolves.toEqual({
  runtimeId: "runtime-a",
  status: "running",
  browser: "ready",
});
```

Verify the request is `GET /v1/runtimes/runtime-a/browser` with the existing HMAC headers and no body.

- [ ] **Step 3: Verify RED**

```bash
pnpm test:unit -- packages/agent-runtime-manager/src/docker-engine.test.ts packages/agent-runtime-manager/src/lifecycle-service.test.ts server/utils/gateway/runtime-manager/client.test.ts
```

Expected: FAIL because browser inspection and endpoint APIs are missing.

- [ ] **Step 4: Implement Runtime Manager support**

Use fixed constants `CODEX_APP_SERVER_PORT = 4500` and `RUNTIME_BROWSER_PORT = 6080`. Add `browserUrl` when constructing `ManagedRuntimeEndpoint`; never accept either port from a provision request. Parse browser-status script output with `runtimeBrowserStateSchema`.

- [ ] **Step 5: Verify GREEN**

Run the Step 3 command and expect all selected tests to pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-runtime-manager/src/contracts.ts packages/agent-runtime-manager/src/docker-engine.ts packages/agent-runtime-manager/src/docker-engine.test.ts packages/agent-runtime-manager/src/lifecycle-service.ts packages/agent-runtime-manager/src/lifecycle-service.test.ts packages/agent-runtime-manager/src/http-server.ts server/utils/gateway/runtime-manager/client.ts server/utils/gateway/runtime-manager/client.test.ts
git commit -m "feat(browser): expose managed runtime browser status"
```

### Task 4: Add authenticated Runtime browser sessions to Gateway

**Files:**
- Modify: `shared/types/browser.ts`
- Modify: `shared/types/realtime.ts`
- Modify: `shared/runtime/realtime/client-message-schema.ts`
- Modify: `shared/runtime/realtime/server-message-schema.ts`
- Modify: `server/utils/gateway/realtime/message-dispatcher.ts`
- Modify: `server/utils/gateway/realtime/message-handlers.ts`
- Modify: `server/utils/gateway/realtime/handlers/browser-preview.ts`
- Modify: `server/utils/gateway/browser-preview/browser-preview-manager.ts`
- Modify: `server/utils/gateway/browser-preview/browser-preview-proxy.ts`
- Modify: `server/utils/gateway/browser-preview/browser-preview-upstream-connector.ts`
- Create: `server/utils/gateway/browser-preview/runtime-browser-upstream.ts`
- Modify: `server/utils/gateway/runtime-manager/runtime-service.ts`
- Modify: `server/utils/gateway/runtime-manager/runtime-service.test.ts`
- Create: `server/utils/gateway/browser-preview/runtime-browser-upstream.test.ts`
- Modify: `server/utils/gateway/browser-preview/browser-preview-manager.test.ts`
- Modify: `server/utils/gateway/browser-preview/browser-preview-proxy.test.ts`

**Interfaces:**
- Adds client message `{ type: "browser.runtime.open"; requestId; panelId; projectId; threadId }`.
- Reuses server message `{ type: "browser.opened"; requestId; session }` with `session.targetType = "runtime"`.
- `runtimeService.resolveBrowser(userId)` returns server-only `{ browserUrl, runtimeId, serviceToken, state }`.
- `RuntimeBrowserUpstream` validates the Runtime endpoint host/port and injects `Authorization: Bearer <serviceToken>` into HTTP and WebSocket upstream requests.

- [ ] **Step 1: Write failing shared protocol tests**

Require the strict client schema to accept only the runtime-open shape and reject supplied `runtimeId`, `browserUrl`, `serviceToken`, `host`, or `port` fields. Require the server snapshot to contain no token.

- [ ] **Step 2: Write failing ownership and upstream tests**

Tests must prove:

```ts
await expect(runtimeService.resolveBrowser(userA.id)).resolves.toMatchObject({
  runtimeId: runtimeService.runtimeIdForUser(userA.id),
  state: "ready",
});
```

and that a user cannot request another Runtime. Verify injected authorization reaches the Runtime proxy but is removed from downstream browser responses, preview URLs, Realtime payloads, and logs.

- [ ] **Step 3: Verify RED**

```bash
pnpm test:unit -- server/utils/gateway/runtime-manager/runtime-service.test.ts server/utils/gateway/browser-preview/runtime-browser-upstream.test.ts server/utils/gateway/browser-preview/browser-preview-manager.test.ts server/utils/gateway/browser-preview/browser-preview-proxy.test.ts
```

Expected: FAIL because Runtime browser session support is missing.

- [ ] **Step 4: Implement session and proxy support**

Refactor Browser Preview sessions into discriminated `runtime` and `url` upstreams. Preserve URL/SSH behavior unchanged. Runtime sessions obtain all container coordinates server-side from `runtimeService.resolveBrowser(authenticatedUserId(peer))` and connect only to the trusted `browserUrl`.

- [ ] **Step 5: Verify GREEN and secret scan**

Run the Step 3 command, then:

```bash
rg "serviceToken|Authorization" app shared/types/browser.ts shared/types/realtime.ts
```

Expected: no Runtime token appears in browser-facing DTO construction or UI state.

- [ ] **Step 6: Commit**

```bash
git add shared/types/browser.ts shared/types/realtime.ts shared/runtime/realtime/client-message-schema.ts shared/runtime/realtime/server-message-schema.ts server/utils/gateway/realtime/message-dispatcher.ts server/utils/gateway/realtime/message-handlers.ts server/utils/gateway/realtime/handlers/browser-preview.ts server/utils/gateway/browser-preview server/utils/gateway/runtime-manager/runtime-service.ts server/utils/gateway/runtime-manager/runtime-service.test.ts
git commit -m "feat(browser): proxy authenticated runtime browser sessions"
```

### Task 5: Connect the existing Browser button with minimal UI states

**Files:**
- Modify: `app/composables/workspace/useWorkspaceLaunchActions.ts`
- Modify: `app/components/chat/workspace-dock/WorkspaceDock.vue`
- Modify: `app/components/chat/workspace-tools/tool-catalog.ts`
- Modify: `app/components/chat/workspace-tools/tool-catalog.test.ts`
- Modify: `app/stores/gateway-browser/index.ts`
- Modify: `app/stores/gateway-browser/transport.ts`
- Modify: `app/components/browser/BrowserPreviewPanel.vue`
- Modify: `app/components/chat/workspace-dock/useWorkspacePanels.ts`
- Modify: `app/components/chat/workspace-dock/useWorkspaceDockPanels.ts`
- Modify: `i18n/locales/zh.json`
- Modify: `i18n/locales/en.json`
- Create: `tests/unit/managed-runtime-browser-ui.test.ts`

**Interfaces:**
- `openRuntimeBrowser()` creates one Runtime browser panel for the current host/project/thread scope.
- Existing `openBrowser(targetUrl)` remains available only for non-managed SSH hosts.
- `openRuntimeBrowserPreview(panel)` sends `browser.runtime.open` and stores the returned session.
- Runtime Browser Panel renders not-started, loading, iframe, or failed/retry without takeover controls.

- [ ] **Step 1: Write failing workspace action tests**

Require managed hosts to open a Runtime browser panel without opening `BrowserOpenDialog`, while SSH hosts continue to use the URL dialog. Repeated clicks in the same scope must activate the existing Runtime browser panel instead of creating duplicates.

- [ ] **Step 2: Write failing panel-state tests**

Cover:

```ts
expect(runtimeBrowserPresentation("not_started")).toEqual({ action: "start", tone: "idle" });
expect(runtimeBrowserPresentation("starting")).toEqual({ action: null, tone: "loading" });
expect(runtimeBrowserPresentation("ready")).toEqual({ action: null, tone: "browser" });
expect(runtimeBrowserPresentation("failed")).toEqual({ action: "retry", tone: "error" });
```

- [ ] **Step 3: Verify RED**

```bash
pnpm test:unit -- app/components/chat/workspace-tools/tool-catalog.test.ts tests/unit/managed-runtime-browser-ui.test.ts
```

Expected: FAIL because managed Runtime browser actions and presentation do not exist.

- [ ] **Step 4: Implement minimal UI**

For managed hosts, click Browser and immediately add/activate a Runtime panel. The panel calls the existing Runtime start flow when needed, opens the authenticated preview after readiness, and shows only existing spinner, browser iframe, or concise error/retry. Keep noVNC navigation inside the iframe; do not build custom address, tab, login-state, queue, or control-owner UI.

- [ ] **Step 5: Verify GREEN and i18n**

Run the Step 3 command and verify every new visible key exists in both `zh.json` and `en.json`.

- [ ] **Step 6: Commit**

```bash
git add app/composables/workspace/useWorkspaceLaunchActions.ts app/components/chat/workspace-dock/WorkspaceDock.vue app/components/chat/workspace-tools/tool-catalog.ts app/components/chat/workspace-tools/tool-catalog.test.ts app/stores/gateway-browser/index.ts app/stores/gateway-browser/transport.ts app/components/browser/BrowserPreviewPanel.vue app/components/chat/workspace-dock/useWorkspacePanels.ts app/components/chat/workspace-dock/useWorkspaceDockPanels.ts i18n/locales/zh.json i18n/locales/en.json tests/unit/managed-runtime-browser-ui.test.ts
git commit -m "feat(browser): open runtime Chromium from workspace"
```

### Task 6: Add real containerized browser sharing coverage

**Files:**
- Modify: `tests/e2e/docker-compose.yml`
- Modify: `tests/e2e/run-in-containers.sh`
- Create: `tests/e2e/managed-runtime-browser.spec.ts`
- Modify: `scripts/smoke-agent-runtime.mjs`
- Modify: `packages/agent-runtime-manager/src/image-policy.test.ts`

**Interfaces:**
- The E2E Runtime image is the Task 2 image with internal ports `4500` and `6080`.
- The browser test uses real Gateway preview tickets, Runtime Manager, browser proxy, noVNC WebSocket, Chromium, Playwright MCP, and persistent Docker volumes.

- [ ] **Step 1: Write the failing E2E**

The test must:

1. Start a managed Runtime with no host ports.
2. Open the Gateway Runtime Browser panel and wait for the noVNC canvas.
3. Start a Codex turn that calls `org__browser` to navigate to the E2E target page.
4. Verify the Runtime Chromium page through its CDP title and through the Browser Panel canvas/session.
5. Set a deterministic cookie and local-storage value through the shared browser.
6. Restart the Runtime and verify both persisted under the same `codex-home` volume.
7. Start a second user Runtime and prove it cannot authenticate to the first Runtime browser proxy.
8. Kill Chromium, verify the Browser Panel reports failure/loading while chat remains healthy, and verify supervisor recovery.

- [ ] **Step 2: Verify RED**

```bash
pnpm test:e2e -- managed-runtime-browser
```

Expected: FAIL because the Runtime browser stack and proxy are not yet available in the E2E image.

- [ ] **Step 3: Complete E2E wiring and smoke assertions**

Extend image smoke verification to require the browser executables, CDP readiness, authenticated proxy rejection without Bearer, and successful noVNC bootstrap with the Runtime token. Do not weaken existing Docker socket, user, volume, network, read-only-rootfs, or resource-limit checks.

- [ ] **Step 4: Verify GREEN**

```bash
pnpm test:e2e -- managed-runtime-browser
```

Expected: the complete shared-browser scenario passes with no fake app-server or mock Runtime.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/docker-compose.yml tests/e2e/run-in-containers.sh tests/e2e/managed-runtime-browser.spec.ts scripts/smoke-agent-runtime.mjs packages/agent-runtime-manager/src/image-policy.test.ts
git commit -m "test(browser): cover shared runtime Chromium"
```

### Task 7: Full verification and image artifacts

**Files:**
- Modify only failures introduced by Tasks 1–6.
- Create: `docs/superpowers/reports/2026-09-08-managed-runtime-browser-bridge.md`

**Interfaces:**
- Produces verified local Gateway, Runtime Manager, and Agent Runtime images.
- Does not push, deploy, restart production services, or upgrade long-lived user Runtimes without a later explicit deployment request.

- [ ] **Step 1: Run full unit and static verification**

```bash
pnpm test:unit
pnpm lint
pnpm build
git diff --check
```

Expected: all feature-related checks pass; unrelated baseline failures are recorded without bulk formatting unrelated files.

- [ ] **Step 2: Run full containerized E2E**

```bash
pnpm test:e2e
```

Expected: all E2E suites pass, including managed Runtime browser sharing, Docker isolation, App Server, MCP, SSH, file, terminal, and existing Search MCP scenarios.

- [ ] **Step 3: Build the three production images**

Use immutable local tags based on the final commit:

```bash
docker build -t super-ai-docker:gateway-browser-$(git rev-parse --short HEAD) .
docker build -f docker/runtime-manager.Dockerfile -t super-ai-docker:runtime-manager-0.153.4-browser-$(git rev-parse --short HEAD) .
docker build -f docker/agent-runtime.Dockerfile -t super-ai-docker:agent-runtime-0.153.4-browser-$(git rev-parse --short HEAD) .
```

- [ ] **Step 4: Run image smoke tests**

```bash
docker run --rm --network none --entrypoint node super-ai-docker:agent-runtime-0.153.4-browser-$(git rev-parse --short HEAD) /usr/local/lib/smoke-agent-runtime.mjs
docker image inspect super-ai-docker:gateway-browser-$(git rev-parse --short HEAD) super-ai-docker:runtime-manager-0.153.4-browser-$(git rev-parse --short HEAD) super-ai-docker:agent-runtime-0.153.4-browser-$(git rev-parse --short HEAD)
```

Expected: smoke passes and image metadata reports the intended Codex/browser versions and non-root Runtime user.

- [ ] **Step 5: Write final report**

Record exact commits, commands, pass/fail counts, image IDs/sizes, unresolved unrelated failures, and the deployment commands that would be used after approval. Do not include credentials, cookies, Runtime tokens, browser Profile contents, or pairing secrets.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/reports/2026-09-08-managed-runtime-browser-bridge.md
git commit -m "docs(browser): record runtime browser verification"
```
