# Gateway Dinky MCP Long-Lived Token Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically expose Dinky's hosted MCP to paired DataOps users and securely inject each user's existing long-lived Dinky Token into only that user's managed Runtime.

**Architecture:** Gateway owns a protected system capability `org__dinky_mcp`, renders Codex HTTP MCP authentication through environment-variable references, and accepts user credential updates only from the paired Dinky service. Credential updates create a user-scoped assignment, encrypt `{ token, tenantId }`, and reuse Runtime Manager secret sync plus App Server MCP reload.

**Tech Stack:** Nuxt 4, TypeScript 6, Nitro/H3, MySQL 8.4, Zod, Vitest, Playwright, Codex App Server.

**Spec:** `D:/workspace/java/.worktrees/dinky-agent-platform-tenant-runtime-policy/docs/superpowers/specs/2026-09-08-dinky-mcp-long-lived-token-binding-design.md`

## Global Constraints

- Capability ID is exactly `org__dinky_mcp`; credential ID is exactly `cred__dinky_mcp_<gatewayUserId>`.
- Users never submit a Gateway user ID, tenant ID, MCP URL, environment target, or command.
- Dinky service requests authenticate with an accepted paired secret and matching pairingId/revision.
- Token plaintext never appears in responses, logs, audit metadata, `config.toml`, snapshots, or browser storage.
- Codex config references `INFINITY_USER_TOKEN` and `INFINITY_TENANT_ID`; secrets are delivered only through Runtime Manager secret sync.
- The system capability cannot be edited, disabled, or deleted through generic capability administration.
- Every behavior follows RED → GREEN TDD and records commands/results in the task report.

---

### Task 1: Render authenticated HTTP MCP configuration

**Files:**
- Modify: `shared/types/capabilities.ts`
- Modify: `server/utils/gateway/capabilities/schemas.ts`
- Modify: `server/utils/gateway/capabilities/codex-adapter.ts`
- Modify: `server/utils/gateway/capabilities/codex-adapter.test.ts`
- Modify: `server/utils/gateway/capabilities/store.test.ts`

**Interfaces:**
- Extend `HttpMcpCapabilityConfig` with `bearerTokenEnvVar?: string` and `envHttpHeaders?: Record<string, string>`.
- Normalize environment variable names with `^[A-Z][A-Z0-9_]{0,127}$`.
- `desiredMcpConfig()` must render `{ url, bearer_token_env_var, env_http_headers }`.
- `normalizeActualMcpConfig()` must preserve the same fields so reconciliation converges.

- [ ] **Step 1: Add failing schema and adapter tests**

```ts
expect(parseCapabilityCreateInput({
  id: "org__dinky_mcp",
  kind: "mcp",
  displayName: "Dinky Business MCP",
  description: "Dinky hosted MCP",
  version: "1.0.0",
  source: { type: "internal", locator: "dataops-dinky-mcp" },
  sensitiveFields: ["INFINITY_USER_TOKEN", "INFINITY_TENANT_ID"],
  enabled: true,
  createdByUserId: null,
  config: {
    transport: "streamable_http",
    url: "https://dinky.example.test/api/infinity/mcp/transport",
    bearerTokenEnvVar: "INFINITY_USER_TOKEN",
    envHttpHeaders: { "X-INFINITY-TENANT-ID": "INFINITY_TENANT_ID" },
  },
})).toMatchObject({ kind: "mcp" });
```

Assert adapter writes snake_case App Server config and reading that config produces no repeat change.

- [ ] **Step 2: Verify RED**

```bash
corepack pnpm@11.17.0 exec vitest run server/utils/gateway/capabilities/codex-adapter.test.ts server/utils/gateway/capabilities/store.test.ts
```

Expected: FAIL because authenticated HTTP MCP fields are rejected or stripped.

- [ ] **Step 3: Implement normalized authenticated MCP fields**

Reject header names containing control characters and reject auth fields on STDIO MCP definitions. Keep URL policy unchanged.

- [ ] **Step 4: Verify GREEN and commit**

```bash
corepack pnpm@11.17.0 exec vitest run server/utils/gateway/capabilities/codex-adapter.test.ts server/utils/gateway/capabilities/store.test.ts
git diff --check
git add shared/types/capabilities.ts server/utils/gateway/capabilities
git commit -m "feat(mcp): render authenticated HTTP capabilities"
```

### Task 2: Maintain the protected Dinky MCP system capability

**Files:**
- Create: `server/utils/gateway/integrations/dataops-mcp-capability.ts`
- Create: `server/utils/gateway/integrations/dataops-mcp-capability.test.ts`
- Modify: `server/utils/gateway/integrations/dataops-pairing-service.ts`
- Modify: `server/utils/gateway/integrations/dataops-pairing-service.test.ts`
- Modify: `server/utils/gateway/capabilities/administration.ts`
- Modify: `server/utils/gateway/capabilities/administration.test.ts`
- Modify: `app/components/settings/capabilities/CapabilityCatalog.vue`

**Interfaces:**
- Export `DINKY_MCP_CAPABILITY_ID = "org__dinky_mcp"`.
- Export `ensureDinkyMcpCapability(binding: DataOpsIntegrationSnapshot): Promise<CapabilityDefinition>`.
- URL is `new URL("/api/infinity/mcp/transport", binding.dataOpsBaseUrl).toString()` without credentials/query/fragment.
- Confirm/finalize invoke the ensure service after MySQL activation; failures mark integration degraded but never leak the secret.

- [ ] **Step 1: Write failing lifecycle/protection tests**

```ts
it("upserts the protected Dinky MCP capability from the active binding", async () => {
  const result = await service.ensure(activeBinding("https://dinky.example.test"));
  expect(result).toMatchObject({
    id: "org__dinky_mcp",
    config: { url: "https://dinky.example.test/api/infinity/mcp/transport" },
  });
});
```

Assert repeat calls are idempotent, a re-pair updates only the URL/versioned definition, and generic patch/delete/toggle attempts return a stable `system_capability_read_only` error.

- [ ] **Step 2: Verify RED**

```bash
corepack pnpm@11.17.0 exec vitest run server/utils/gateway/integrations/dataops-mcp-capability.test.ts server/utils/gateway/integrations/dataops-pairing-service.test.ts server/utils/gateway/capabilities/administration.test.ts
```

- [ ] **Step 3: Implement system capability upsert and guards**

Use the existing capability store; do not add a second capability table. The catalog may display the system capability but must suppress edit/delete/toggle controls.

- [ ] **Step 4: Verify GREEN and commit**

```bash
corepack pnpm@11.17.0 exec vitest run server/utils/gateway/integrations/dataops-mcp-capability.test.ts server/utils/gateway/integrations/dataops-pairing-service.test.ts server/utils/gateway/capabilities/administration.test.ts
git add server/utils/gateway/integrations server/utils/gateway/capabilities app/components/settings/capabilities
git commit -m "feat(mcp): maintain paired Dinky capability"
```

### Task 3: Add paired user credential binding and Runtime synchronization

**Files:**
- Create: `server/utils/gateway/integrations/dataops-mcp-credential-service.ts`
- Create: `server/utils/gateway/integrations/dataops-mcp-credential-service.test.ts`
- Create: `server/api/integrations/dataops/mcp-credentials.put.ts`
- Create: `server/api/integrations/dataops/mcp-credentials.delete.ts`
- Create: `server/api/integrations/dataops/mcp-credentials/probe.post.ts`
- Test: matching route tests
- Modify: `server/utils/gateway/credentials/store.ts`
- Modify: `server/utils/gateway/credentials/store.test.ts`
- Modify: `server/utils/gateway/capabilities/store.ts`
- Modify: `server/utils/gateway/runtime-manager/runtime-service.ts`

**Interfaces:**
- PUT body: `{ pairingId, revision, tenantId, dataOpsUserId, token }`.
- DELETE/probe body: `{ pairingId, revision, tenantId, dataOpsUserId }`.
- Target Gateway user is resolved by stored DataOps identity; no Gateway user ID is accepted.
- Produce statuses `unbound | pending_sync | ready | runtime_not_ready | sync_failed`.
- Credential secret is `{ token: string, tenantId: string }` with mappings to `INFINITY_USER_TOKEN` and `INFINITY_TENANT_ID`.

- [ ] **Step 1: Add failing service and route tests**

```ts
await expect(service.bind({
  pairingId: "pair-1",
  revision: 1,
  tenantId: 7,
  dataOpsUserId: 42,
  token: "long-lived-dinky-token",
})).resolves.toMatchObject({ status: "ready" });
expect(JSON.stringify(publicResult)).not.toContain("long-lived-dinky-token");
```

Cover wrong secret/revision/tenant, unknown DataOps user, deterministic encrypted upsert, duplicate binding version increment, Runtime absent, READY dynamic sync, revoke/remove assignment, and secret redaction.

- [ ] **Step 2: Verify RED**

```bash
corepack pnpm@11.17.0 exec vitest run server/utils/gateway/integrations/dataops-mcp-credential-service.test.ts server/utils/gateway/credentials/store.test.ts server/api/integrations/dataops/mcp-credentials
```

- [ ] **Step 3: Implement service-authenticated binding**

Reuse accepted DataOps binding authentication and `ManagedRuntimeService.syncSecrets`. If Runtime is absent, persist assignment/credential and return `runtime_not_ready`; next provision resolves the same credential automatically.

- [ ] **Step 4: Verify GREEN and commit**

```bash
corepack pnpm@11.17.0 exec vitest run server/utils/gateway/integrations/dataops-mcp-credential-service.test.ts server/utils/gateway/credentials/store.test.ts server/api/integrations/dataops/mcp-credentials
git add server/api/integrations/dataops server/utils/gateway
git commit -m "feat(mcp): bind Dinky user credentials"
```

### Task 4: Gateway verification

**Files:** Modify only defects introduced by Tasks 1–3.

- [ ] **Step 1: Run unit/static/build checks**

```bash
corepack pnpm@11.17.0 test:unit
corepack pnpm@11.17.0 lint
corepack pnpm@11.17.0 build
```

- [ ] **Step 2: Run container E2E on CentOS**

```bash
corepack pnpm@11.17.0 test:e2e
```

- [ ] **Step 3: Verify secret and scope rules**

```bash
rg "long-lived-dinky-token|INFINITY_USER_TOKEN\s*=|DINKY_CODEX_GATEWAY_" app server shared packages
git diff --check origin/dev..HEAD
git status --short
```

Expected: fixture secrets occur only in tests, no plaintext config assignment exists, and the worktree is clean.
