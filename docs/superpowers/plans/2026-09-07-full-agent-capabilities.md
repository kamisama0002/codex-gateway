# Full Agent Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a production-tested per-user Docker Agent runtime with the complete toolchain, persistent Codex configuration, egress, MCP/Skills/Plugins/Apps administration, browser/search, Memory, document/data tooling, and encrypted scoped credentials.

**Architecture:** The immutable `full` runtime image owns tools only; Gateway owns desired capabilities, assignments, encrypted credentials, reconciliation and audit; Runtime Manager owns a fixed container policy and receives resolved configuration over its authenticated internal API. Codex App Server remains the execution and capability runtime, while a shared SearXNG-backed MCP service supplies public search without mounting user data.

**Tech Stack:** Nuxt 4, TypeScript 6, Vue 3, Pinia, node:sqlite, Zod 4, Docker Engine/Docker Compose, Codex App Server 0.153.4, Model Context Protocol SDK, SearXNG, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-07-full-agent-capabilities-design.md`

## Global Constraints

- Pin Codex and the Gateway protocol baseline to exactly `0.153.4`.
- Keep one long-lived container, `/workspace` volume and `/codex-home` volume per user.
- Keep UID/GID `10001:10001`, read-only rootfs, `CapDrop: ALL`, `no-new-privileges`, no privileged mode, no host paths, no host network, no published Agent ports and no Docker Socket.
- The full test profile is 8 GiB memory, 4 CPUs, 1024 PIDs, 2 GiB `/tmp` and 1 GiB `/dev/shm`.
- Runtime containers join only fixed `agent-runtime` and `agent-egress` networks.
- Secret plaintext never enters database columns, browser DTOs, logs, labels, TOML, image layers or command arguments.
- Platform-managed capability names use the `org__` prefix and do not overwrite user-created configuration.
- Actual business MCP endpoints remain administrator data; deterministic real fixtures prove query and write behavior.
- Every production-code task follows red-green-refactor and ends in one focused commit.
- Existing long-lived Agent containers are not recreated until the rollout task explicitly upgrades them one at a time.

---

### Task 1: Pin Codex 0.153.4 and update the protocol contract

**Files:**
- Modify: `docker/agent-runtime.Dockerfile`
- Modify: `docker/agent-runtime-policy.json`
- Modify: `docker-compose.yml`
- Modify: `server/utils/gateway/infra/codex/codex-version.ts`
- Modify: `packages/agent-runtime-manager/src/image-policy.test.ts`
- Modify: `docs/app-server-interface-coverage.zh-CN.md`

**Interfaces:**
- Produces: `SUPPORTED_CODEX_VERSION = "0.153.4"` as the single Gateway version gate.
- Produces: Docker label `com.qiancheng.codex.version=0.153.4` and image alias metadata with the same version.

- [ ] **Step 1: Write the failing version policy assertions**

Update the image policy test to assert these literal values:

```ts
expect(policy.agent.labels["com.qiancheng.codex.version"]).toBe("0.153.4");
expect(readFileSync(dockerfilePath, "utf8")).toContain("@openai/codex@0.153.4");
expect(SUPPORTED_CODEX_VERSION).toBe("0.153.4");
```

- [ ] **Step 2: Run the focused tests and observe the old-version failures**

Run: `pnpm exec vitest run packages/agent-runtime-manager/src/image-policy.test.ts server/utils/gateway/infra/codex/codex-version.test.ts`

Expected: FAIL because production files still contain `0.151.0`.

- [ ] **Step 3: Update all runtime version gates**

Replace only the declared Codex version, image tag and policy label. Do not change application dependencies or unrelated image tags.

- [ ] **Step 4: Generate the 0.153.4 App Server schemas in an isolated container**

Run:

```bash
docker build -t codex-agent-runtime:0.153.4-protocol -f docker/agent-runtime.Dockerfile .
docker run --rm --entrypoint codex codex-agent-runtime:0.153.4-protocol app-server generate-json-schema --experimental --out /tmp/schema
```

Compare the generated client requests, server requests, notifications and v2 schemas with Gateway parsers. Add parser changes only for methods consumed in later tasks.

- [ ] **Step 5: Verify and commit**

Run the focused Vitest command again, then `pnpm typecheck` and `git diff --check`.

Commit: `build(runtime): upgrade Codex to 0.153.4`

---

### Task 2: Build the full runtime tool and browser image

**Files:**
- Modify: `docker/agent-runtime.Dockerfile`
- Create: `docker/agent-runtime-python-requirements.txt`
- Create: `docker/agent-runtime-node-tools.json`
- Create: `docker/agent-runtime-tool-manifest.json`
- Create: `scripts/smoke-agent-runtime.mjs`
- Modify: `packages/agent-runtime-manager/src/image-policy.test.ts`

**Interfaces:**
- Produces: Docker target `full` and command `node scripts/smoke-agent-runtime.mjs`.
- Produces: machine-readable manifest `{ command, versionCommand }[]` used by tests and runtime diagnostics.

- [ ] **Step 1: Add failing manifest and Dockerfile policy tests**

Assert representative commands from every required group:

```ts
expect(commandNames).toEqual(expect.arrayContaining([
  "git", "gh", "ssh", "curl", "jq", "rg", "python3", "uv", "node", "pnpm",
  "bun", "gcc", "clang", "cmake", "go", "cargo", "java", "mvn", "gradle",
  "sqlite3", "psql", "mysql", "redis-cli", "libreoffice", "pandoc", "pdftotext",
  "gs", "convert", "ffmpeg", "tesseract", "chromium", "playwright"
]));
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run packages/agent-runtime-manager/src/image-policy.test.ts`

Expected: FAIL because the full target and manifests do not exist.

- [ ] **Step 3: Add pinned package inputs and layered image stages**

Use Debian packages for system tools, Corepack for pnpm/Yarn, official pinned installers for Bun/uv/Rust, a pinned Go archive, pinned npm packages, and a committed Python requirements file. Cache apt, npm, uv/pip and Playwright downloads with BuildKit mounts. Keep all package installation before copying mutable application files.

- [ ] **Step 4: Implement the smoke script**

The script executes every manifest command, imports these Python modules, and exits nonzero on any missing capability:

```ts
const pythonImports = [
  "numpy", "pandas", "polars", "pyarrow", "scipy", "sklearn", "matplotlib",
  "seaborn", "requests", "httpx", "sqlalchemy", "openpyxl", "docx", "pptx",
  "pypdf", "pdfplumber", "PIL"
];
```

It also launches Chromium headless against a local HTML fixture and checks rendered text.

- [ ] **Step 5: Build once and run the smoke container on CentOS 10**

Build `codex-agent-runtime:0.153.4-full` on CentOS 10, record its immutable image digest, then run the smoke script with temporary volumes. Reuse this image digest in later tasks.

- [ ] **Step 6: Verify and commit**

Run the image policy test, manifest smoke, `pnpm typecheck` and `git diff --check`.

Commit: `feat(runtime): add full agent toolchain`

---

### Task 3: Preserve Codex config and enable Memory

**Files:**
- Modify: `docker/agent-runtime-entrypoint.sh`
- Create: `docker/agent-runtime-config.mjs`
- Modify: `packages/agent-runtime-manager/src/image-policy.test.ts`
- Create: `tests/unit/agent-runtime-config.test.ts`

**Interfaces:**
- Produces: `buildManagedCodexArgs(env): string[]`.
- Guarantees: `/codex-home/config.toml` is created only when absent; platform model and Feature settings are CLI overrides; secrets stay environment references.

- [ ] **Step 1: Write failing persistence and redaction tests**

Use a temporary `CODEX_HOME` containing a manual MCP entry, execute the entrypoint twice with a fake Codex binary, and assert:

```ts
expect(readFileSync(configPath, "utf8")).toContain("[mcp_servers.user_server]");
expect(capturedArgs).toContain('model_provider="codex_gateway"');
expect(capturedArgs).toContain("features.memory_tool=true");
expect(capturedArgs.join(" ")).not.toContain(providerToken);
```

The exact Memory feature key must come from the generated 0.153.4 config schema; the test literal and implementation must match that schema.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/unit/agent-runtime-config.test.ts packages/agent-runtime-manager/src/image-policy.test.ts`

Expected: FAIL because the current entrypoint overwrites `config.toml`.

- [ ] **Step 3: Implement structured managed arguments**

The Node helper validates provider ID, model, URL and Feature keys, serializes values as valid TOML literals, and emits one JSON array to the entrypoint. The shell script unsets `CODEX_REMOTE_TOKEN` before `exec codex` and never writes provider tokens.

- [ ] **Step 4: Verify restart persistence with temporary volumes**

Start, stop and start the same smoke container. Assert the manual MCP entry, Memory directory and an arbitrary user config key survive byte-for-byte.

- [ ] **Step 5: Verify and commit**

Run both focused tests, the entrypoint smoke, `pnpm typecheck` and `git diff --check`.

Commit: `fix(runtime): preserve Codex configuration`

---

### Task 4: Add fixed dual-network and 8 GiB runtime policy

**Files:**
- Modify: `packages/agent-runtime-manager/src/contracts.ts`
- Modify: `packages/agent-runtime-manager/src/docker-engine.ts`
- Modify: `packages/agent-runtime-manager/src/lifecycle-service.ts`
- Modify: `packages/agent-runtime-manager/src/http-server.ts`
- Modify: `packages/agent-runtime-manager/src/lifecycle-service.test.ts`
- Modify: `packages/agent-runtime-manager/src/image-policy.test.ts`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `docker/agent-runtime-policy.json`

**Interfaces:**
- Replaces: `networkName: string` with `networkNames: readonly [string, string]` in server policy.
- Produces: fixed networks `agent-runtime` and `agent-egress`.
- Produces: `DockerSecurityPolicy.Tmpfs` entries for `/tmp`, `/dev/shm` and `/run/codex-secrets`.

- [ ] **Step 1: Write failing container-spec tests**

Assert the created spec contains:

```ts
expect(spec.networkNames).toEqual(["agent-runtime", "agent-egress"]);
expect(spec.security).toMatchObject({
  Memory: 8 * 1024 ** 3,
  NanoCpus: 4_000_000_000,
  PidsLimit: 1024,
  Tmpfs: {
    "/tmp": "rw,nosuid,nodev,size=2147483648",
    "/dev/shm": "rw,nosuid,nodev,noexec,size=1073741824",
    "/run/codex-secrets": "rw,nosuid,nodev,noexec,size=16777216,mode=0700,uid=10001,gid=10001"
  }
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run packages/agent-runtime-manager/src/lifecycle-service.test.ts packages/agent-runtime-manager/src/image-policy.test.ts`

Expected: FAIL because policy currently supports one internal network and 2 GiB/2 CPU/256 PID limits.

- [ ] **Step 3: Implement strict server-owned policy**

Parse two network environment variables at Runtime Manager startup. Reject duplicates, `host`, `none`, empty names and any provision request containing network or security fields. Docker Engine sets the internal network as `NetworkMode` and includes both endpoint configs.

- [ ] **Step 4: Add Compose egress network**

Define `agent-egress` as a named non-internal bridge. Runtime Manager joins only its management network; it instructs Docker to join user containers to the two fixed Agent networks.

- [ ] **Step 5: Verify security invariants and commit**

Run focused tests, Runtime Manager typecheck and a temporary-container `docker inspect` assertion covering networks, mounts, ports, caps and tmpfs.

Commit: `feat(runtime): add egress and full resource policy`

---

### Task 5: Add the runtime-neutral capability catalog and assignments

**Files:**
- Modify: `server/utils/gateway/storage/migrations.ts`
- Create: `shared/types/capabilities.ts`
- Modify: `shared/types.ts`
- Create: `server/utils/gateway/capabilities/schemas.ts`
- Create: `server/utils/gateway/capabilities/store.ts`
- Create: `server/utils/gateway/capabilities/store.test.ts`
- Modify: `server/utils/gateway/audit/audit-store.ts`

**Interfaces:**
- Produces: `CapabilityKind = "skill" | "plugin" | "app" | "mcp" | "search"`.
- Produces: `CapabilityStore.create/update/delete/assign/unassign/listDesiredForContext`.
- Creates: `capability_definitions`, `capability_assignments`, `capability_artifacts`, `capability_syncs`.

- [ ] **Step 1: Write failing migration, CRUD and isolation tests**

Use literal desired-state fixtures and assert project grants do not leak across projects:

```ts
expect(store.listDesiredForContext({ userId: 7, projectId: 10 }).map(x => x.id)).toEqual([
  "org__revenue", "org__web_search"
]);
expect(store.listDesiredForContext({ userId: 7, projectId: 11 }).map(x => x.id)).toEqual([
  "org__web_search"
]);
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run server/utils/gateway/capabilities/store.test.ts server/utils/gateway/storage/migrations.test.ts`

Expected: FAIL because migration and capability store do not exist.

- [ ] **Step 3: Implement strict schemas and storage**

Store normalized non-secret configuration JSON, content hashes and audit-safe metadata. Reject capability IDs without `org__`, unsupported URLs, STDIO executables absent from the administrator allowlist, and assignment targets that do not exist.

- [ ] **Step 4: Verify and commit**

Run focused tests, `pnpm typecheck`, `pnpm exec oxlint server shared` and `git diff --check`.

Commit: `feat(capabilities): add catalog and assignments`

---

### Task 6: Implement the Codex capability adapter

**Files:**
- Create: `shared/runtime/app-server/capabilities.ts`
- Create: `server/utils/gateway/runtime/app-server-capabilities.ts`
- Create: `server/utils/gateway/runtime/app-server-capabilities.test.ts`
- Create: `server/utils/gateway/capabilities/codex-adapter.ts`
- Create: `server/utils/gateway/capabilities/codex-adapter.test.ts`
- Modify: `server/utils/gateway/runtime/broker.ts`

**Interfaces:**
- Produces: `CodexCapabilityAdapter.readActual(host, context): Promise<ActualCapabilityState>`.
- Produces: `planChanges(desired, actual): CapabilityChange[]` as a pure function.
- Produces: `applyChange(host, change): Promise<CapabilityChangeResult>`.
- Wraps: `skills/list`, `skills/extraRoots/set`, `skills/config/write`, `marketplace/*`, `plugin/list`, `plugin/install`, `plugin/uninstall`, `app/list`, `app/installed`, `config/mcpServer/reload`, `mcpServerStatus/list`.

- [ ] **Step 1: Write failing parser and exact-RPC mapping tests**

Each response parser uses `.strict()` and every mutating operation test asserts the exact App Server method and params. Also prove an unsupported method produces `unsupportedCapability` without attempting a fallback shell command.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run server/utils/gateway/runtime/app-server-capabilities.test.ts server/utils/gateway/capabilities/codex-adapter.test.ts`

Expected: FAIL because the adapter and protocol parsers do not exist.

- [ ] **Step 3: Implement actual-state reads and deterministic planning**

Normalize App Server data into sorted IDs. A repeated desired/actual input returns an empty plan. Skill files are written only under `/codex-home/skills/org__*`; MCP config edits touch only `mcp_servers.org__*` and use structured TOML parsing.

- [ ] **Step 4: Implement one-change execution**

Execute one typed change, then return `{ capabilityId, operation, status, safeMessage }`. Never loop inside `applyChange`; orchestration belongs to Task 7.

- [ ] **Step 5: Verify and commit**

Run both focused test files, `pnpm typecheck` and `git diff --check`.

Commit: `feat(capabilities): add Codex runtime adapter`

---

### Task 7: Reconcile capabilities into each user runtime

**Files:**
- Create: `server/utils/gateway/capabilities/reconciler.ts`
- Create: `server/utils/gateway/capabilities/reconciler.test.ts`
- Create: `server/utils/gateway/capabilities/sync-store.ts`
- Modify: `server/utils/gateway/runtime-manager/runtime-service.ts`
- Create: `server/api/admin/runtime-syncs/index.get.ts`
- Create: `server/api/admin/runtime-syncs/[userId].post.ts`

**Interfaces:**
- Produces: `reconcileUserRuntime(input: { userId: number; projectId: number | null; reason: SyncReason }): Promise<CapabilitySyncResult>`.
- Consumes: Task 5 desired state and Task 6 Codex Adapter.

- [ ] **Step 1: Write failing idempotency, serialization and user-isolation tests**

Run two concurrent reconciliations for one user and one for another. Assert one user lock, one application of each change, independent results, and no repeated calls after the desired hash matches the actual hash.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run server/utils/gateway/capabilities/reconciler.test.ts`

Expected: FAIL because reconciler and sync store do not exist.

- [ ] **Step 3: Implement reconcile lifecycle**

Read desired, read actual, hash canonical JSON, plan, apply sequentially, reread and persist. Initial Runtime readiness waits for successful mandatory capability sync; optional capability failure leaves the Runtime usable with a per-item error.

- [ ] **Step 4: Hook all synchronization triggers**

Trigger on Runtime start/restart/upgrade, assignment mutation, credential rotation and administrator retry. Bind every background callback with the existing user context helper.

- [ ] **Step 5: Verify and commit**

Run capability and Runtime Manager focused tests, then `pnpm typecheck` and `git diff --check`.

Commit: `feat(capabilities): reconcile user runtimes`

---

### Task 8: Add encrypted scoped credentials and Runtime injection

**Files:**
- Modify: `server/utils/gateway/storage/migrations.ts`
- Create: `shared/types/credentials.ts`
- Create: `server/utils/gateway/credentials/schemas.ts`
- Create: `server/utils/gateway/credentials/store.ts`
- Create: `server/utils/gateway/credentials/store.test.ts`
- Create: `server/utils/gateway/credentials/resolver.ts`
- Create: `server/utils/gateway/credentials/resolver.test.ts`
- Modify: `packages/agent-runtime-manager/src/contracts.ts`
- Modify: `packages/agent-runtime-manager/src/lifecycle-service.ts`
- Modify: `packages/agent-runtime-manager/src/docker-engine.ts`
- Modify: `server/utils/gateway/runtime-manager/client.ts`
- Modify: `server/utils/gateway/runtime-manager/runtime-service.ts`

**Interfaces:**
- Produces: `CredentialKind = "token" | "username_password" | "ssh_private_key" | "oauth" | "external_issuer"`.
- Produces: `CredentialResolver.resolveForRuntime(context): ResolvedRuntimeSecret[]`.
- Extends: `ProvisionRuntimeRequest.runtimeSecrets` with discriminated `env` and `file` targets.

- [ ] **Step 1: Write failing encryption, expiry and scope tests**

Assert database text does not contain any plaintext fixture, cross-user/project resolution returns 404, expired/revoked rows never resolve, env names match `^[A-Z][A-Z0-9_]{0,127}$`, and file targets remain directly below `/run/codex-secrets`.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run server/utils/gateway/credentials server/utils/gateway/storage/migrations.test.ts packages/agent-runtime-manager/src/lifecycle-service.test.ts`

Expected: FAIL because credential tables, resolver and Runtime request fields do not exist.

- [ ] **Step 3: Implement encrypted storage and resolution**

Use existing `encryptJson/decryptJson`, bind associated metadata in the encrypted object, store only redacted descriptors outside ciphertext, and zero temporary Buffers after request construction where Node permits.

- [ ] **Step 4: Inject secrets without persistence**

Runtime Manager validates targets and starts the container with an entrypoint waiting on
`/run/codex-secrets/.ready`. It then uses Docker `putArchive` to place a mode-`0600` secret bundle and
an environment mapping manifest in the tmpfs. The launcher reads that manifest, supplies the mapped
environment only to the Codex child process, removes the bundle and starts App Server. Docker inspect
tests assert exact Secret fixtures are absent from container environment, labels, mounts, command and
healthcheck; log tests scan the same exact fixtures.

- [ ] **Step 5: Reconcile rotations safely**

File secret changes use an authenticated Runtime Manager sync endpoint plus atomic rename. Environment changes recreate only the target user container after preserving volumes; readiness failure retains the previous usable container until rollback completes.

- [ ] **Step 6: Verify and commit**

Run credential, Runtime Manager and redaction tests, `pnpm typecheck` and `git diff --check`.

Commit: `feat(credentials): inject scoped runtime secrets`

---

### Task 9: Add MCP OAuth and external short-token issuers

**Files:**
- Create: `server/utils/gateway/credentials/oauth-store.ts`
- Create: `server/utils/gateway/credentials/oauth-service.ts`
- Create: `server/utils/gateway/credentials/oauth-service.test.ts`
- Create: `server/utils/gateway/credentials/external-issuer.ts`
- Create: `server/utils/gateway/credentials/external-issuer.test.ts`
- Create: `server/api/capabilities/mcp/[id]/oauth/start.post.ts`
- Create: `server/api/capabilities/mcp/oauth/callback.get.ts`
- Create: `server/api/capabilities/mcp/[id]/oauth/revoke.post.ts`
- Modify: `server/utils/gateway/runtime/app-server-capabilities.ts`

**Interfaces:**
- Produces: one-time OAuth state bound to user, Runtime, project and MCP ID.
- Produces: `ExternalCredentialIssuer.issue(definition, context): Promise<IssuedCredential>`.
- Wraps: `mcpServer/oauth/login` and `config/mcpServer/reload`.

- [ ] **Step 1: Write failing replay, cross-user, expiration and issuer tests**

Assert OAuth state is stored only as a hash, expires after ten minutes, is consumed once, and cannot be completed by another user. The issuer allows only administrator-configured HTTPS origins, enforces timeout and response size, and rejects credentials already near expiration.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run server/utils/gateway/credentials/oauth-service.test.ts server/utils/gateway/credentials/external-issuer.test.ts`

Expected: FAIL because services and routes do not exist.

- [ ] **Step 3: Implement OAuth and issuer flows**

Encrypt token responses through Task 8, never reflect tokens to the browser, redirect callbacks to a fixed local capability page, and trigger Task 7 reconciliation after login, refresh or revoke.

- [ ] **Step 4: Verify and commit**

Run focused tests, `pnpm typecheck`, route authorization tests and `git diff --check`.

Commit: `feat(credentials): add MCP OAuth and token issuers`

---

### Task 10: Provide working search MCP and business MCP fixtures

**Files:**
- Create: `packages/search-mcp/package.json`
- Create: `packages/search-mcp/tsconfig.json`
- Create: `packages/search-mcp/src/server.ts`
- Create: `packages/search-mcp/src/search-provider.ts`
- Create: `packages/search-mcp/src/url-policy.ts`
- Create: `packages/search-mcp/src/server.test.ts`
- Create: `packages/test-business-mcp/package.json`
- Create: `packages/test-business-mcp/src/server.ts`
- Create: `packages/test-business-mcp/src/server.test.ts`
- Create: `docker/search-mcp.Dockerfile`
- Create: `docker/searxng/settings.yml`
- Modify: `docker-compose.yml`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Search tools: `web_search({ query, limit })` and `web_fetch({ url })`.
- Test business tools: `revenue_query({ projectId, from, to })` and `revenue_adjustment_write({ projectId, idempotencyKey, amount, reason })`.

- [ ] **Step 1: Write failing MCP protocol and SSRF tests**

Use the official MCP SDK client. Assert tool schemas and literal fixture results, private/link-local/loopback fetch rejection, redirect revalidation, response byte cap, timeout, per-user rate limit and no user workspace mounts.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @codex-gateway/search-mcp test && pnpm --filter @codex-gateway/test-business-mcp test`

Expected: FAIL because packages do not exist.

- [ ] **Step 3: Implement SearXNG-backed search and safe fetch**

Query the internal SearXNG JSON API with bounded result count. Resolve DNS and reject non-public addresses before every outbound request and redirect. Return titles, URLs and snippets only; fetch returns bounded readable text with source URL and content type.

- [ ] **Step 4: Implement deterministic business MCP**

Keep state in a fixture-only temp directory. Query returns literal revenue rows; write requires a non-empty idempotency key and returns the same result for a repeated key. Mark the write Tool with the SDK's destructive/write hints so Codex requests approval.

- [ ] **Step 5: Add Compose services and default search capability seed**

SearXNG and Search MCP join `agent-egress` and `agent-runtime`, expose no host port and mount no Gateway/user data. Seed `org__web_search` as enabled and globally assigned; seed the business fixture only under test configuration.

- [ ] **Step 6: Verify and commit**

Run package tests, Compose config validation, a real public search smoke and `git diff --check`.

Commit: `feat(mcp): add web search and business fixtures`

---

### Task 11: Add capability and credential administration UI

**Files:**
- Create: `server/api/capabilities/index.get.ts`
- Create: `server/api/admin/capabilities/index.get.ts`
- Create: `server/api/admin/capabilities/index.post.ts`
- Create: `server/api/admin/capabilities/[id].patch.ts`
- Create: `server/api/admin/capabilities/[id].delete.ts`
- Create: `server/api/admin/capabilities/[id]/assignments.post.ts`
- Create: `server/api/admin/credentials/index.post.ts`
- Create: `server/api/admin/credentials/[id].patch.ts`
- Create: `server/api/admin/credentials/[id].delete.ts`
- Create: `app/stores/gateway-capabilities/index.ts`
- Create: `app/components/settings/CapabilitySettingsTab.vue`
- Create: `app/components/settings/capabilities/CapabilityCatalog.vue`
- Create: `app/components/settings/capabilities/CapabilityEditor.vue`
- Create: `app/components/settings/capabilities/CredentialEditor.vue`
- Modify: `app/components/settings/settings-dock/types.ts`
- Modify: `app/components/settings/settings-dock/panel-registry.ts`
- Modify: `app/components/settings/settings-dock/useSettingsDock.ts`
- Modify: `i18n/locales/zh-CN.json`
- Modify: `i18n/locales/en.json`
- Create: `tests/e2e/capability-administration.spec.ts`

**Interfaces:**
- Produces: fixed administrator CRUD and assignment APIs; no route accepts raw RPC methods, Docker fields or container IDs.
- Produces: user catalog DTO with desired, actual, sync and auth status but no Secret values.

- [ ] **Step 1: Write failing API permission and browser-flow E2E**

Assert ordinary users cannot enumerate unassigned capabilities or mutate anything. Assert an admin creates a Skill and MCP, assigns them to one user/project, attaches a credential, triggers sync, and sees actual state become ready; another user sees none of them.

- [ ] **Step 2: Verify RED**

Run the repository container E2E with only `capability-administration.spec.ts` selected through its supported focus mechanism.

Expected: FAIL because routes, store and settings panel do not exist.

- [ ] **Step 3: Implement fixed APIs and stores**

Every mutation validates a discriminated schema and records actor, subject, capability, outcome and safe metadata. Credential responses contain only ID, kind, scope, expiry, version and presence flags.

- [ ] **Step 4: Implement the bilingual settings panel**

Reuse existing Settings Dock and shadcn-vue components. Use tabs for Skills/Plugins/Apps/MCP/Search, switches for enabled state, menus for assignments and dialogs for credentials. Keep visible text in both locale files and keep each component focused.

- [ ] **Step 5: Verify and commit**

Run focused unit/E2E, desktop/mobile screenshots, `pnpm lint` and `git diff --check`.

Commit: `feat(ui): administer agent capabilities`

---

### Task 12: Run full container E2E and migrate CentOS 10 users

**Files:**
- Create: `tests/e2e/full-agent-runtime.spec.ts`
- Modify: `tests/e2e/docker-compose.yml`
- Modify: `docs/app-server-interface-coverage.zh-CN.md`
- Modify: `README.zh-CN.md`
- Modify: `README.md`
- Update outside repository: `C:/Users/56870/Documents/ChatGPT/新的方案/ENVIRONMENT.md`

**Interfaces:**
- Produces: one reproducible command that validates the immutable full image digest and all declared runtime capabilities.
- Produces: documented rollback image alias and per-user upgrade record.

- [ ] **Step 1: Write the end-to-end acceptance test**

The test provisions two real users and proves container/volume/credential isolation; runs the tool manifest; verifies egress, Chromium, document conversion, OCR and Python data analysis; asserts `codex mcp list` includes search and assigned business fixture; executes query and approved write; installs/discovers an organization Skill and test Plugin/App; verifies Memory/config across stop/start; runs a real model Turn; and scans logs/results for every exact Secret fixture.

- [ ] **Step 2: Run focused E2E against the already-built image digest**

Run `full-agent-runtime.spec.ts` using the repository container runner without rebuilding the image. Fix product failures task-by-task; do not weaken assertions or substitute fake App Server state.

- [ ] **Step 3: Run final repository verification**

Run:

```text
pnpm lint
pnpm test:unit
pnpm test:e2e
git diff --check
```

All commands must exit 0. Record any environment-only retry with the corresponding logs and final clean run.

- [ ] **Step 4: Deploy compatible services without touching existing Agents**

Push the task commits to `dev`, deploy Search MCP/SearXNG, Gateway and Runtime Manager, and confirm all existing Agent container IDs remain unchanged. Verify Gateway, Runtime Manager, search and existing Agent health.

- [ ] **Step 5: Upgrade users one at a time**

Upgrade the designated test user to the immutable `full` digest, validate both persistent volumes and all acceptance checks, then repeat for each remaining user only after the previous user is healthy. Never delete old volumes. Keep the prior image alias and per-file deployment backup until all users pass.

- [ ] **Step 6: Update documentation and commit**

Update interface coverage, operator instructions, exact deployed commit/digest, resource limits, service URLs and rollback commands.

Commit: `test(runtime): verify full agent capabilities`
