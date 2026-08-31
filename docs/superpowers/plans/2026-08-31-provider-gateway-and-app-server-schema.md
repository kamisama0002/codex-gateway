# Provider Gateway and App Server Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an administrator-managed, tenant-aware model gateway for Responses and Chat Completions providers, plus generated App Server contracts and compatibility gates tied to the pinned Codex image.

**Architecture:** App Server containers always call an internal Responses endpoint with a short-lived user Runtime token. Provider definitions and real API keys remain in Gateway SQLite; Responses providers are streamed through, while Chat Completions providers use pure bidirectional adapters with full streaming tool-call reconstruction. Build-time generated TypeScript/JSON Schema artifacts define the supported App Server contract, and runtime initialization requires exact version/schema compatibility.

**Tech Stack:** Nuxt 4/Nitro, TypeScript 6, Node fetch/Web Streams, node:sqlite, Zod 4, Vitest, Docker, official `@openai/codex@0.151.0` schema generators, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-31-dual-runtime-agent-platform-design.md`

## Global Constraints

- Provider credentials are administrator-owned and encrypted; ordinary users cannot read or set them.
- The browser never calls the internal Provider Proxy route and never receives the internal Runtime token.
- App Server always sees a Responses-compatible API even when upstream uses Chat Completions.
- Unsupported tool semantics fail before an upstream request; they are not silently removed.
- Prompt, model output, business data, API keys, and Authorization headers are excluded from logs and audit payloads.
- Generated App Server files are script-owned and never edited manually.
- Runtime version/schema mismatches prevent the user Runtime from entering `ready`.
- Provider, schema, and Runtime modules use platform types and do not import UI state.
- Relevant completion gates are `pnpm test:unit`, `pnpm lint`, `pnpm test:e2e`, and `git diff --check`.

---

### Task 1: Persist model providers, models, grants, and audit metadata

**Files:**
- Modify: `server/utils/gateway/storage/migrations.ts`
- Create: `shared/types/providers.ts`
- Modify: `shared/types.ts`
- Create: `server/utils/gateway/providers/provider-store.ts`
- Create: `server/utils/gateway/providers/provider-store.test.ts`
- Create: `server/utils/gateway/http/validation/providers.ts`

**Interfaces:**
- Produces: `ModelProviderDefinition`, `ProviderModelDefinition`, `ModelCapabilities`, `UserModelGrant`.
- Produces: `providerStore.create/update/list/getWithSecret/delete`.
- Creates: `model_providers`, `provider_models`, `user_model_grants`; consumes the shared `auditStore` created by the Runtime plan.

- [ ] **Step 1: Write failing encrypted-store and redaction tests**

```ts
it("returns provider metadata without exposing the API key", () => {
  store.create(adminProviderInput({ apiKey: "secret-value" }));
  const publicRow = store.listPublic()[0];
  expect(publicRow).not.toHaveProperty("apiKey");
  expect(JSON.stringify(publicRow)).not.toContain("secret-value");
  expect(store.getWithSecret(publicRow.id)?.apiKey).toBe("secret-value");
});
```

Also test that disabled models and models not granted to a user are absent from `listForUser(userId)`.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm exec vitest run server/utils/gateway/providers/provider-store.test.ts`

Expected: FAIL because provider types, migrations, and store do not exist.

- [ ] **Step 3: Add provider migrations and shared types**

Use an encrypted JSON field for credential material and ordinary columns for non-secret searchable metadata. Capabilities are validated by Zod:

```ts
export const modelCapabilitiesSchema = z.object({
  tools: z.boolean(),
  streamingTools: z.boolean(),
  vision: z.boolean(),
  reasoning: z.boolean(),
  maxContextTokens: z.number().int().positive().nullable(),
});
```

- [ ] **Step 4: Implement provider store and browser-safe serializers**

Every user query joins `user_model_grants`. Only admin service code may call `getWithSecret`. Audit fields store provider/model IDs and actions, never request bodies or keys.

- [ ] **Step 5: Verify and commit**

Run:

```text
pnpm exec vitest run server/utils/gateway/providers/provider-store.test.ts
pnpm typecheck
```

Commit:

```text
git add server/utils/gateway/storage/migrations.ts server/utils/gateway/providers server/utils/gateway/http/validation/providers.ts shared
git commit -m "feat: persist managed model providers"
```

---

### Task 2: Add administrator Provider APIs and user model catalog

**Files:**
- Create: `server/api/admin/providers/index.get.ts`
- Create: `server/api/admin/providers/index.post.ts`
- Create: `server/api/admin/providers/[id].patch.ts`
- Create: `server/api/admin/providers/[id].delete.ts`
- Create: `server/api/admin/providers/[id]/models.post.ts`
- Create: `server/api/admin/providers/[id]/grants.post.ts`
- Create: `server/api/provider-models/index.get.ts`
- Create: `tests/e2e/provider-admin-permissions.spec.ts`
- Create: `app/components/settings/providers/ProviderSettings.vue`
- Create: `app/components/settings/providers/ProviderEditor.vue`
- Create: `app/components/settings/settings-dock/SettingsDockProviderPanel.vue`
- Modify: `app/components/settings/settings-dock/types.ts`
- Modify: `app/components/settings/settings-dock/panel-registry.ts`
- Modify: `app/components/settings/settings-dock/useSettingsDock.ts`
- Modify: `i18n/locales/zh-CN.json`
- Modify: `i18n/locales/en.json`

**Interfaces:**
- Consumes: `requireAdminUser`, provider validation schemas, provider store.
- Produces: admin CRUD/grant endpoints and user-safe `/api/provider-models`.
- Produces: admin settings screen with no credential read-back.

- [ ] **Step 1: Write failing authorization E2E**

Create an admin and ordinary user. Assert ordinary user receives 403 from provider creation, admin can create one, and the ordinary user sees no model until granted.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test:e2e -- provider-admin-permissions.spec.ts`

Expected: FAIL with 404 for provider routes.

- [ ] **Step 3: Implement APIs with fixed DTOs**

Admin create accepts:

```ts
{
  name: string;
  baseUrl: string;
  wireApi: "responses" | "chat_completions";
  apiKey: string;
  requestTimeoutMs: number;
}
```

Patch responses include `hasApiKey: true` but never the key. Base URL validation permits only HTTPS, except loopback HTTP in development/E2E.

- [ ] **Step 4: Implement provider settings UI**

Use existing shadcn-vue inputs, dialogs, tables, and selects. An empty API-key field preserves the stored key; a non-empty value rotates it. Show model capability badges and explicit grant status.

- [ ] **Step 5: Verify and commit**

Run:

```text
pnpm lint
pnpm test:e2e -- provider-admin-permissions.spec.ts
```

Commit:

```text
git add server/api/admin/providers server/api/provider-models app/components/settings/providers app/components/settings/settings-dock i18n tests/e2e/provider-admin-permissions.spec.ts
git commit -m "feat: add managed provider administration"
```

---

### Task 3: Implement non-streaming Responses and Chat translation

**Files:**
- Create: `server/utils/gateway/providers/protocol/types.ts`
- Create: `server/utils/gateway/providers/protocol/responses-to-chat.ts`
- Create: `server/utils/gateway/providers/protocol/chat-to-responses.ts`
- Create: `server/utils/gateway/providers/protocol/responses-to-chat.test.ts`
- Create: `server/utils/gateway/providers/protocol/chat-to-responses.test.ts`
- Create: `server/utils/gateway/providers/capability-validator.ts`
- Create: `server/utils/gateway/providers/capability-validator.test.ts`

**Interfaces:**
- Produces: `toChatCompletionRequest(input, capabilities): ChatCompletionRequest`.
- Produces: `toResponsesResult(input, model): ResponsesResult`.
- Produces: `assertProviderSupportsRequest(input, capabilities): void`.

- [ ] **Step 1: Write failing request-conversion tests**

Cover developer/system/user messages, function calls, and tool outputs:

```ts
it("preserves a Codex function-call loop through Chat messages", () => {
  const chat = toChatCompletionRequest(responsesRequestWithFunctionOutput(), toolCapabilities);
  expect(chat.messages).toContainEqual(expect.objectContaining({
    role: "tool",
    tool_call_id: "call-1",
    content: "42",
  }));
});
```

- [ ] **Step 2: Run request tests and verify RED**

Run: `pnpm exec vitest run server/utils/gateway/providers/protocol/responses-to-chat.test.ts`

Expected: FAIL because translator is missing.

- [ ] **Step 3: Implement minimal request conversion**

Convert only explicitly supported fields. Reject non-function tools for Chat providers with `ProviderCapabilityError` naming the unsupported tool type and model.

- [ ] **Step 4: Write failing response-conversion tests**

Cover assistant text, multiple tool calls, empty choices, usage mapping, finish reasons, and upstream JSON errors.

- [ ] **Step 5: Implement response conversion**

Return valid Responses items with stable generated IDs, `call_id`, name, arguments, usage, and completed/failed status. Never convert malformed JSON tool arguments into executable calls.

- [ ] **Step 6: Verify and commit**

Run:

```text
pnpm exec vitest run server/utils/gateway/providers/protocol server/utils/gateway/providers/capability-validator.test.ts
pnpm typecheck
```

Commit:

```text
git add server/utils/gateway/providers/protocol server/utils/gateway/providers/capability-validator*
git commit -m "feat: translate responses and chat completion payloads"
```

---

### Task 4: Reconstruct streaming text and tool calls

**Files:**
- Create: `server/utils/gateway/providers/protocol/chat-stream-assembler.ts`
- Create: `server/utils/gateway/providers/protocol/chat-stream-assembler.test.ts`
- Create: `server/utils/gateway/providers/protocol/responses-sse.ts`
- Create: `server/utils/gateway/providers/protocol/responses-sse.test.ts`

**Interfaces:**
- Produces: `ChatStreamAssembler.push(delta): ResponsesStreamEvent[]`.
- Produces: `encodeResponsesSse(event): Uint8Array`.
- Consumes: response item types from Task 3.

- [ ] **Step 1: Write failing fragmented tool-call tests**

Feed deltas in separate chunks for ID, function name, and JSON arguments:

```ts
assembler.push(delta(0, 0, { id: "call-1", name: "query_", arguments: "{\"pro" }));
assembler.push(delta(0, 0, { name: "sales", arguments: "ject\":1}" }));
const events = assembler.finish();
expect(events.at(-1)).toMatchObject({
  type: "response.output_item.done",
  item: { type: "function_call", call_id: "call-1", name: "query_sales", arguments: "{\"project\":1}" },
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm exec vitest run server/utils/gateway/providers/protocol/chat-stream-assembler.test.ts`

Expected: FAIL because no stream assembler exists.

- [ ] **Step 3: Implement indexed accumulation and event ordering**

Key state by choice index and tool index. Emit Responses created/item/content/delta/done/completed events in valid order. Reject incomplete JSON, duplicate conflicting IDs, missing names, and upstream completion before a tool call is complete.

- [ ] **Step 4: Add text, usage, cancellation, and malformed-stream tests**

Verify UTF-8 chunks, multiple text deltas, usage-only final chunks, AbortSignal cancellation, and truncated SSE frames.

- [ ] **Step 5: Verify and commit**

Run:

```text
pnpm exec vitest run server/utils/gateway/providers/protocol
pnpm typecheck
```

Commit:

```text
git add server/utils/gateway/providers/protocol
git commit -m "feat: reconstruct streaming provider tool calls"
```

---

### Task 5: Add the authenticated internal Provider Proxy

**Files:**
- Create: `server/utils/gateway/providers/runtime-token.ts`
- Create: `server/utils/gateway/providers/runtime-token.test.ts`
- Create: `server/utils/gateway/providers/provider-proxy.ts`
- Create: `server/utils/gateway/providers/provider-proxy.test.ts`
- Create: `server/api/internal/providers/[providerId]/v1/responses.post.ts`
- Modify: `server/middleware/auth.ts`
- Modify: `nuxt.config.ts`

**Interfaces:**
- Consumes: provider store, user grants, protocol adapters, Runtime ownership.
- Produces: short-lived signed Runtime tokens scoped to user/runtime/provider/model.
- Produces: internal Responses endpoint with passthrough or Chat translation.

- [ ] **Step 1: Write failing token-scope tests**

```ts
it("rejects a runtime token when used for another provider", () => {
  const token = issueRuntimeModelToken({ userId: 1, runtimeId: "r1", providerId: "p1", modelId: "m1" });
  expect(() => verifyRuntimeModelToken(token, { providerId: "p2", modelId: "m1" })).toThrow();
});
```

Also test expiration, signature alteration, runtime ownership removal, and model grant revocation.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm exec vitest run server/utils/gateway/providers/runtime-token.test.ts`

Expected: FAIL because token service is absent.

- [ ] **Step 3: Implement internal auth separation**

Exclude `/api/internal/providers/*` from browser bearer middleware, then require only the Runtime model token in the route. The token TTL is five minutes and includes a unique ID for revocation/audit correlation.

- [ ] **Step 4: Write failing proxy integration tests**

Start local upstream fixtures for Responses and Chat modes. Assert status codes, headers, SSE ordering, tool calls, Usage, timeout, AbortSignal, 401, 429, and non-JSON upstream error conversion.

- [ ] **Step 5: Implement Provider Proxy orchestration**

Use native fetch and Web Streams. Strip hop-by-hop headers, set the real upstream Authorization header server-side, enforce payload and timeout limits, and record metadata-only audit events.

- [ ] **Step 6: Verify no sensitive output**

Capture logs during tests and assert they contain neither upstream key nor prompt marker. Assert browser error bodies omit upstream credentials and internal URLs.

- [ ] **Step 7: Verify and commit**

Run:

```text
pnpm exec vitest run server/utils/gateway/providers
pnpm lint
```

Commit:

```text
git add server/utils/gateway/providers server/api/internal/providers server/middleware/auth.ts nuxt.config.ts
git commit -m "feat: add internal multi-provider responses proxy"
```

---

### Task 6: Configure managed App Server containers to use Provider Gateway

**Files:**
- Modify: `packages/agent-runtime-manager/src/contracts.ts`
- Modify: `packages/agent-runtime-manager/src/lifecycle-service.ts`
- Modify: `docker/agent-runtime-entrypoint.sh`
- Modify: `server/utils/gateway/runtime-manager/runtime-service.ts`
- Create: `server/utils/gateway/providers/runtime-config.ts`
- Create: `server/utils/gateway/providers/runtime-config.test.ts`
- Modify: `server/api/models/index.get.ts`

**Interfaces:**
- Consumes: user model grants and short-lived Runtime model tokens.
- Produces: App Server `-c` provider configuration pointing only to Gateway internal Responses endpoint.
- Produces: user-visible model list from granted Provider models.

- [ ] **Step 1: Write failing runtime-config tests**

Assert generated configuration contains `wire_api="responses"`, the internal base URL, selected model/provider, and a non-secret internal bearer marker; assert it never contains the real provider key.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm exec vitest run server/utils/gateway/providers/runtime-config.test.ts`

Expected: FAIL because Runtime model config generation is absent.

- [ ] **Step 3: Implement provider config delivery**

Runtime Manager accepts a server-generated provider config object, not arbitrary CLI arguments. Entry point maps the validated fields to fixed `codex app-server -c` arguments and environment variables.

- [ ] **Step 4: Route the existing model selector to user grants**

For managed runtimes, `/api/models` returns platform-granted models and capability metadata. Existing SSH hosts retain current `model/list` behavior.

- [ ] **Step 5: Verify and commit**

Run:

```text
pnpm exec vitest run server/utils/gateway/providers/runtime-config.test.ts
pnpm lint
```

Commit:

```text
git add packages/agent-runtime-manager docker/agent-runtime-entrypoint.sh server/utils/gateway/providers/runtime-config* server/utils/gateway/runtime-manager server/api/models
git commit -m "feat: configure user runtimes for provider gateway"
```

---

### Task 7: Generate and compare App Server contracts

**Files:**
- Create: `scripts/generate-app-server-contract.mjs`
- Create: `scripts/check-app-server-compatibility.mjs`
- Create: `scripts/app-server-contract-lib.mjs`
- Create: `scripts/app-server-contract-lib.test.mjs`
- Create: `shared/generated/app-server/.gitkeep`
- Modify: `package.json`
- Modify: `Dockerfile`
- Modify: `docker/agent-runtime.Dockerfile`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `shared/generated/app-server/types/`, `json/`, and `manifest.json`.
- Produces: scripts `app-server:generate` and `app-server:check`.
- Produces: compatibility result `compatible | additive | breaking` with exact method/schema paths.

- [ ] **Step 1: Write failing contract-diff tests**

Use small JSON fixtures:

```js
test('classifies removal of a used method as breaking', () => {
  const result = compareContracts(contract(['thread/start']), contract([]), new Set(['thread/start']));
  assert.equal(result.classification, 'breaking');
});
```

Also cover additive methods, optional fields, required-field additions, enum removals, and experimental-only changes.

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/app-server-contract-lib.test.mjs`

Expected: FAIL because contract library is missing.

- [ ] **Step 3: Implement the pure contract manifest/diff library**

Manifest contains Codex version, generated timestamp, SHA-256 of canonical JSON schemas, method arrays for all four protocol directions, and method-to-schema references.

- [ ] **Step 4: Implement generation using pinned Codex**

Run exact commands from the installed `@openai/codex@0.151.0`:

```text
codex app-server generate-ts --out <temporary-types-directory>
codex app-server generate-json-schema --out <temporary-json-directory>
```

Write to a temporary directory, normalize ordering, then atomically replace `shared/generated/app-server`. Refuse generation when `codex --version` does not match `SUPPORTED_CODEX_VERSION`.

- [ ] **Step 5: Replace hand-written DTO imports at active boundaries**

Update `shared/runtime/app-server.ts` and protocol request/response parsers to import generated types while retaining Zod runtime validation for untrusted wire data. Do not mechanically replace unrelated UI types.

- [ ] **Step 6: Add build and CI gates**

`app-server:check` regenerates to a temporary directory, verifies no drift, and compares against the previous manifest. Docker images include matching version/hash labels.

- [ ] **Step 7: Verify and commit**

Run:

```text
node --test scripts/app-server-contract-lib.test.mjs
pnpm app-server:generate
pnpm app-server:check
pnpm lint
git diff --check
```

Commit generated artifacts with scripts:

```text
git add scripts shared/generated shared/runtime/app-server.ts package.json Dockerfile docker/agent-runtime.Dockerfile .github/workflows
git commit -m "feat: generate and gate app server contracts"
```

---

### Task 8: Enforce runtime contract compatibility and provider E2E

**Files:**
- Create: `server/utils/gateway/runtime-manager/compatibility-service.ts`
- Create: `server/utils/gateway/runtime-manager/compatibility-service.test.ts`
- Modify: `server/utils/gateway/runtime-manager/runtime-service.ts`
- Create: `server/api/admin/runtimes/[userId]/compatibility.get.ts`
- Create: `tests/e2e/provider-gateway.spec.ts`
- Create: `tests/e2e/runtime-schema-compatibility.spec.ts`
- Modify: `tests/e2e/docker-compose.yml`

**Interfaces:**
- Consumes: runtime image version/hash, generated manifest, App Server initialize `userAgent`.
- Produces: `ready` only for exact compatible contract.
- Proves: Responses and Chat providers complete real Codex tool turns.

- [ ] **Step 1: Write failing compatibility unit test**

```ts
it("moves a runtime to incompatible when image schema hash differs", async () => {
  await expect(service.verify(runtimeWithHash("old"), supportedManifest("new")))
    .resolves.toMatchObject({ status: "incompatible" });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm exec vitest run server/utils/gateway/runtime-manager/compatibility-service.test.ts`

Expected: FAIL because compatibility service is missing.

- [ ] **Step 3: Implement compatibility gate**

Compare exact Codex semver, image label, schema hash, and initialize `userAgent`. Persist structured mismatches without exposing internal endpoints.

- [ ] **Step 4: Write real Provider E2E**

Add local deterministic upstream fixtures. Run one managed App Server turn through Responses passthrough and one through Chat translation with a function/tool result cycle. Verify final assistant output, Usage, audit metadata, and no sensitive log contents.

- [ ] **Step 5: Add incompatible-image E2E**

Start an Agent fixture with a mismatched schema label. Assert runtime status `incompatible`, `turn/start` is rejected, and admin diagnostics identify version/hash mismatch.

- [ ] **Step 6: Run full verification and commit**

Run:

```text
pnpm test:unit
pnpm lint
pnpm test:e2e
git diff --check
```

Commit:

```text
git add server/utils/gateway/runtime-manager server/api/admin/runtimes tests/e2e
git commit -m "test: verify provider gateway and schema compatibility"
```

---

### Task 9: Implement compatible image upgrade and automatic rollback

Execute this task after all tasks in `2026-08-31-capabilities-mcp-and-conversation-actions.md`, because final upgrade verification includes capability reconciliation.

**Files:**
- Create: `server/utils/gateway/runtime-manager/upgrade-service.ts`
- Create: `server/utils/gateway/runtime-manager/upgrade-service.test.ts`
- Create: `server/api/admin/runtimes/[userId]/upgrade.post.ts`
- Modify: `packages/agent-runtime-manager/src/lifecycle-service.ts`
- Modify: `server/utils/gateway/runtime-manager/runtime-service.ts`
- Modify: `server/utils/gateway/audit/audit-store.ts`
- Create: `tests/e2e/runtime-upgrade-rollback.spec.ts`

**Interfaces:**
- Consumes: Runtime Manager lifecycle API and compatibility service from Task 8.
- Produces: `upgradeUserRuntime(userId, targetImageAlias): RuntimeUpgradeResult`.
- Guarantees: original volumes remain attached, old image/config remain available until verification passes, and failure restores the previous runtime.

- [ ] **Step 1: Write failing successful-upgrade and rollback tests**

```ts
it("restores the previous image when the replacement runtime fails compatibility", async () => {
  const result = await service.upgradeUserRuntime(1, "codex-next");
  expect(result.status).toBe("rolled_back");
  expect(runtimeManager.startCalls.at(-1)?.imageAlias).toBe("codex-stable");
  expect(runtimeManager.startCalls.at(-1)?.volumeIds).toEqual(originalVolumes);
});
```

Also assert new Turns are rejected while status is `upgrading`, a running Turn is interrupted only after the configured drain deadline, and audit records contain target/final image aliases.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm exec vitest run server/utils/gateway/runtime-manager/upgrade-service.test.ts`

Expected: FAIL because upgrade orchestration does not exist.

- [ ] **Step 3: Implement drain, replacement, verification, and rollback**

Persist previous image/config before stopping. Create a replacement with the same named volumes, run version/Schema/health/capability reconciliation checks, and switch the Gateway endpoint only after success. On failure remove the failed replacement and restore the old image.

- [ ] **Step 4: Add the admin-only upgrade API**

Accept only `targetImageAlias` from the server-configured alias allowlist. Reject image names, Docker arguments, mount paths, commands, and attempts to upgrade another user without admin role.

- [ ] **Step 5: Write and run real rollback E2E**

Start a user on the compatible image, create history, attempt an incompatible image upgrade, and assert the old image returns with the same Thread and volumes.

Run: `pnpm test:e2e -- runtime-upgrade-rollback.spec.ts`

- [ ] **Step 6: Verify and commit**

Run:

```text
pnpm exec vitest run server/utils/gateway/runtime-manager/upgrade-service.test.ts
pnpm lint
pnpm test:e2e -- runtime-upgrade-rollback.spec.ts
git diff --check
```

Commit:

```text
git add server/utils/gateway/runtime-manager/upgrade-service* server/utils/gateway/runtime-manager/runtime-service.ts server/utils/gateway/audit/audit-store.ts server/api/admin/runtimes packages/agent-runtime-manager/src/lifecycle-service.ts tests/e2e/runtime-upgrade-rollback.spec.ts
git commit -m "feat: upgrade and roll back compatible runtimes"
```
