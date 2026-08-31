# Per-User Docker Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one persistent, isolated Codex App Server Docker runtime per authenticated Gateway user without breaking the existing SSH-host runtime.

**Architecture:** Add a private TypeScript Runtime Manager service that is the only process allowed to access Docker. Gateway persists runtime ownership in SQLite, resolves a managed runtime to a synthetic host identity, and selects either the existing SSH RPC transport or a direct internal WebSocket transport. The existing thread broker remains keyed by `hostId`, which minimizes changes to current frontend and realtime state.

**Tech Stack:** Nuxt 4/Nitro, TypeScript 6, Node 24, node:sqlite, Zod 4, WebSocket, Docker Engine, Docker Compose, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-31-dual-runtime-agent-platform-design.md`

## Global Constraints

- One authenticated user maps to one long-running Agent container; all of that user's threads share it.
- Existing SSH hosts continue to work unchanged.
- Browser code never receives the Docker socket, container address, App Server token, or Runtime Manager secret.
- Agent containers publish no host ports and run non-root with a read-only root filesystem and dropped capabilities.
- Runtime Manager accepts only fixed lifecycle operations; it has no arbitrary Docker-command endpoint.
- Production code is added only after a failing test demonstrates the missing behavior.
- All visible text is added in both `i18n/locales/zh-CN.json` and `i18n/locales/en.json`.
- Relevant completion gates are `pnpm lint`, `pnpm test:unit`, `pnpm test:e2e`, and `git diff --check`.

---

### Task 1: Add the unit-test runner and versioned database migrations

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `server/utils/gateway/storage/database.ts`
- Create: `server/utils/gateway/storage/migrations.ts`
- Create: `server/utils/gateway/storage/migrations.test.ts`
- Modify: `server/utils/gateway/auth/users.ts`
- Modify: `server/utils/gateway/auth/context.ts`
- Modify: `scripts/create-user.mjs`
- Create: `shared/types/audit.ts`
- Create: `server/utils/gateway/audit/audit-store.ts`
- Create: `server/utils/gateway/audit/audit-store.test.ts`

**Interfaces:**
- Produces: `migrateGatewayDatabase(db: DatabaseSync): void`
- Produces: `AuthenticatedUser.role: "admin" | "user"`
- Produces: `requireAdminUser(event: H3Event): AuthenticatedUser`
- Creates: `schema_migrations` and `user_agent_runtimes` tables; the runtime row stores the reserved managed-host identity.
- Creates: `agent_audit_events` and `auditStore.record/listForAdmin/listForUser` with metadata-only payloads.

- [ ] **Step 1: Add the Vitest command and failing migration tests**

Add `vitest` to root dev dependencies and scripts:

```json
{
  "scripts": {
    "test:unit": "vitest run"
  }
}
```

Create tests using an in-memory `DatabaseSync`:

```ts
it("adds user roles and the per-user runtime table idempotently", () => {
  const db = new DatabaseSync(":memory:");
  migrateGatewayDatabase(db);
  migrateGatewayDatabase(db);
  const userColumns = db.prepare("PRAGMA table_info(users)").all();
  expect(userColumns.some((column) => column.name === "role")).toBe(true);
  expect(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_agent_runtimes'").get(),
  ).toBeTruthy();
});
```

Insert an existing user before migration and assert the oldest active user becomes `admin`, while later users remain `user`.

- [ ] **Step 2: Run the migration test and verify RED**

Run: `pnpm exec vitest run server/utils/gateway/storage/migrations.test.ts`

Expected: FAIL because `migrations.ts` and `migrateGatewayDatabase` do not exist.

- [ ] **Step 3: Implement numbered migrations**

Create an ordered migration list and record applied versions transactionally:

```ts
export function migrateGatewayDatabase(db: DatabaseSync) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  for (const migration of migrations) {
    if (isApplied(db, migration.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(migration.version, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }
}
```

Migration 1 preserves the existing tables. Migration 2 adds `users.role` with default `user` and promotes the oldest active user when no admin exists. Migration 3 creates `user_agent_runtimes` with a unique `user_id`, the reserved `host_id`, runtime type, container/image/version/schema/status/error/timestamp fields. Migration 4 creates `agent_audit_events`. Managed runtimes use `MANAGED_RUNTIME_HOST_ID = 2_000_000_000`; configured SSH hosts are rejected if they attempt to use that reserved value.

- [ ] **Step 4: Add role-aware authentication**

Extend `AuthenticatedUser`, login, and token authentication queries with `role`. Add:

```ts
export function requireAdminUser(event: H3Event) {
  const user = requireAuthenticatedUser(event);
  if (user.role !== "admin") throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  return user;
}
```

Update `scripts/create-user.mjs` to accept `--role admin|user`; when omitted, the first database user is `admin` and subsequent users are `user`.

Implement `auditStore` with an allow-listed JSON metadata schema. It accepts IDs, action, outcome, error code, timestamp, and non-sensitive counts; it rejects keys matching token, secret, password, authorization, prompt, input, output, or content.

- [ ] **Step 5: Verify GREEN and full type safety**

Run:

```text
pnpm exec vitest run server/utils/gateway/storage/migrations.test.ts server/utils/gateway/audit/audit-store.test.ts
pnpm typecheck
```

Expected: PASS with two consecutive migrations producing one schema and role types compiling through auth middleware.

- [ ] **Step 6: Commit**

```text
git add package.json pnpm-lock.yaml scripts/create-user.mjs shared/types/audit.ts server/utils/gateway/storage server/utils/gateway/auth server/utils/gateway/audit
git commit -m "feat: add runtime database migrations and user roles"
```

---

### Task 2: Define runtime contracts, state transitions, and persistence

**Files:**
- Create: `packages/agent-runtime-contracts/package.json`
- Create: `packages/agent-runtime-contracts/tsconfig.json`
- Create: `packages/agent-runtime-contracts/src/index.ts`
- Create: `packages/agent-runtime-contracts/src/schemas.ts`
- Create: `packages/agent-runtime-contracts/src/driver.ts`
- Modify: `shared/types.ts`
- Create: `server/utils/gateway/runtime-manager/runtime-state.ts`
- Create: `server/utils/gateway/runtime-manager/runtime-state.test.ts`
- Create: `server/utils/gateway/runtime-manager/runtime-store.ts`
- Create: `server/utils/gateway/runtime-manager/runtime-store.test.ts`

**Interfaces:**
- Produces: `@codex-gateway/agent-runtime-contracts` with `RuntimeType`, `RuntimeStatus`, `UserAgentRuntimeRecord`, `ManagedRuntimeEndpoint`, wire Zod schemas, and the runtime-neutral `AgentRuntimeDriver` interface.
- Produces: `transitionRuntime(current, event): RuntimeStatus`.
- Produces: `runtimeStore.getByUserId`, `upsert`, `updateStatus`, `deleteForUser`.

- [ ] **Step 1: Write failing state-machine tests**

```ts
it("allows a provisioned runtime to become ready through schema and capability checks", () => {
  expect(reduceRuntimeEvents("absent", ["provision", "start", "schemaOk", "capabilitiesOk"]))
    .toBe("ready");
});

it("rejects ready when the schema is incompatible", () => {
  expect(transitionRuntime("schema_checking", "schemaMismatch")).toBe("incompatible");
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm exec vitest run server/utils/gateway/runtime-manager/runtime-state.test.ts`

Expected: FAIL because the runtime contracts package and transition functions are absent.

- [ ] **Step 3: Implement exhaustive runtime types and transitions**

Implement the runtime contracts as a workspace package whose only runtime dependency is Zod. `AgentRuntimeDriver` exposes ready/capabilities/conversation/turn/interrupt/approval operations using platform DTOs and contains no Codex Thread types, so a later Agents SDK driver can implement the same interface. Use an exhaustive event/status table in Gateway. Invalid transitions throw `RuntimeTransitionError` containing current status and event; do not silently coerce states.

- [ ] **Step 4: Write failing runtime-store ownership tests**

Use an in-memory migrated database and verify:

```ts
it("never returns another user's runtime", () => {
  store.upsert(runtimeFor(1, "container-a"));
  expect(store.getByUserId(2)).toBeNull();
});
```

- [ ] **Step 5: Implement the SQLite runtime store**

Every update includes `WHERE user_id = ?`; container IDs and internal endpoints are never returned by browser DTO serializers.

- [ ] **Step 6: Verify and commit**

Run:

```text
pnpm exec vitest run server/utils/gateway/runtime-manager
pnpm typecheck
```

Commit:

```text
git add packages/agent-runtime-contracts shared/types.ts server/utils/gateway/runtime-manager
git commit -m "feat: add persisted agent runtime state"
```

---

### Task 3: Build the private Runtime Manager package

**Files:**
- Create: `packages/agent-runtime-manager/package.json`
- Create: `packages/agent-runtime-manager/tsconfig.json`
- Create: `packages/agent-runtime-manager/src/contracts.ts`
- Create: `packages/agent-runtime-manager/src/auth.ts`
- Create: `packages/agent-runtime-manager/src/http-server.ts`
- Create: `packages/agent-runtime-manager/src/lifecycle-service.ts`
- Create: `packages/agent-runtime-manager/src/lifecycle-service.test.ts`
- Create: `packages/agent-runtime-manager/src/docker-engine.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `turbo.json`

**Interfaces:**
- Consumes: `@codex-gateway/agent-runtime-contracts` from Task 2; the internal service must not import Nitro server state.
- Produces: authenticated `POST /v1/runtimes/provision|start|stop|restart|upgrade|remove` and `GET /v1/runtimes/:runtimeId`.
- Produces: `DockerEngine` interface and `RuntimeLifecycleService`.

- [ ] **Step 1: Add package scaffolding and failing lifecycle tests**

The test injects a recording `DockerEngine` and proves idempotency:

```ts
it("reuses the existing labeled container for the same runtime id", async () => {
  const engine = new RecordingDockerEngine({ existingContainerId: "container-a" });
  const service = new RuntimeLifecycleService(engine, testPolicy);
  const first = await service.provision(requestFor("runtime-a"));
  const second = await service.provision(requestFor("runtime-a"));
  expect(first.containerId).toBe("container-a");
  expect(second.containerId).toBe("container-a");
  expect(engine.createCalls).toHaveLength(0);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm --filter @codex-gateway/agent-runtime-manager test`

Expected: FAIL because package scripts and lifecycle implementation are missing.

- [ ] **Step 3: Implement fixed internal contracts and HMAC authentication**

Requests carry timestamp, nonce, body SHA-256, and HMAC signature. Reject timestamps outside five minutes and replayed nonces. Internal secret comes from `RUNTIME_MANAGER_SHARED_SECRET`.

- [ ] **Step 4: Implement Docker lifecycle policy**

The manager constructs container options internally:

```ts
const securityPolicy = {
  User: "10001:10001",
  ReadonlyRootfs: true,
  CapDrop: ["ALL"],
  SecurityOpt: ["no-new-privileges:true"],
  PidsLimit: 256,
  Memory: 2 * 1024 * 1024 * 1024,
  NanoCpus: 2_000_000_000,
};
```

The request can select only an image alias from server configuration; raw image names, mount paths, commands, capabilities, networks, and ports are not request parameters.

- [ ] **Step 5: Implement Docker Engine adapter**

Use the mature `dockerode` library behind `DockerEngine`. Label every resource with runtime ID, user hash, image version, and managed marker. Never use username in names or labels.

- [ ] **Step 6: Verify and commit**

Run:

```text
pnpm --filter @codex-gateway/agent-runtime-manager test
pnpm --filter @codex-gateway/agent-runtime-manager build
pnpm typecheck:dependencies
```

Commit:

```text
git add packages/agent-runtime-manager package.json pnpm-lock.yaml turbo.json
git commit -m "feat: add private agent runtime manager"
```

---

### Task 4: Build the pinned Codex Agent image

**Files:**
- Create: `docker/agent-runtime.Dockerfile`
- Create: `docker/agent-runtime-entrypoint.sh`
- Create: `docker/runtime-manager.Dockerfile`
- Create: `docker/agent-runtime-healthcheck.mjs`
- Modify: `docker-compose.yml`
- Modify: `.env.example`

**Interfaces:**
- Produces: image label `com.qiancheng.codex.version=0.151.0`.
- Produces: internal App Server WebSocket at container port `4500` with bearer-token authentication.
- Produces: persistent `/codex-home` and `/workspace` mount points.

- [ ] **Step 1: Add a failing Compose/image policy check**

Create a small Node test in `packages/agent-runtime-manager/src/image-policy.test.ts` that parses the intended container policy and asserts no published ports, non-root user, read-only rootfs, dropped capabilities, and exact Codex version label.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm --filter @codex-gateway/agent-runtime-manager test`

Expected: FAIL because the image policy manifest does not exist.

- [ ] **Step 3: Implement the Agent image**

Install exactly `@openai/codex@0.151.0`, create UID/GID 10001, and run:

```text
codex app-server --listen ws://0.0.0.0:4500 --remote-auth-token-env CODEX_REMOTE_TOKEN
```

Use `tini`, set `CODEX_HOME=/codex-home`, and keep root filesystem immutable outside declared tmpfs paths and volumes.

- [ ] **Step 4: Add Runtime Manager deployment without exposing it publicly**

Add `agent-runtime-manager` to an internal network, mount the Docker socket only there, and expose its HTTP port only to `codex-gateway`. Add required shared secret, Agent image alias, resource limits, and network names to `.env.example`.

- [ ] **Step 5: Verify Docker configuration**

Run:

```text
docker compose config
docker build -f docker/agent-runtime.Dockerfile -t codex-agent-runtime:test .
docker inspect codex-agent-runtime:test
```

Expected: exact version label, non-root user, no image build error, and Compose has no Agent or Runtime Manager host port publication.

- [ ] **Step 6: Commit**

```text
git add docker docker-compose.yml .env.example
git commit -m "feat: add isolated codex agent image"
```

---

### Task 5: Connect Gateway to managed runtimes

**Files:**
- Create: `server/utils/gateway/runtime-manager/client.ts`
- Create: `server/utils/gateway/runtime-manager/client.test.ts`
- Create: `server/utils/gateway/runtime-manager/runtime-service.ts`
- Create: `server/utils/gateway/runtime-manager/codex-runtime-driver.ts`
- Create: `server/utils/gateway/runtime-manager/codex-runtime-driver.test.ts`
- Create: `server/api/runtime/me.get.ts`
- Create: `server/api/runtime/start.post.ts`
- Create: `server/api/admin/runtimes/index.get.ts`
- Create: `server/api/admin/runtimes/[userId]/restart.post.ts`
- Modify: `shared/types/records.ts`
- Modify: `shared/runtime/realtime/client-message-schema.ts`
- Modify: `server/utils/gateway/infra/rpc/rpc-transport.ts`
- Create: `server/utils/gateway/infra/rpc/managed-rpc-transport.ts`
- Modify: `server/utils/gateway/infra/rpc/rpc.ts`
- Modify: `server/utils/gateway/runtime/controller-registry.ts`

**Interfaces:**
- Consumes: Runtime Manager HTTP API and persisted runtime records.
- Produces: `ManagedCodexRpcTransport` implementing existing `RpcTransport`.
- Produces: `CodexAppServerDriver` implementing `AgentRuntimeDriver` by delegating current conversation/turn operations to `threadBroker`.
- Produces: `connectionKind: "ssh" | "managed"` on internal Host records, defaulting old data to `ssh`, and `MANAGED_RUNTIME_HOST_ID = 2_000_000_000` for the hidden per-user runtime.
- Produces: authenticated user Runtime status API and admin-only Runtime controls.

- [ ] **Step 1: Write failing HMAC client and transport-selection tests**

```ts
it("selects the managed websocket transport without opening SSH", () => {
  const transport = createCodexRpcTransport(managedHost, options);
  expect(transport).toBeInstanceOf(ManagedCodexRpcTransport);
});
```

Also assert that browser Runtime DTOs omit endpoint and service token.

Add a failing `CodexAppServerDriver` test proving `startTurn` maps platform IDs to the authenticated user's managed host and never accepts a caller-supplied Host secret.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm exec vitest run server/utils/gateway/runtime-manager server/utils/gateway/infra/rpc`

Expected: FAIL because managed transport and safe DTO serializer are absent.

- [ ] **Step 3: Implement Runtime Manager client and runtime service**

Sign requests, validate responses with Zod, serialize starts per user with `Mutex`, persist every state transition, and return a browser-safe status DTO.

Record provision, start, stop, restart, compatibility failure, and removal through `auditStore` using only runtime/user/image/status identifiers and safe error codes.

Implement `CodexAppServerDriver` as the only platform-to-Codex orchestration entry point for managed runtimes. Existing SSH UI paths may keep calling `threadBroker` directly until a later migration.

- [ ] **Step 4: Add managed WebSocket transport**

Connect to the internal endpoint with bearer auth. Keep the same close/error callbacks as SSH transport. Never log the URL query, Authorization header, or token.

- [ ] **Step 5: Preserve existing host IDs as runtime keys**

Resolve one hidden managed-host record per user with `hostId = MANAGED_RUNTIME_HOST_ID` and retain `hostId` in current Thread/Gateway event DTOs. Do not add the hidden record to the configured `hostStore` list, so `nextId()` for SSH hosts remains unchanged. Existing configured SSH hosts remain user-visible and unchanged. Managed host connection details come from `runtimeStore`, not encrypted user config or browser payloads.

- [ ] **Step 6: Add user/admin API authorization**

`/api/runtime/me` uses the authenticated user ID. Admin routes use `requireAdminUser`; they accept a target user ID but never a container ID or endpoint supplied by the browser.

- [ ] **Step 7: Verify and commit**

Run:

```text
pnpm exec vitest run server/utils/gateway/runtime-manager server/utils/gateway/infra/rpc
pnpm lint
```

Commit:

```text
git add server/utils/gateway/runtime-manager server/utils/gateway/infra/rpc server/api/runtime server/api/admin/runtimes packages/agent-runtime-contracts shared
git commit -m "feat: connect gateway to managed user runtimes"
```

---

### Task 6: Add two-user Docker isolation E2E

**Files:**
- Modify: `tests/e2e/docker-compose.yml`
- Create: `tests/e2e/managed-runtime-isolation.spec.ts`
- Create: `tests/e2e/helpers/managed-runtime.ts`
- Modify: `tests/e2e/global-setup.ts`
- Modify: `tests/e2e/global-teardown.ts`

**Interfaces:**
- Consumes: real Runtime Manager, Agent image, Gateway auth, direct managed RPC transport.
- Proves: per-user container/volume/token/event isolation and restart recovery.

- [ ] **Step 1: Write the failing E2E**

Create users `runtime-a` and `runtime-b`, start both runtimes, create one Thread in each, then assert:

```ts
expect(runtimeA.containerId).not.toBe(runtimeB.containerId);
expect(await listThreadsAs(userA)).not.toContainEqual(expect.objectContaining({ id: threadB }));
expect(await listThreadsAs(userB)).not.toContainEqual(expect.objectContaining({ id: threadA }));
```

Attempt to use user A's internal Runtime token against user B's App Server and require rejection.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test:e2e -- managed-runtime-isolation.spec.ts`

Expected: FAIL before managed Runtime services exist in E2E Compose.

- [ ] **Step 3: Extend the real E2E topology**

Build the Agent and Runtime Manager images, create a private Agent network, mount only named user volumes, and make teardown remove test containers/volumes by the E2E managed label.

- [ ] **Step 4: Complete isolation and recovery assertions**

Restart Gateway and one Agent container. Assert both users retain only their own history, the restarted runtime returns to `ready`, and the other user's active stream remains connected.

- [ ] **Step 5: Run full verification**

Run:

```text
pnpm test:unit
pnpm lint
pnpm test:e2e
git diff --check
```

Expected: all unit, type, lint, build, and real Docker E2E checks pass.

- [ ] **Step 6: Commit**

```text
git add tests/e2e
git commit -m "test: verify per-user agent container isolation"
```
