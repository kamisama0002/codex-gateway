# Gateway DataOps Form Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Gateway's DataOps environment configuration with a database-backed, administrator-approved pairing workflow that becomes active without process restart.

**Architecture:** Gateway stores versioned DataOps integration bindings and one-time pairing-code hashes in shared MySQL, encrypts shared secrets with the existing configuration cipher, and exposes code-protected pair plus secret-protected confirm/finalize/probe endpoints. A repository-backed provider replaces `dataOpsSsoClientFromEnvironment`; MySQL revision polling is the correctness fallback and Redis invalidation is the low-latency refresh path.

**Tech Stack:** Nuxt 4, TypeScript 6, Nitro/H3, MySQL 8.4, ioredis, Vue 3, Vitest, Playwright.

**Spec:** `D:/workspace/java/.worktrees/dinky-agent-platform-tenant-runtime-policy/docs/superpowers/specs/2026-09-08-agent-platform-form-pairing-design.md`

## Global Constraints

- Remove all production reads of `DATAOPS_BASE_URL` and `DATAOPS_SSO_SHARED_SECRET`.
- `CODEX_GATEWAY_CONFIG_SECRET` remains an infrastructure encryption root and must never be returned or moved into the form.
- Pairing codes have at least 128 bits of entropy, expire after 10 minutes, are single-use, and only their SHA-256 hashes are stored.
- Only a Gateway local administrator, defined as `role === "admin" && dataOps === undefined`, may generate or revoke pairing codes.
- Pending bindings do not enable DataOps login. Active bindings are the only normal login source; grace bindings are accepted only during an in-progress re-pair window.
- MySQL is authoritative across nodes. Redis invalidation may fail without making configuration incorrect; a revision/TTL reload must self-heal.
- No API, audit record, error, or log may include pairing-code plaintext or shared-secret plaintext.
- All new behavior follows RED → GREEN TDD and records failing and passing commands in the implementer report.

---

### Task 1: Add MySQL schema and encrypted integration repositories

**Files:**
- Modify: `server/utils/gateway/storage/mysql-schema.ts`
- Modify: `server/utils/gateway/storage/mysql-migrations.test.ts`
- Create: `server/utils/gateway/integrations/dataops-types.ts`
- Create: `server/utils/gateway/integrations/dataops-integration-repository.ts`
- Create: `server/utils/gateway/integrations/dataops-integration-repository.test.ts`
- Create: `server/utils/gateway/integrations/pairing-code-repository.ts`
- Create: `server/utils/gateway/integrations/pairing-code-repository.test.ts`

**Interfaces:**
- Add MySQL migration version `15` because `origin/dev` already contains versions 1–14.
- Produce `type DataOpsBindingStatus = "pending" | "active" | "grace" | "retired"`.
- Produce `DataOpsIntegrationRepository` methods `active()`, `acceptedForAuthentication()`, `pending(pairingId)`, `stage(input)`, `confirm(pairingId, revision, graceExpiresAt)`, and `finalize(pairingId, revision)`.
- Produce `PairingCodeRepository` methods `create(actorUserId, codeHash, expiresAt)`, `consume(codeHash, pairingId, now)`, `revokeActive(now)`, and `activeStatus(now)`.

- [ ] **Step 1: Write migration and repository tests**

Tests must use the repository's real MySQL test helper. Assert migration 15 creates `platform_integrations` and `integration_pairing_codes`, raw encrypted values exclude a fixture secret, one active plus one pending version can coexist, stale revisions fail, expired/reused pairing codes fail, and concurrent consume has one winner.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm test:unit -- server/utils/gateway/storage/mysql-migrations.test.ts server/utils/gateway/integrations/dataops-integration-repository.test.ts server/utils/gateway/integrations/pairing-code-repository.test.ts
```

Expected: FAIL because migration 10 and repository modules do not exist.

- [ ] **Step 3: Implement migration and repositories**

Use `encryptJson({ sharedSecret })` and `decryptJson`. Return public status DTOs without `encryptedSharedSecret`. Use MySQL transactions and row locks for consume/confirm/finalize transitions.

- [ ] **Step 4: Verify GREEN and commit**

Run the Step 2 command, then:

```bash
git add server/utils/gateway/storage server/utils/gateway/integrations
git commit -m "feat(integrations): persist DataOps pairing state"
```

### Task 2: Implement pairing, confirmation, finalization, and probes

**Files:**
- Create: `server/utils/gateway/integrations/dataops-pairing-service.ts`
- Create: `server/utils/gateway/integrations/dataops-pairing-service.test.ts`
- Modify: `server/utils/gateway/auth/context.ts`
- Modify: `server/utils/gateway/auth/context.test.ts`
- Create: `server/api/admin/integrations/dataops/index.get.ts`
- Create: `server/api/admin/integrations/dataops/pairing-codes.post.ts`
- Create: `server/api/admin/integrations/dataops/pairing-codes.delete.ts`
- Create: `server/api/integrations/dataops/pair.post.ts`
- Create: `server/api/integrations/dataops/pair/[pairingId]/confirm.post.ts`
- Create: `server/api/integrations/dataops/pair/[pairingId]/finalize.post.ts`
- Create: `server/api/integrations/dataops/probe.post.ts`
- Test: matching `*.test.ts` route tests beside the handlers.

**Interfaces:**
- `POST /api/admin/integrations/dataops/pairing-codes` returns `{ pairingCode, expiresAt }` exactly once.
- `POST /api/integrations/dataops/pair` accepts `{ pairingCode, pairingId, dataOpsBaseUrl, sharedSecret, revision }` and returns `{ pairingId, revision, status: "pending" }`.
- Confirm/finalize require `Authorization: Bearer <new shared secret>` and bodies `{ revision }`.
- `POST /api/integrations/dataops/probe` requires an accepted secret and returns `{ pairingId, revision, gateway: "ok", dataOps: "ok" | errorCode }` after calling Dinky's probe endpoint.

- [ ] **Step 1: Write failing service and route tests**

Cover local-admin-only code generation, DataOps-admin denial, code expiry/reuse, invalid URL, pending not accepted for login, confirm idempotency, grace acceptance, finalize retirement, rate-limit response, probe mismatch, and response/log secret redaction.

- [ ] **Step 2: Verify RED**

```bash
pnpm test:unit -- server/utils/gateway/auth/context.test.ts server/utils/gateway/integrations/dataops-pairing-service.test.ts server/api/admin/integrations/dataops server/api/integrations/dataops
```

- [ ] **Step 3: Implement minimal routes and state machine**

Add `requireLocalAdminUser(event)` to auth context. Use injectable clock, randomBytes source, fetch implementation, and rate limiter. Normalize URLs with the same strict origin rules used by `createDataOpsSsoClient`.

- [ ] **Step 4: Verify GREEN and commit**

Run Step 2 and commit:

```bash
git add server/api server/utils/gateway/auth server/utils/gateway/integrations
git commit -m "feat(integrations): add DataOps pairing protocol"
```

### Task 3: Replace environment-backed DataOps login and add multi-node refresh

**Files:**
- Modify: `server/utils/gateway/auth/dataops-client.ts`
- Modify: `server/utils/gateway/auth/dataops-client.test.ts`
- Modify: `server/api/auth/dataops.post.ts`
- Modify: `server/api/auth/dataops.post.test.ts`
- Create: `server/utils/gateway/integrations/dataops-integration-provider.ts`
- Create: `server/utils/gateway/integrations/dataops-integration-provider.test.ts`
- Create: `server/utils/gateway/integrations/dataops-invalidation.ts`
- Create: `server/utils/gateway/integrations/dataops-invalidation.test.ts`
- Create: `server/plugins/dataops-integration-refresh.ts`
- Modify: `package.json` and `pnpm-lock.yaml` to declare `ioredis` directly.

**Interfaces:**
- Produce singleton `dataOpsIntegrationProvider.current(): Promise<DataOpsIntegrationSnapshot | null>`.
- Provider caches for at most 5 seconds, compares repository revision, and exposes `invalidate(revision?: number)`.
- Redis channel is exactly `codex-gateway:dataops-integration:changed`; payload is `{ revision, pairingId }` and contains no secret.
- `loginWithDataOpsForEvent` receives a client created from the current accepted binding; unconfigured returns HTTP 503 `dataops_not_configured`.

- [ ] **Step 1: Write provider and login tests first**

Assert no environment variables are read, an active database binding permits exchange, pending-only returns 503, grace secrets remain accepted during deadline, invalidation refreshes immediately, and missing Redis still refreshes within 5 seconds.

- [ ] **Step 2: Verify RED**

```bash
pnpm test:unit -- server/utils/gateway/auth/dataops-client.test.ts server/api/auth/dataops.post.test.ts server/utils/gateway/integrations/dataops-integration-provider.test.ts server/utils/gateway/integrations/dataops-invalidation.test.ts
```

- [ ] **Step 3: Implement dynamic provider and invalidation**

Remove `dataOpsSsoClientFromEnvironment`. Redis connection failures must be logged without secrets and must not prevent MySQL-backed authentication after TTL reload.

- [ ] **Step 4: Verify GREEN and commit**

Run Step 2, then:

```bash
rg "DATAOPS_BASE_URL|DATAOPS_SSO_SHARED_SECRET|dataOpsSsoClientFromEnvironment" server app shared
git add package.json pnpm-lock.yaml server
git commit -m "feat(auth): load DataOps integration dynamically"
```

Expected search result: no production references; test fixture names may remain only when asserting removal.

### Task 4: Add the Gateway platform-integration settings panel

**Files:**
- Create: `app/components/settings/PlatformIntegrationSettingsTab.vue`
- Create: `app/components/settings/platform-integration-state.ts`
- Create: `app/components/settings/platform-integration-state.test.ts`
- Modify: `app/components/settings/SettingsPanel.vue`
- Modify: `app/utils/settings-access.ts`
- Modify: `app/utils/settings-access.test.ts`
- Modify: `i18n/locales/zh.json` and `i18n/locales/en.json` or the repository's actual locale files discovered before editing.
- Add Playwright coverage in the existing settings E2E spec closest to provider/runtime administration.

**Interfaces:**
- Add settings panel id `integrations`.
- Local admins can generate/revoke pairing codes; DataOps platform admins can read binding status but never see code controls.
- Pairing-code plaintext exists only in component memory until copied or the dialog closes.

- [ ] **Step 1: Write state/access tests and E2E assertions**

Cover unpaired, code-visible-once, countdown expiry, active status, degraded status, local-admin actions, DataOps-admin read-only state, ordinary-user absence, and code clearing on close.

- [ ] **Step 2: Verify RED**

```bash
pnpm test:unit -- app/components/settings/platform-integration-state.test.ts app/utils/settings-access.test.ts
```

- [ ] **Step 3: Implement the panel with existing shadcn-vue components**

Use existing Button, Input, Alert, Badge, Dialog, and copy-button patterns. Add Chinese and English strings. Do not expose a shared-secret input.

- [ ] **Step 4: Verify GREEN and commit**

```bash
pnpm test:unit -- app/components/settings/platform-integration-state.test.ts app/utils/settings-access.test.ts
pnpm lint
git add app i18n tests
git commit -m "feat(settings): add DataOps pairing administration"
```

### Task 5: Gateway subsystem verification

**Files:**
- Modify only failures caused by Tasks 1–4.

- [ ] **Step 1: Run all unit tests**

```bash
pnpm test:unit
```

- [ ] **Step 2: Run static checks and build**

```bash
pnpm lint
pnpm build
```

- [ ] **Step 3: Run containerized E2E**

```bash
pnpm test:e2e
```

- [ ] **Step 4: Verify scope**

```bash
git diff --check origin/dev..HEAD
git status --short
```

Expected: all checks pass and the worktree is clean. Preserve unrelated `docs/images/branding/` files in the older worktree; they must not appear in this branch.
