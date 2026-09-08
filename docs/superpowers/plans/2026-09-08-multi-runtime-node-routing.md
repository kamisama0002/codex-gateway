# Multi-Runtime Node Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the single active Gateway register multiple Runtime Manager nodes, create one durable capacity-aware placement per user, route every lifecycle operation to that placement, and carry App Server RPC through a signed Runtime Manager WebSocket relay.

**Architecture:** MySQL remains the durable authority for runtime nodes and user placements. Gateway bootstraps the existing single Runtime Manager as `node__default`, then uses a node client registry and a serializable placement repository for every operation. Runtime Manager exposes authenticated node health and an authenticated WebSocket relay so Gateway no longer depends on Docker DNS outside the execution node.

**Tech Stack:** Nuxt 4, TypeScript 6, MySQL 8/InnoDB, `mysql2/promise`, Node HTTP upgrade, `ws`, Dockerode, Zod, Vitest, Playwright container E2E.

**Spec:** `docs/superpowers/specs/2026-09-05-multi-runtime-node-first-phase-design.md`

## Global Constraints

- Gateway stays single-active; Redis and active-active Gateway ownership are excluded.
- One user has exactly one Runtime and one durable node placement.
- A node outage never silently creates the user on another node.
- Existing runtime IDs remain stable by defaulting `RUNTIME_IDENTITY_SECRET` to the current manager secret during migration.
- Node secrets are encrypted with `CODEX_GATEWAY_CONFIG_SECRET` and never returned by public APIs.
- Browser DTOs do not expose node URL, node secret, container ID, service token, workspace key, or raw runtime ID.
- Runtime Manager remains the only component with the Docker socket.
- Production node URLs use HTTPS/WSS; HTTP/WS is accepted only when `RUNTIME_NODE_ALLOW_INSECURE_HTTP=1`.
- Current named volumes remain unchanged in this milestone. Node-local bind storage and volume migration are a separate milestone after routing passes production smoke tests.
- Existing `RUNTIME_MANAGER_BASE_URL` and `RUNTIME_MANAGER_SHARED_SECRET` only bootstrap `node__default`; database node records are authoritative afterward.
- Every production change follows red-green-refactor and keeps the current single-node behavior passing before a second node is registered.

---

### Task 1: Runtime Node and Placement Schema

**Files:**
- Modify: `server/utils/gateway/storage/mysql-schema.ts`
- Modify: `server/utils/gateway/storage/mysql-schema.test.ts`
- Modify: `server/utils/gateway/storage/mysql-migrations.test.ts`
- Create: `server/utils/gateway/runtime-manager/runtime-node-types.ts`
- Test: `server/utils/gateway/runtime-manager/runtime-node-types.test.ts`

**Interfaces:**
- Produces `RuntimeNodeRecord`, `RuntimeNodeSchedulingState`, `RuntimePlacementRecord`, and their Zod parsers.
- Adds MySQL migration 16 with `runtime_nodes` and nullable rolling-deployment placement columns on `user_agent_runtimes`.

- [x] **Step 1: Write the failing schema tests**

```ts
it("adds runtime nodes and placement columns in migration 16", () => {
  const migration = MYSQL_SCHEMA_MIGRATIONS.find((item) => item.version === 16);
  const sql = migration?.statements.join("\n") ?? "";
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS runtime_nodes");
  expect(sql).toContain("runtime_node_id VARCHAR(128) NULL");
  expect(sql).toContain("placement_generation INT UNSIGNED NULL");
  expect(sql).toContain("workspace_key VARCHAR(128) NULL");
  expect(sql).toContain("fk_user_agent_runtimes_runtime_node");
});
```

```ts
it("rejects a runtime node URL containing credentials", () => {
  expect(() =>
    runtimeNodeRecordSchema.parse({
      ...validRuntimeNode(),
      baseUrl: "https://user:password@runtime.internal",
    }),
  ).toThrow();
});
```

- [x] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm exec vitest run server/utils/gateway/storage/mysql-schema.test.ts server/utils/gateway/runtime-manager/runtime-node-types.test.ts
```

Expected: migration 16 and `runtimeNodeRecordSchema` are missing.

- [x] **Step 3: Add migration 16 and internal schemas**

Migration 16 creates this table:

```sql
CREATE TABLE IF NOT EXISTS runtime_nodes (
  id VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  base_url VARCHAR(2048) NOT NULL,
  encrypted_shared_secret LONGTEXT NOT NULL,
  config_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  scheduling_state VARCHAR(16) NOT NULL,
  capacity_cpu_millis INT UNSIGNED NOT NULL,
  capacity_memory_bytes BIGINT UNSIGNED NOT NULL,
  max_runtimes INT UNSIGNED NOT NULL,
  minimum_free_disk_bytes BIGINT UNSIGNED NOT NULL,
  last_seen_at VARCHAR(32) NULL,
  last_error VARCHAR(255) NULL,
  health_json LONGTEXT NULL,
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_runtime_nodes_name (name),
  UNIQUE KEY uq_runtime_nodes_base_url (base_url),
  CONSTRAINT chk_runtime_nodes_state CHECK (scheduling_state IN ('active', 'draining', 'disabled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin
```

The same migration adds nullable rollout columns and constraints:

```sql
ALTER TABLE user_agent_runtimes
  ADD COLUMN runtime_id VARCHAR(128) NULL,
  ADD COLUMN runtime_node_id VARCHAR(128) NULL,
  ADD COLUMN placement_generation INT UNSIGNED NULL,
  ADD COLUMN workspace_key VARCHAR(128) NULL,
  ADD COLUMN reserved_cpu_millis INT UNSIGNED NULL,
  ADD COLUMN reserved_memory_bytes BIGINT UNSIGNED NULL,
  ADD COLUMN reserved_pids INT UNSIGNED NULL,
  ADD UNIQUE KEY uq_user_agent_runtimes_runtime_id (runtime_id),
  ADD UNIQUE KEY uq_user_agent_runtimes_workspace_key (workspace_key),
  ADD KEY idx_user_agent_runtimes_node (runtime_node_id, user_id),
  ADD CONSTRAINT fk_user_agent_runtimes_runtime_node
    FOREIGN KEY (runtime_node_id) REFERENCES runtime_nodes(id)
```

- [x] **Step 4: Run schema and real MySQL migration tests**

```bash
pnpm exec vitest run server/utils/gateway/storage/mysql-schema.test.ts server/utils/gateway/storage/mysql-migrations.test.ts server/utils/gateway/runtime-manager/runtime-node-types.test.ts
```

Expected: migration version 16, 20 tables, and placement columns with the specified types.

- [x] **Step 5: Commit**

```bash
git add server/utils/gateway/storage/mysql-schema.ts server/utils/gateway/storage/mysql-schema.test.ts server/utils/gateway/storage/mysql-migrations.test.ts server/utils/gateway/runtime-manager/runtime-node-types.ts server/utils/gateway/runtime-manager/runtime-node-types.test.ts
git commit -m "feat(runtime): add node and placement schema"
```

---

### Task 2: Node Repository and Deterministic Scheduler

**Files:**
- Create: `server/utils/gateway/runtime-manager/runtime-node-store.ts`
- Test: `server/utils/gateway/runtime-manager/runtime-node-store.test.ts`
- Create: `server/utils/gateway/runtime-manager/runtime-node-scheduler.ts`
- Test: `server/utils/gateway/runtime-manager/runtime-node-scheduler.test.ts`
- Create: `server/utils/gateway/runtime-manager/runtime-placement-store.ts`
- Test: `server/utils/gateway/runtime-manager/runtime-placement-store.test.ts`

**Interfaces:**
- Produces `createRuntimeNodeStore(db)`, `scheduleRuntimeNode(input)`, and `createRuntimePlacementStore(db)`.
- `ensurePlacement(input)` returns the existing placement or atomically creates one under a serializable transaction.

- [x] **Step 1: Write scheduler tests**

```ts
it("chooses the node with the largest bottleneck capacity and a stable id tie-break", () => {
  expect(
    scheduleRuntimeNode({
      requested: { cpuMillis: 5_000, memoryBytes: 10 * GIB, pids: 256 },
      nodes: [node("node__b", 20_000, 64 * GIB, 10), node("node__a", 20_000, 64 * GIB, 10)],
      reservations: new Map(),
      nowMs: Date.parse("2026-09-08T00:00:00.000Z"),
      freshnessMs: 30_000,
    }),
  ).toMatchObject({ id: "node__a" });
});

it("does not select draining, stale, full, or disk-unsafe nodes", () => {
  expect(() => scheduleRuntimeNode(ineligibleFixture())).toThrow("runtime_node_capacity_unavailable");
});
```

- [x] **Step 2: Verify scheduler RED**

```bash
pnpm exec vitest run server/utils/gateway/runtime-manager/runtime-node-scheduler.test.ts
```

Expected: scheduler module is missing.

- [x] **Step 3: Implement deterministic scheduling**

```ts
export function scheduleRuntimeNode(input: ScheduleRuntimeNodeInput): RuntimeNodeRecord {
  const eligible = input.nodes
    .filter((node) => node.schedulingState === "active")
    .filter((node) => isFresh(node.lastSeenAt, input.nowMs, input.freshnessMs))
    .map((node) => scoreNode(node, input.reservations.get(node.id), input.requested))
    .filter((candidate): candidate is ScoredNode => candidate !== null)
    .sort((left, right) => right.bottleneck - left.bottleneck || left.node.id.localeCompare(right.node.id));
  const selected = eligible[0];
  if (selected === undefined) throw new RuntimePlacementError("runtime_node_capacity_unavailable");
  return selected.node;
}
```

- [x] **Step 4: Write concurrent placement tests against MySQL**

```ts
it("creates one placement for two concurrent first starts", async () => {
  const [left, right] = await Promise.all([
    store.ensurePlacement(requestFor(7)),
    store.ensurePlacement(requestFor(7)),
  ]);
  expect(left).toEqual(right);
  expect(await db.many("SELECT user_id FROM user_agent_runtimes WHERE user_id = ?", [7])).toHaveLength(1);
});
```

- [x] **Step 5: Implement repositories with `SELECT ... FOR UPDATE`**

`ensurePlacement` runs at serializable isolation, locks eligible node rows, aggregates existing reservations, calls `scheduleRuntimeNode`, and updates only a runtime row whose `runtime_node_id IS NULL`. A duplicate user race re-reads and returns the committed placement.

- [x] **Step 6: Run scheduler and repository tests**

```bash
pnpm exec vitest run server/utils/gateway/runtime-manager/runtime-node-store.test.ts server/utils/gateway/runtime-manager/runtime-node-scheduler.test.ts server/utils/gateway/runtime-manager/runtime-placement-store.test.ts
```

- [x] **Step 7: Commit**

```bash
git add server/utils/gateway/runtime-manager/runtime-node-store.ts server/utils/gateway/runtime-manager/runtime-node-store.test.ts server/utils/gateway/runtime-manager/runtime-node-scheduler.ts server/utils/gateway/runtime-manager/runtime-node-scheduler.test.ts server/utils/gateway/runtime-manager/runtime-placement-store.ts server/utils/gateway/runtime-manager/runtime-placement-store.test.ts
git commit -m "feat(runtime): schedule durable node placements"
```

---

### Task 3: Legacy Node Bootstrap and Client Registry

**Files:**
- Create: `server/utils/gateway/runtime-manager/runtime-node-bootstrap.ts`
- Test: `server/utils/gateway/runtime-manager/runtime-node-bootstrap.test.ts`
- Create: `server/utils/gateway/runtime-manager/runtime-node-client-registry.ts`
- Test: `server/utils/gateway/runtime-manager/runtime-node-client-registry.test.ts`
- Modify: `server/plugins/host-runtime-supervisor.ts`
- Modify: `.env.example`
- Modify: `docker-compose.yml`

**Interfaces:**
- Produces `bootstrapLegacyRuntimeNode()` and `RuntimeNodeClientRegistry.get(nodeId)`.
- Adds `RUNTIME_IDENTITY_SECRET`, `RUNTIME_MANAGER_DEFAULT_NODE_ID`, node capacity, health freshness, and insecure-test URL settings.

- [x] **Step 1: Write bootstrap tests**

```ts
it("creates node__default and backfills existing runtimes without changing runtime ids", async () => {
  await bootstrapLegacyRuntimeNode(fixture());
  expect(await nodeStore.get("node__default")).toMatchObject({ schedulingState: "active" });
  expect((await placementStore.getByUserId(7))?.runtimeId).toBe(existingRuntimeId);
});
```

- [x] **Step 2: Verify bootstrap RED**

```bash
pnpm exec vitest run server/utils/gateway/runtime-manager/runtime-node-bootstrap.test.ts
```

- [x] **Step 3: Implement idempotent startup bootstrap**

Bootstrap uses the legacy manager URL and secret only when no node record exists. It encrypts `{ secret }`, inserts `node__default`, and backfills existing runtime rows with the stable identity-derived runtime ID, generation `1`, an opaque random workspace key, and their currently effective resources.

- [x] **Step 4: Write client registry isolation tests**

```ts
it("keeps one client per node revision and invalidates only the changed node", async () => {
  const first = await registry.get("node__a");
  await nodeStore.bumpRevision("node__b");
  expect(await registry.get("node__a")).toBe(first);
  expect(await registry.get("node__b")).not.toBe(previousB);
});
```

- [x] **Step 5: Implement encrypted client lookup**

The registry reads the node record, decrypts the shared secret, validates the URL policy, constructs `RuntimeManagerClient`, and caches by `${node.id}:${node.configRevision}`. Errors expose only fixed codes.

- [x] **Step 6: Wire startup ordering**

`host-runtime-supervisor.ts` runs database verification, legacy node bootstrap, stored user bootstrap, then background supervisors. Add these defaults:

```dotenv
RUNTIME_IDENTITY_SECRET=
RUNTIME_MANAGER_DEFAULT_NODE_ID=node__default
RUNTIME_NODE_CAPACITY_CPU_MILLIS=16000
RUNTIME_NODE_CAPACITY_MEMORY_BYTES=68719476736
RUNTIME_NODE_MAX_RUNTIMES=30
RUNTIME_NODE_MINIMUM_FREE_DISK_BYTES=21474836480
RUNTIME_NODE_HEALTH_FRESHNESS_MS=30000
RUNTIME_NODE_ALLOW_INSECURE_HTTP=0
```

- [x] **Step 7: Run bootstrap, registry, startup, and type tests**

```bash
pnpm exec vitest run server/utils/gateway/runtime-manager/runtime-node-bootstrap.test.ts server/utils/gateway/runtime-manager/runtime-node-client-registry.test.ts server/plugins/host-runtime-supervisor.test.ts
pnpm typecheck
```

- [x] **Step 8: Commit**

```bash
git add server/utils/gateway/runtime-manager/runtime-node-bootstrap.ts server/utils/gateway/runtime-manager/runtime-node-bootstrap.test.ts server/utils/gateway/runtime-manager/runtime-node-client-registry.ts server/utils/gateway/runtime-manager/runtime-node-client-registry.test.ts server/plugins/host-runtime-supervisor.ts .env.example docker-compose.yml
git commit -m "feat(runtime): bootstrap runtime node registry"
```

---

### Task 4: Runtime Manager Node Health

**Files:**
- Modify: `packages/agent-runtime-manager/src/contracts.ts`
- Modify: `packages/agent-runtime-manager/src/docker-engine.ts`
- Modify: `packages/agent-runtime-manager/src/lifecycle-service.ts`
- Modify: `packages/agent-runtime-manager/src/http-server.ts`
- Test: `packages/agent-runtime-manager/src/lifecycle-service.test.ts`
- Modify: `server/utils/gateway/runtime-manager/client.ts`
- Test: `server/utils/gateway/runtime-manager/client.test.ts`
- Create: `server/utils/gateway/runtime-manager/runtime-node-health-monitor.ts`
- Test: `server/utils/gateway/runtime-manager/runtime-node-health-monitor.test.ts`

**Interfaces:**
- Runtime Manager serves signed `GET /v1/node/status`.
- Gateway client exposes `status(): Promise<RuntimeNodeHealth>`.

- [ ] **Step 1: Write failing Manager HTTP tests**

```ts
it("returns authenticated node identity, capacity, docker state, and disk state", async () => {
  const response = await signedFetch(server, "GET", "/v1/node/status");
  expect(await response.json()).toMatchObject({
    nodeId: "node__a",
    dockerAvailable: true,
    dataRootWritable: true,
    managedRuntimeCount: 2,
    runningRuntimeCount: 1,
  });
});
```

- [ ] **Step 2: Verify health tests RED**

```bash
pnpm --filter @codex-gateway/agent-runtime-manager test
```

- [ ] **Step 3: Add node status contract and Docker inspection**

`RUNTIME_NODE_ID` is required. The engine reports Docker ping, managed container counts, and `statfs` for `RUNTIME_NODE_DATA_ROOT` or `/data` during the routing milestone. Response validation rejects a mismatched node ID.

- [ ] **Step 4: Add Gateway health monitor**

The monitor probes every enabled node every 10 seconds, updates `last_seen_at`, `last_error`, and `health_json`, and never changes placements. It stops on Nitro close.

- [ ] **Step 5: Run Manager, client, and monitor tests**

```bash
pnpm --filter @codex-gateway/agent-runtime-manager test
pnpm exec vitest run server/utils/gateway/runtime-manager/client.test.ts server/utils/gateway/runtime-manager/runtime-node-health-monitor.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent-runtime-manager/src server/utils/gateway/runtime-manager/client.ts server/utils/gateway/runtime-manager/client.test.ts server/utils/gateway/runtime-manager/runtime-node-health-monitor.ts server/utils/gateway/runtime-manager/runtime-node-health-monitor.test.ts
git commit -m "feat(runtime): monitor runtime node health"
```

---

### Task 5: Placement Generation Enforcement

**Files:**
- Modify: `packages/agent-runtime-manager/src/contracts.ts`
- Modify: `packages/agent-runtime-manager/src/docker-engine.ts`
- Modify: `packages/agent-runtime-manager/src/lifecycle-service.ts`
- Test: `packages/agent-runtime-manager/src/lifecycle-service.test.ts`
- Modify: `server/utils/gateway/runtime-manager/client.ts`
- Modify: `server/utils/gateway/runtime-manager/runtime-service.ts`

**Interfaces:**
- Lifecycle requests include `nodeId`, `placementGeneration`, and `workspaceKey` for provision.
- Runtime Manager labels every container and volume with node ID and generation and rejects stale or conflicting identities.

- [ ] **Step 1: Write stale-generation tests**

```ts
it("rejects a lifecycle request older than the managed container generation", async () => {
  await service.provision(provisionRequest({ placementGeneration: 2 }));
  await expect(service.start(actionRequest({ placementGeneration: 1 }))).rejects.toMatchObject({
    code: "stale_placement_generation",
  });
});
```

- [ ] **Step 2: Verify generation RED**

```bash
pnpm --filter @codex-gateway/agent-runtime-manager test
```

- [ ] **Step 3: Add request fields and Docker labels**

Add labels:

```ts
nodeId: "com.codex-gateway.runtime-node-id",
placementGeneration: "com.codex-gateway.placement-generation",
workspaceKey: "com.codex-gateway.workspace-key",
```

Every inspect and mutation verifies exact runtime ID, user hash, node ID, runtime type, and generation. Multiple matching containers return `runtime_identity_conflict`.

- [ ] **Step 4: Pass placement identity from Gateway**

`ManagedRuntimeService.provisionRequest` receives the durable placement rather than deriving physical placement from environment. Runtime ID remains identity-secret-derived for existing rows and stored thereafter.

- [ ] **Step 5: Run package and Gateway runtime tests**

```bash
pnpm --filter @codex-gateway/agent-runtime-manager test
pnpm exec vitest run server/utils/gateway/runtime-manager/runtime-service.test.ts server/utils/gateway/runtime-manager/client.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent-runtime-manager/src server/utils/gateway/runtime-manager/client.ts server/utils/gateway/runtime-manager/runtime-service.ts server/utils/gateway/runtime-manager/runtime-service.test.ts
git commit -m "feat(runtime): enforce placement generations"
```

---

### Task 6: Signed App Server WebSocket Relay

**Files:**
- Modify: `packages/agent-runtime-manager/package.json`
- Create: `packages/agent-runtime-manager/src/rpc-relay.ts`
- Test: `packages/agent-runtime-manager/src/rpc-relay.test.ts`
- Modify: `packages/agent-runtime-manager/src/http-server.ts`
- Modify: `packages/agent-runtime-manager/src/docker-engine.ts`
- Modify: `docker-compose.yml`
- Modify: `server/utils/gateway/runtime-manager/client.ts`
- Modify: `server/utils/gateway/infra/rpc/managed-rpc-transport.ts`
- Test: `server/utils/gateway/infra/rpc/managed-rpc-transport.test.ts`

**Interfaces:**
- Manager accepts signed WebSocket upgrades at `/v1/runtimes/:runtimeId/generations/:generation/rpc`.
- `RuntimeManagerClient.relayTarget(placement)` returns a URL and a fresh signed-header factory.
- Gateway no longer receives the container service token or container DNS endpoint.

- [ ] **Step 1: Write relay integration tests**

```ts
it("relays frames to the local App Server without exposing its service token", async () => {
  const client = await connectSignedRelay(managerUrl, placement);
  client.send(JSON.stringify({ id: 1, method: "initialize", params: initializeParams }));
  expect(JSON.parse(await nextMessage(client))).toMatchObject({ id: 1, result: {} });
  expect(managerLifecycleResponse).not.toHaveProperty("serviceToken");
});
```

Also test invalid HMAC, replay nonce, wrong runtime ID, stale generation, and downstream close propagation.

- [ ] **Step 2: Verify relay RED**

```bash
pnpm --filter @codex-gateway/agent-runtime-manager test
pnpm exec vitest run server/utils/gateway/infra/rpc/managed-rpc-transport.test.ts
```

- [ ] **Step 3: Implement Manager relay**

Use the existing HMAC authenticator against the exact upgrade path and empty-body hash. Resolve the matching managed container, read its local service token from Docker inspection, connect to the container App Server, and forward binary/text frames bidirectionally with per-message compression disabled.

- [ ] **Step 4: Attach Runtime Manager to the Agent network**

```yaml
agent-runtime-manager:
  networks:
    - runtime-manager
    - agent-runtime
```

The Agent network remains internal. Manager port exposure remains limited to the configured private Runtime Manager endpoint.

- [ ] **Step 5: Replace direct managed transport endpoints**

`ManagedCodexRpcTransport.connect()` requests fresh signed relay headers on each connection attempt. It never connects to a container name and never receives `CODEX_REMOTE_TOKEN`.

- [ ] **Step 6: Run relay and current single-node RPC tests**

```bash
pnpm --filter @codex-gateway/agent-runtime-manager test
pnpm exec vitest run server/utils/gateway/infra/rpc/managed-rpc-transport.test.ts server/utils/gateway/runtime-manager/runtime-service.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add packages/agent-runtime-manager package.json pnpm-lock.yaml docker-compose.yml server/utils/gateway/runtime-manager/client.ts server/utils/gateway/infra/rpc/managed-rpc-transport.ts server/utils/gateway/infra/rpc/managed-rpc-transport.test.ts
git commit -m "feat(runtime): relay app server across runtime nodes"
```

---

### Task 7: Route All Runtime Operations by Placement

**Files:**
- Modify: `server/utils/gateway/runtime-manager/runtime-service.ts`
- Modify: `server/utils/gateway/runtime-manager/runtime-service.test.ts`
- Modify: `server/utils/gateway/runtime-manager/codex-runtime-driver.ts`
- Modify: `server/utils/gateway/runtime-manager/local-workspace.ts`
- Modify: `server/utils/gateway/host-metrics/manager.ts`
- Modify: `server/utils/gateway/capabilities/reconciler.ts`

**Interfaces:**
- Every operation loads the placement, obtains the placement node client, and uses the stored runtime ID/generation.
- First start creates the runtime record, atomically ensures placement, then provisions only on that node.

- [ ] **Step 1: Write routing tests with two manager clients**

```ts
it("keeps an existing user on node A after node B gains more capacity", async () => {
  await service.start(7);
  await nodeStore.updateCapacity("node__b", largerCapacity);
  await service.restart(7);
  expect(managerA.restart).toHaveBeenCalledOnce();
  expect(managerB.restart).not.toHaveBeenCalled();
});
```

```ts
it("marks the runtime degraded without provisioning on another node", async () => {
  managerA.restart.mockRejectedValueOnce(new Error("unavailable"));
  await expect(service.restart(7)).rejects.toMatchObject({ code: "runtime_node_unavailable" });
  expect(managerB.provision).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify routing RED**

```bash
pnpm exec vitest run server/utils/gateway/runtime-manager/runtime-service.test.ts
```

- [ ] **Step 3: Refactor service dependencies**

Replace the single `manager` option with:

```ts
placementStore: RuntimePlacementStorePort;
nodeClients: RuntimeNodeClientRegistryPort;
identitySecret: string;
```

All lifecycle, stats, exec, OAuth forwarding, capability sync, file access, tmux, and host construction use the same placement node.

- [ ] **Step 4: Preserve safe public DTOs**

Admin runtime views add only node display name and node health. Ordinary user views keep their existing shape and never expose node details.

- [ ] **Step 5: Run the complete Gateway runtime unit set**

```bash
pnpm exec vitest run server/utils/gateway/runtime-manager server/utils/gateway/runtime server/utils/gateway/capabilities
```

- [ ] **Step 6: Commit**

```bash
git add server/utils/gateway/runtime-manager server/utils/gateway/runtime server/utils/gateway/host-metrics server/utils/gateway/capabilities
git commit -m "feat(runtime): route users through node placement"
```

---

### Task 8: Runtime Node Administration

**Files:**
- Create: `server/api/admin/runtime-nodes/index.get.ts`
- Create: `server/api/admin/runtime-nodes/index.post.ts`
- Create: `server/api/admin/runtime-nodes/[nodeId].patch.ts`
- Create: `server/api/admin/runtime-nodes/[nodeId]/probe.post.ts`
- Test: `server/utils/gateway/runtime-manager/runtime-node-routes.test.ts`
- Create: `app/components/settings/RuntimeNodeSettings.vue`
- Modify: `app/components/settings/RuntimeSettingsTab.vue`
- Modify: `i18n/locales/zh-CN.json`
- Modify: `i18n/locales/en-US.json`

**Interfaces:**
- Admins can list, add, probe, rename, resize, drain, disable, and reactivate nodes.
- Create and update requests never accept encrypted values, container IDs, Docker paths, runtime IDs, or service tokens.

- [ ] **Step 1: Write authorization and redaction tests**

```ts
it("returns node capacity and health without base URL or encrypted secret", async () => {
  const result = await listRuntimeNodesForEvent(adminEvent(), service);
  expect(result[0]).toMatchObject({ id: "node__a", name: "Node A", state: "active" });
  expect(JSON.stringify(result)).not.toContain("https://runtime-a.internal");
  expect(JSON.stringify(result)).not.toContain("encrypted");
});
```

- [ ] **Step 2: Verify route RED**

```bash
pnpm exec vitest run server/utils/gateway/runtime-manager/runtime-node-routes.test.ts
```

- [ ] **Step 3: Implement fixed-action admin APIs**

Node creation validates URL policy, encrypts the secret, performs a signed status probe, verifies returned node ID, and only then inserts the node. A node with placements cannot be deleted; this milestone does not add delete.

- [ ] **Step 4: Add node cards to Runtime settings**

Display health, scheduling state, capacity, reservation, runtime count, disk free, version, last seen, and fixed actions. Secret input is write-only and never rendered after save.

- [ ] **Step 5: Run routes, component typecheck, i18n, and formatting**

```bash
pnpm exec vitest run server/utils/gateway/runtime-manager/runtime-node-routes.test.ts
pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add server/api/admin/runtime-nodes server/utils/gateway/runtime-manager/runtime-node-routes.test.ts app/components/settings/RuntimeNodeSettings.vue app/components/settings/RuntimeSettingsTab.vue i18n/locales/zh-CN.json i18n/locales/en-US.json
git commit -m "feat(ui): administer runtime nodes"
```

---

### Task 9: Two-Node Container E2E

**Files:**
- Modify: `tests/e2e/run-in-containers.sh`
- Modify: `tests/e2e/docker-environment.ts`
- Create: `tests/e2e/multi-runtime-nodes.spec.ts`
- Modify: `docker-compose.e2e.yml` if present; otherwise modify the E2E Compose generation inside `tests/e2e/run-in-containers.sh`.

**Interfaces:**
- E2E starts real MySQL, one Gateway, two independent Runtime Managers, and two Docker-isolated Agent networks.

- [ ] **Step 1: Write the failing two-node E2E**

The test registers node A and B with one runtime slot each, concurrently starts two new users, and asserts distinct node placements. It then restarts Gateway, reverses node list order, and verifies both users reopen their original threads through the relay.

- [ ] **Step 2: Add draining and failure cases**

Set node A draining, create a third user on B, fill B, and verify the next first start returns `runtime_node_capacity_unavailable`. Stop B and verify its existing user receives `runtime_node_unavailable` without any new container on A.

- [ ] **Step 3: Add protocol coverage through relay**

Exercise thread start/read, turn start/steer/interrupt, approval, workspace upload/read, tmux monitor, model request, MCP status, Gateway restart, and App Server reconnect for users on both nodes.

- [ ] **Step 4: Run full gates**

```bash
pnpm test:unit
pnpm lint
pnpm test:e2e
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add tests/e2e
git commit -m "test(e2e): verify two runtime nodes"
```

---

### Task 10: Single-Node Compatibility Release Gate

**Files:**
- Create: `docs/runbooks/runtime-node-routing-rollout.md`
- Modify: `.env.example`
- Modify: `docker-compose.yml`

**Interfaces:**
- Produces an exact migration, rollback, and second-node registration runbook.

- [ ] **Step 1: Document the current-node bootstrap commands**

The runbook records backup, migration 16, default node bootstrap, placement verification, relay smoke, and rollback commands. It explicitly forbids registering node B until every current user has node A placement and relay RPC succeeds.

- [ ] **Step 2: Verify a local production-shaped single-node deployment**

Use external MySQL and the existing Runtime Manager. Verify current runtime IDs, container IDs, named volumes, thread IDs, workspace files, model access, MCP access, tmux, upload, Gateway restart, and cold Gateway startup remain unchanged.

- [ ] **Step 3: Verify rollback boundary**

Before any node B placement exists, restore the pre-routing Gateway image while preserving migration 16 and default-node data. Confirm the old image remains blocked from production use if it cannot interpret placement-routed remote nodes.

- [ ] **Step 4: Commit the rollout gate**

```bash
git add docs/runbooks/runtime-node-routing-rollout.md .env.example docker-compose.yml
git commit -m "docs(runtime): add multi-node routing rollout"
```

---

## Plan Self-Review

- Spec coverage: node schema, health, deterministic placement, client isolation, generation fencing, relay, admin surface, single-node compatibility, and two-node E2E are covered.
- Deliberate boundary: node-local bind storage, named-volume migration, second production node deployment, and cold-standby failover remain milestones 3 and 4 as required by the approved spec. They start only after Task 10 passes on the current node.
- Placeholder scan: all tasks name concrete files, interfaces, test commands, expected failures, and commit boundaries.
- Type consistency: `RuntimeNodeRecord`, `RuntimePlacementRecord`, `RuntimeNodeClientRegistry`, placement generation, workspace key, and node ID use the same names across tasks.
