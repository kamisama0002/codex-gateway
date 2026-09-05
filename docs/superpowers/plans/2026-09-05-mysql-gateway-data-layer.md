# MySQL Gateway Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Gateway business-data SQLite database with MySQL 8 while preserving every existing user, encrypted configuration, session, provider grant, runtime record, audit event, and tmux monitor, without changing the current single-Gateway/single-Runtime-node behavior.

**Architecture:** Introduce a thin asynchronous `GatewayDb` boundary backed by `mysql2/promise`, keep domain SQL in focused repositories, and propagate `async/await` through authentication, HTTP, realtime, runtime, provider, tmux, and startup paths. Create a separately invoked, checksummed MySQL migration runner and a read-only SQLite-to-MySQL importer; do not dual-write or run schema migration lazily from requests.

**Tech Stack:** Nuxt 4, TypeScript 6, Node 24, MySQL 8/InnoDB, `mysql2/promise`, Vitest, Docker Compose, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-05-multi-runtime-node-first-phase-design.md`

## Global Constraints

- This plan implements milestone 1 only. Runtime routing remains single-node through the existing `RUNTIME_MANAGER_BASE_URL` until the next plan.
- MySQL 8/InnoDB with `utf8mb4` and UTC is the only Gateway production database after cutover.
- Runtime Manager's local nonce SQLite remains unchanged; it is not Gateway business storage.
- Production `server/utils/gateway` code must not import `node:sqlite` after this milestone.
- SQLite may appear only in the one-time importer, importer tests, and Runtime Manager nonce store.
- Use `mysql2/promise` behind a thin injected DAL; do not introduce Prisma, Drizzle, Sequelize, TypeORM, or another ORM.
- All database I/O is asynchronous. Never block the event loop or disguise a Promise as a synchronous store call.
- Preserve numeric primary keys, token hashes, encrypted blobs, timestamps, foreign keys, role values, and provider/runtime identifiers exactly during import.
- Preserve `CODEX_GATEWAY_CONFIG_SECRET` and the current runtime identity secret; a database migration must not rotate either.
- Do not dual-write SQLite and MySQL. Cutover happens in a maintenance window after a verified import.
- The current Gateway remains single-active. Redis, active-active Gateway ownership, runtime-node scheduling, Relay, and workspace migration are outside this plan.
- Real SQL behavior is tested against MySQL 8, not an in-memory mock database.
- Keep existing browser DTOs, API paths, error codes, authentication behavior, and user-visible behavior unchanged unless this plan explicitly adds a database readiness error.
- Every task ends with focused tests and a commit. Do not combine tasks into one large commit.
- Tasks 3 through 6 are conversion checkpoints and must not be deployed separately; converted domains
  use `gatewayMysqlDatabase()` while untouched domains still compile against the old SQLite entry.
  Task 7 removes the live SQLite entry, and only Task 9 produces a deployable milestone artifact.

## Planned File Structure

- `server/utils/gateway/storage/contracts.ts`: database-neutral row, write-result, transaction, and `GatewayDb` contracts.
- `server/utils/gateway/storage/mysql.ts`: MySQL pool adapter, URL validation, transaction handling, and error normalization.
- `server/utils/gateway/storage/mysql-database.ts`: MySQL process lifecycle while conversion is in progress.
- `server/utils/gateway/storage/database.ts`: final Gateway database entry point after SQLite removal; no schema migration side effects.
- `server/utils/gateway/storage/mysql-migrations.ts`: checksummed MySQL migration definitions and runner.
- `server/utils/gateway/storage/mysql-schema.ts`: exact MySQL DDL kept separate from runner mechanics.
- `server/plugins/host-runtime-supervisor.ts`: startup connectivity check, supervisor bootstrap, and pool shutdown hook.
- `server/utils/gateway/auth/user-repository.ts`: users and password-account persistence.
- `server/utils/gateway/auth/session-repository.ts`: session issue, authentication query, revocation, expiry, and activity updates.
- `server/utils/gateway/config/user-config-repository.ts`: encrypted configuration persistence with monotonic revision.
- Existing domain files remain services and mapping layers; they stop issuing raw SQL directly.
- `scripts/database/migrate.mjs`: production MySQL schema migration entry point.
- `scripts/database/import-sqlite.mjs`: read-only, dry-runnable SQLite-to-MySQL import entry point.
- `scripts/database/verify-import.mjs`: count, key, FK, uniqueness, and encrypted-value verification.
- `tests/mysql/docker-compose.yml`: isolated MySQL 8 integration service.
- `tests/mysql/run-in-containers.sh`: deterministic database test runner and cleanup.
- `tests/mysql/helpers.ts`: unique-database creation and teardown for Vitest workers.

---

### Task 1: Add the async MySQL database boundary and real test service

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.env.example`
- Create: `server/utils/gateway/storage/contracts.ts`
- Create: `server/utils/gateway/storage/mysql.ts`
- Create: `server/utils/gateway/storage/mysql-database.ts`
- Create: `server/utils/gateway/storage/mysql.test.ts`
- Create: `tests/mysql/docker-compose.yml`
- Create: `tests/mysql/run-in-containers.sh`
- Create: `tests/mysql/helpers.ts`

**Interfaces:**
- Produces: `GatewayDb`, `DbRow`, `SqlValue`, and `DbWriteResult`.
- Produces: `createMysqlGatewayDb(databaseUrl): GatewayDb`.
- Produces: temporary conversion entry points `gatewayMysqlDatabase(): GatewayDb`,
  `verifyMysqlGatewayDatabase(): Promise<void>`, and `closeMysqlGatewayDatabase(): Promise<void>`.
- Produces: `freshMysqlTestDatabase(): Promise<GatewayDb>` with fixture-owned teardown registration.
- Consumes later: `DATABASE_URL=mysql://user:password@host:3306/codex_gateway`.

- [ ] **Step 1: Add the failing adapter tests**

Create `mysql.test.ts` with a real database fixture and these assertions:

```ts
it("commits a successful transaction and rolls back a rejected transaction", async () => {
  const db = await freshMysqlTestDatabase();
  await db.execute("CREATE TABLE samples (id INT PRIMARY KEY, value_text VARCHAR(32) NOT NULL)");
  await db.transaction(async (tx) => {
    await tx.execute("INSERT INTO samples (id, value_text) VALUES (?, ?)", [1, "committed"]);
  });
  await expect(
    db.transaction(async (tx) => {
      await tx.execute("INSERT INTO samples (id, value_text) VALUES (?, ?)", [2, "rolled-back"]);
      throw new Error("reject transaction");
    }),
  ).rejects.toThrow("reject transaction");
  expect(await db.one("SELECT value_text FROM samples WHERE id = ?", [1])).toEqual({
    value_text: "committed",
  });
  expect(await db.one("SELECT value_text FROM samples WHERE id = ?", [2])).toBeNull();
});
```

Also assert that malformed/non-MySQL `DATABASE_URL` values fail before a pool is created and that
`closeGatewayDatabase()` is idempotent.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
tests/mysql/run-in-containers.sh pnpm exec vitest run server/utils/gateway/storage/mysql.test.ts
```

Expected: FAIL because `contracts.ts`, `mysql.ts`, and the MySQL fixture do not exist.

- [ ] **Step 3: Add `mysql2` and define the thin DAL**

Add `mysql2` to root dependencies and define:

```ts
export type SqlValue = string | number | bigint | boolean | Buffer | Date | null;
export type DbRow = Record<string, unknown>;

export interface DbWriteResult {
  affectedRows: number;
  insertId: number;
}

export interface GatewayDb {
  one<T extends DbRow>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
  many<T extends DbRow>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  execute(sql: string, params?: readonly SqlValue[]): Promise<DbWriteResult>;
  transaction<T>(work: (tx: GatewayDb) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
```

`mysql.ts` must use `mysql2/promise.createPool`, `connection.beginTransaction/commit/rollback`,
release each transaction connection in `finally`, set connection timezone to `Z`, reject multiple
statements, and convert `insertId/affectedRows` to safe JavaScript integers.

- [ ] **Step 4: Add the isolated MySQL singleton without changing production storage**

`mysql-database.ts` reads only `DATABASE_URL`, lazily creates one MySQL pool adapter, exposes a
`SELECT 1` readiness probe, and closes the pool explicitly. Do not change the existing SQLite
`database.ts` in this task; production behavior must remain unchanged while the MySQL boundary is
being verified.

- [ ] **Step 5: Add deterministic MySQL test lifecycle**

`tests/mysql/run-in-containers.sh` starts `mysql:8.4`, waits for `mysqladmin ping`, runs the supplied
command in the repository test runner, and always removes only its named Compose project and volume.
Each Vitest worker creates a unique database name containing process/worker IDs, grants it to the
test user, and drops it in `afterAll`.

- [ ] **Step 6: Run GREEN and type checks**

Run:

```bash
tests/mysql/run-in-containers.sh pnpm exec vitest run server/utils/gateway/storage/mysql.test.ts
pnpm typecheck:dependencies
pnpm typecheck
```

Expected: the transaction test passes, invalid URLs are rejected, and dependencies typecheck.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example server/utils/gateway/storage/contracts.ts \
  server/utils/gateway/storage/mysql.ts server/utils/gateway/storage/mysql-database.ts \
  server/utils/gateway/storage/mysql.test.ts tests/mysql
git commit -m "feat(storage): add async mysql gateway database"
```

---

### Task 2: Create the checksummed MySQL schema migration runner

**Files:**
- Create: `server/utils/gateway/storage/mysql-schema.ts`
- Create: `server/utils/gateway/storage/mysql-migrations.ts`
- Create: `server/utils/gateway/storage/mysql-migrations.test.ts`
- Create: `scripts/database/migrate.mjs`
- Modify: `package.json`
- Modify: `Dockerfile`

**Interfaces:**
- Consumes: `GatewayDb` from Task 1.
- Produces: `migrateMysqlGatewayDatabase(db: GatewayDb): Promise<void>`.
- Produces: `pnpm db:migrate` and bundled production `scripts/database/migrate.mjs`.
- Creates: the current 11 business tables plus `schema_migrations`, with `user_configs.revision`.

- [ ] **Step 1: Write failing clean, repeat, and concurrent migration tests**

The real MySQL tests must prove:

```ts
it("creates the complete schema once under concurrent runners", async () => {
  const db = await freshMysqlTestDatabase();
  await Promise.all([migrateMysqlGatewayDatabase(db), migrateMysqlGatewayDatabase(db)]);
  const tables = await db.many<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()",
  );
  expect(tables).toHaveLength(12);
  expect(tables.map((row) => row.table_name).sort()).toEqual(
    expect.arrayContaining([
      "users",
      "sessions",
      "user_configs",
      "tmux_monitors",
      "user_agent_runtimes",
      "agent_audit_events",
      "model_providers",
      "provider_models",
      "user_model_grants",
      "external_identities",
      "external_session_contexts",
      "schema_migrations",
    ]),
  );
});
```

Also modify one stored migration checksum and assert startup rejects it rather than silently marking
the migration applied.

- [ ] **Step 2: Run RED**

Run:

```bash
tests/mysql/run-in-containers.sh pnpm exec vitest run server/utils/gateway/storage/mysql-migrations.test.ts
```

Expected: FAIL because the MySQL migration runner and schema do not exist.

- [ ] **Step 3: Define exact MySQL DDL**

Translate the existing schema to InnoDB with explicit foreign keys and indexes. Use `INT UNSIGNED`
for JavaScript numeric IDs, `TINYINT(1)` for booleans, `VARCHAR` for identifiers and fixed ISO UTC
timestamps, `LONGTEXT` only for encrypted/config/metadata JSON payloads, and
`ON DELETE CASCADE/SET NULL` matching the existing schema.

Implement active tmux uniqueness with a nullable generated column:

```sql
active_location_key VARCHAR(512)
  GENERATED ALWAYS AS (
    IF(status = 'active', CONCAT(user_id, ':', host_id, ':', session_name, ':', window_index, ':', pane_index), NULL)
  ) STORED,
UNIQUE KEY uq_tmux_active_location (active_location_key)
```

Create `user_configs.revision BIGINT UNSIGNED NOT NULL DEFAULT 1`. Keep all stored timestamps as UTC
ISO strings in this milestone so expiry/order semantics match the existing application.

- [ ] **Step 4: Implement checksum and migration locking**

The runner obtains `GET_LOCK('codex_gateway_schema_migrate', 30)`, creates
`schema_migrations(version, checksum, applied_at)`, validates checksums for every applied migration,
runs each pending migration, records it, and always releases the named lock. It must not run from an
HTTP request or module import.

- [ ] **Step 5: Add the production CLI and image bundle**

`scripts/database/migrate.mjs` loads `DATABASE_URL`, creates the adapter, runs migrations, prints only
version/count information, closes the pool, and exits nonzero without printing credentials. Add
`db:migrate` and bundle the script into the production image using the existing esbuild pattern.

- [ ] **Step 6: Run GREEN, schema invariants, and type checks**

Run:

```bash
tests/mysql/run-in-containers.sh pnpm exec vitest run server/utils/gateway/storage/mysql-migrations.test.ts
pnpm typecheck:dependencies
pnpm typecheck
git diff --check
```

Expected: two concurrent runners produce one checksummed schema and all FK/unique tests pass.

- [ ] **Step 7: Commit**

```bash
git add package.json Dockerfile scripts/database server/utils/gateway/storage/mysql-schema.ts \
  server/utils/gateway/storage/mysql-migrations.ts \
  server/utils/gateway/storage/mysql-migrations.test.ts
git commit -m "feat(storage): add mysql schema migrations"
```

---

### Task 3: Migrate users, sessions, and encrypted configuration to async repositories

**Files:**
- Create: `server/utils/gateway/auth/user-repository.ts`
- Create: `server/utils/gateway/auth/session-repository.ts`
- Create: `server/utils/gateway/config/user-config-repository.ts`
- Rewrite: `server/utils/gateway/auth/users.ts`
- Rewrite: `server/utils/gateway/auth/external-identities.ts`
- Rewrite tests: `server/utils/gateway/auth/external-identities.test.ts`
- Modify: `server/api/auth/dataops.post.ts`
- Modify: `server/utils/gateway/auth/context.ts`
- Modify: `server/middleware/auth.ts`
- Modify: `server/utils/gateway/http/errors.ts`
- Modify: `server/utils/gateway/http/config-mutation.ts`
- Modify: `server/utils/gateway/config/user-config-mutation-service.ts`
- Modify: `server/utils/gateway/state/memory.ts`
- Modify: `server/utils/gateway/runtime/host-runtime-supervisor.ts`
- Modify: `server/utils/gateway/runtime/host-runtime-supervisor.test.ts`
- Modify: `server/utils/gateway/runtime-manager/runtime-service.ts`
- Modify: `server/utils/gateway/runtime-manager/runtime-service.test.ts`
- Modify: `server/api/admin/runtimes/index.get.ts`
- Modify: `server/api/config/notifications.post.ts`
- Modify: `server/api/config/pet.post.ts`
- Modify: `server/api/config/pinned-threads.post.ts`
- Modify: `server/api/config/sync.post.ts`
- Modify: `server/api/hosts/[id].delete.ts`
- Modify: `server/api/hosts/[id].patch.ts`
- Modify: `server/api/hosts/index.post.ts`
- Modify: `server/api/projects/[id].delete.ts`
- Modify: `server/api/projects/[id].patch.ts`
- Modify: `server/api/projects/index.post.ts`
- Modify: `server/api/threads/archive.post.ts`
- Modify: `server/api/threads/delete.post.ts`
- Rewrite tests: `server/utils/gateway/auth/context.test.ts`
- Create tests: `server/utils/gateway/auth/user-repository.test.ts`
- Create tests: `server/utils/gateway/auth/session-repository.test.ts`
- Create tests: `server/utils/gateway/config/user-config-repository.test.ts`
- Create: `server/utils/gateway/config/user-config-mutation-service.test.ts`
- Create: `server/utils/gateway/http/config-mutation.test.ts`
- Modify: `server/utils/gateway/http/errors.test.ts`

**Interfaces:**
- Consumes: `GatewayDb` and the MySQL schema.
- Produces: async `userStore` methods.
- Produces: `loadConfig(userId): Promise<{ config: GatewayConfig; revision: number }>`.
- Produces: `saveConfig(userId, config, expectedRevision): Promise<number>`.
- Produces: async `authenticateEvent` and `optionalAuthenticatedUser`.
- Preserves synchronous `requireAuthenticatedUser`, `requireAdminUser`, and
  `requireDataOpsAdvancedSettingsAccess` as context-only guards after middleware authentication.
- Produces: `ExternalIdentityStore.loginDataOps(claims): Promise<AuthSession>`.

- [ ] **Step 1: Write failing repository tests**

Use real MySQL and assert:

```ts
it("rejects a stale encrypted-config revision without overwriting the winner", async () => {
  const repository = new UserConfigRepository(db);
  const initial = await repository.load(userId);
  const revision2 = await repository.save(userId, configA, initial.revision);
  await expect(repository.save(userId, configB, initial.revision)).rejects.toMatchObject({
    code: "config_revision_conflict",
  });
  expect((await repository.load(userId)).revision).toBe(revision2);
  expect((await repository.load(userId)).config).toEqual(configA);
});
```

Also cover username normalization, first-user admin assignment under two concurrent creates,
password login, disabled user rejection, session expiry deletion, logout revocation, default config,
DataOps identity concurrency, and encryption/decryption failure without an in-memory commit.

- [ ] **Step 2: Run RED**

Run:

```bash
tests/mysql/run-in-containers.sh pnpm exec vitest run \
  server/utils/gateway/auth/user-repository.test.ts \
  server/utils/gateway/auth/session-repository.test.ts \
  server/utils/gateway/auth/external-identities.test.ts \
  server/utils/gateway/config/user-config-repository.test.ts
```

Expected: FAIL because async repositories and config revisions do not exist.

- [ ] **Step 3: Implement focused repositories and async services**

Move raw user SQL into `UserRepository`, session SQL into `SessionRepository`, and encrypted config
SQL into `UserConfigRepository`. Keep password/token generation and GatewayConfig parsing in service
code. Use `INSERT ... ON DUPLICATE KEY UPDATE`, `SELECT ... FOR UPDATE` where role assignment needs
serialization, and compare-and-swap:

```sql
UPDATE user_configs
SET encrypted_config_json = ?, revision = revision + 1, updated_at = ?
WHERE user_id = ? AND revision = ?
```

Zero affected rows must distinguish missing config from a stale revision and return a typed
`config_revision_conflict` error.

- [ ] **Step 4: Propagate async authentication and config loading**

Make `server/middleware/auth.ts` await `authenticateEvent`. Context-only `require*User` guards must
read `event.context.auth` and never perform a hidden database fallback. Make
`defineGatewayEventHandler` await `ensureUserConfigLoaded`, and make config mutation handlers await
`UserConfigMutationService.commit`. Store the loaded config revision in the user-scoped memory state.
After a revision conflict, restore the previous memory state and return HTTP 409; never publish
host/pinned-thread side effects from a failed persistence operation.

Convert DataOps identity lookup/create/session work to one MySQL transaction. Update
`hostRuntimeSupervisor.bootstrapStoredUsers` to await `listStoredConfigs`, and update runtime status
listing to await `findUsername`, so the root project remains type-correct at the end of this task.

Explicitly update these config mutation call sites to await the commit result:

```text
server/api/config/notifications.post.ts
server/api/config/pet.post.ts
server/api/config/pinned-threads.post.ts
server/api/config/sync.post.ts
server/api/hosts/[id].delete.ts
server/api/hosts/[id].patch.ts
server/api/hosts/index.post.ts
server/api/projects/[id].delete.ts
server/api/projects/[id].patch.ts
server/api/projects/index.post.ts
server/api/threads/archive.post.ts
server/api/threads/delete.post.ts
server/utils/gateway/thread-titles/projection.ts
```

- [ ] **Step 5: Run GREEN and affected auth/config tests**

Run:

```bash
tests/mysql/run-in-containers.sh pnpm exec vitest run \
  server/utils/gateway/auth \
  server/utils/gateway/config \
  server/utils/gateway/http \
  server/utils/gateway/runtime/host-runtime-supervisor.test.ts \
  server/utils/gateway/runtime-manager/runtime-service.test.ts
pnpm typecheck
```

Expected: auth/config tests pass and TypeScript identifies no missed synchronous caller.

- [ ] **Step 6: Commit**

```bash
git add server/middleware server/api/config server/api/hosts server/api/projects server/api/threads \
  server/api/auth/dataops.post.ts server/api/admin/runtimes/index.get.ts \
  server/utils/gateway/auth server/utils/gateway/config server/utils/gateway/http \
  server/utils/gateway/state/memory.ts server/utils/gateway/thread-titles \
  server/utils/gateway/runtime/host-runtime-supervisor.ts \
  server/utils/gateway/runtime/host-runtime-supervisor.test.ts \
  server/utils/gateway/runtime-manager/runtime-service.ts \
  server/utils/gateway/runtime-manager/runtime-service.test.ts
git commit -m "refactor(auth): use async mysql repositories"
```

---

### Task 4: Migrate the user administration CLI

**Files:**
- Rewrite: `scripts/create-user.mjs`
- Modify: `server/utils/gateway/auth/create-user-script.test.ts`
- Modify: `Dockerfile`

**Interfaces:**
- Consumes: async `GatewayDb`, user/session repositories, and MySQL migrations.
- Produces: MySQL-backed `pnpm user:create` with the existing CLI arguments.

- [ ] **Step 1: Write failing MySQL CLI tests**

Assert the CLI creates the first user as admin, creates a later user as user, updates password without
changing an implicit role, honors explicit `--role`, rejects short passwords, never prints
`DATABASE_URL`, and closes the pool on both success and failure.

- [ ] **Step 2: Run RED**

Run:

```bash
tests/mysql/run-in-containers.sh pnpm exec vitest run \
  server/utils/gateway/auth/create-user-script.test.ts
```

Expected: FAIL because the CLI still requires `DatabaseSync` and SQLite SQL.

- [ ] **Step 3: Convert `user:create` to MySQL**

Keep the existing interface:

```text
node scripts/create-user.mjs <username> <password> [--role admin|user]
```

Read `DATABASE_URL`, require an already migrated schema, call the same repository/service behavior,
print username and role but never the database URL or password, close the pool, and bundle the script
for the production image.

- [ ] **Step 4: Run GREEN**

Run:

```bash
tests/mysql/run-in-containers.sh pnpm exec vitest run \
  server/utils/gateway/auth/create-user-script.test.ts
```

Expected: CLI tests pass against MySQL.

- [ ] **Step 5: Commit**

```bash
git add scripts/create-user.mjs server/utils/gateway/auth/create-user-script.test.ts Dockerfile
git commit -m "refactor(auth): create users in mysql"
```

---

### Task 5: Migrate providers, runtimes, and audit stores

**Files:**
- Rewrite: `server/utils/gateway/providers/provider-store.ts`
- Rewrite: `server/utils/gateway/providers/provider-store.test.ts`
- Modify: `server/utils/gateway/providers/provider-proxy.ts`
- Modify: `server/utils/gateway/providers/provider-proxy.test.ts`
- Modify: `server/api/admin/providers/index.get.ts`
- Modify: `server/api/admin/providers/index.post.ts`
- Modify: `server/api/admin/providers/[id].delete.ts`
- Modify: `server/api/admin/providers/[id].patch.ts`
- Modify: `server/api/admin/providers/[id]/grants.post.ts`
- Modify: `server/api/admin/providers/[id]/models.post.ts`
- Modify: `server/api/models/index.get.ts`
- Modify: `server/api/provider-models/index.get.ts`
- Rewrite: `server/utils/gateway/runtime-manager/runtime-store.ts`
- Rewrite: `server/utils/gateway/runtime-manager/runtime-store.test.ts`
- Modify: `server/utils/gateway/runtime-manager/runtime-service.ts`
- Modify: `server/utils/gateway/runtime-manager/runtime-service.test.ts`
- Modify: `server/api/runtime/me.get.ts`
- Modify: `server/api/runtime/start.post.ts`
- Modify: `server/api/runtime/restart.post.ts`
- Modify: `server/api/admin/runtimes/index.get.ts`
- Modify: `server/api/admin/runtimes/[userId]/restart.post.ts`
- Rewrite: `server/utils/gateway/audit/audit-store.ts`
- Rewrite: `server/utils/gateway/audit/audit-store.test.ts`

**Interfaces:**
- Produces: every `ProviderStore` method as a Promise.
- Produces: every `RuntimeStorePort` and browser-facing runtime service method as a Promise.
- Produces: `auditStore.record/listForAdmin/listForUser` as Promise-returning methods.
- Preserves: current public provider/runtime DTOs and encrypted secret behavior.

- [ ] **Step 1: Rewrite store contracts in tests first and verify RED**

Add real-MySQL tests for provider CRUD/upsert/grant/revoke, runtime user ownership/status/delete, audit
metadata filtering/order, and rollback on FK/unique failures. Change provider proxy fakes to async:

```ts
const store = {
  listForUser: vi.fn(async () => [grantedModel]),
  getWithSecret: vi.fn(async () => providerWithSecret),
};
```

Run the focused files and require type/test failures before production edits.

- [ ] **Step 2: Implement MySQL ProviderStore and await every caller**

Replace `ON CONFLICT` with `ON DUPLICATE KEY UPDATE` or idempotent insert semantics. Await the store
before opening an upstream provider request. Update admin APIs and model catalog APIs to await all
reads/writes and await audit recording after each committed provider mutation.

- [ ] **Step 3: Implement async RuntimeStore and RuntimeService persistence**

Change the service port to:

```ts
interface RuntimeStorePort {
  getByUserId(userId: number): Promise<UserAgentRuntimeRecord | null>;
  list(): Promise<UserAgentRuntimeRecord[]>;
  upsert(record: UserAgentRuntimeRecord): Promise<UserAgentRuntimeRecord>;
  deleteForUser(userId: number): Promise<boolean>;
}
```

Await each state write before lifecycle RPC or audit proceeds. Keep the existing in-process per-user
Mutex because this milestone remains single Gateway. Make `providerConfigForUser`, `getStatus`,
`listStatuses`, and `usernameFor` asynchronous without changing runtime identity derivation.

- [ ] **Step 4: Implement async audit persistence**

Keep metadata allow-list validation synchronous, then await the insert and read-back. Error paths
must await the audit attempt before returning unless doing so would mask the original error; in that
case log the audit failure without leaking sensitive metadata and preserve the original error code.

- [ ] **Step 5: Run GREEN and focused typecheck**

Run:

```bash
tests/mysql/run-in-containers.sh pnpm exec vitest run \
  server/utils/gateway/providers \
  server/utils/gateway/runtime-manager \
  server/utils/gateway/audit
pnpm typecheck
```

Expected: all store/proxy/runtime/audit tests pass with no synchronous caller left.

- [ ] **Step 6: Commit**

```bash
git add server/api/admin/providers server/api/admin/runtimes server/api/runtime server/api/models \
  server/api/provider-models server/utils/gateway/providers server/utils/gateway/runtime-manager \
  server/utils/gateway/audit
git commit -m "refactor(gateway): move runtime and provider state to mysql"
```

---

### Task 6: Migrate tmux monitors, session activity, and scheduled tasks

**Files:**
- Rewrite: `server/utils/gateway/tmux-monitor/repository.ts`
- Modify: `server/utils/gateway/tmux-monitor/monitor-service.ts`
- Modify: `server/utils/gateway/tmux-monitor/monitor-notifier.ts`
- Modify: `server/utils/gateway/tmux-monitor/poll-coordinator.ts`
- Modify: `server/utils/gateway/tmux-monitor/permanent-monitor-checker.ts`
- Modify: `server/api/hosts/[id]/tmux/monitors.post.ts`
- Modify: `server/api/hosts/[id]/tmux/monitors/[monitorId].delete.ts`
- Modify: `server/api/hosts/[id]/tmux/monitors/[monitorId]/promote.post.ts`
- Modify: `server/api/hosts/[id]/tmux/monitors/check.post.ts`
- Modify: `server/api/hosts/[id]/tmux/panes/output.get.ts`
- Modify: `server/api/tmux/monitors.get.ts`
- Rewrite: `server/utils/gateway/auth/session-activity-tracker.ts`
- Modify: `server/utils/gateway/scheduled-tasks/expired-session-cleanup.ts`
- Modify: `server/tasks/gateway/prune-expired-sessions.ts`
- Create: `server/utils/gateway/tmux-monitor/repository.test.ts`
- Create: `server/utils/gateway/tmux-monitor/monitor-service.test.ts`
- Create: `server/utils/gateway/tmux-monitor/monitor-notifier.test.ts`
- Create: `server/utils/gateway/tmux-monitor/poll-coordinator.test.ts`
- Create: `server/utils/gateway/auth/session-activity-tracker.test.ts`

**Interfaces:**
- Produces: Promise-returning `TmuxMonitorRepository` methods.
- Produces: `SessionActivityTracker.touch(tokenHash): void` with internally coalesced async writes.
- Preserves: existing tmux completion and Bark notification semantics.

- [ ] **Step 1: Write failing real-MySQL monitor tests**

Cover creation, active-location uniqueness, once/permanent transitions, host error recording,
notification marking, cancellation, promotion, history pruning, and two concurrent create/poll
attempts. Assert the database allows only one active monitor for the same location.

- [ ] **Step 2: Run RED**

Run:

```bash
tests/mysql/run-in-containers.sh pnpm exec vitest run server/utils/gateway/tmux-monitor
```

Expected: FAIL because the repository is synchronous and uses SQLite-specific insert IDs and delete
syntax.

- [ ] **Step 3: Convert the monitor repository and service chain**

Use MySQL `insertId`, explicit transactions for multi-row completion/history writes, and a portable
two-step history prune by selected IDs instead of `LIMIT -1 OFFSET ?`. Await repository methods in
monitor service, notifier, coordinator, permanent checker, and every tmux API route.

- [ ] **Step 4: Preserve notification ordering**

Keep Bark delivery before `markNotificationSent`; if delivery or MySQL marking fails, the monitor
remains eligible for retry. Tests must inject failure immediately before and after the database mark
and assert no monitor is permanently skipped.

- [ ] **Step 5: Make session activity writes safely asynchronous**

Authentication still awaits the authoritative session query. `touch` may return immediately after
scheduling one coalesced update per token, but it must keep an in-flight Promise map, remove entries
in `finally`, bound the map, and swallow only ancillary `last_seen_at` write errors. Logout/expiry
must await authoritative deletion before emitting local revocation.

- [ ] **Step 6: Run GREEN and task tests**

Run:

```bash
tests/mysql/run-in-containers.sh pnpm exec vitest run \
  server/utils/gateway/tmux-monitor \
  server/utils/gateway/auth/session-activity-tracker.test.ts \
  server/utils/gateway/scheduled-tasks
pnpm typecheck
```

Expected: monitor/session/task tests pass and scheduled handlers await all database work.

- [ ] **Step 7: Commit**

```bash
git add server/api/hosts server/api/tmux server/tasks server/utils/gateway/tmux-monitor \
  server/utils/gateway/auth/session-activity-tracker.ts server/utils/gateway/scheduled-tasks
git commit -m "refactor(monitors): use async mysql persistence"
```

---

### Task 7: Make Gateway startup and shutdown MySQL-aware

**Files:**
- Rewrite: `server/plugins/host-runtime-supervisor.ts`
- Modify: `server/utils/gateway/runtime/host-runtime-supervisor.ts`
- Modify: `server/api/auth/me.get.ts`
- Modify: `server/api/admin/runtimes/index.get.ts`
- Modify: `server/api/admin/runtimes/[userId]/restart.post.ts`
- Modify: `server/api/runtime/me.get.ts`
- Modify: `server/api/runtime/start.post.ts`
- Modify: `server/api/runtime/restart.post.ts`
- Modify: `server/api/models/index.get.ts`
- Modify: `server/api/provider-models/index.get.ts`
- Modify: `server/middleware/auth.ts`
- Modify: `nuxt.config.ts`
- Create: `server/plugins/host-runtime-supervisor.test.ts`
- Modify: `server/utils/gateway/runtime/host-runtime-supervisor.test.ts`
- Modify: `server/utils/gateway/realtime/handlers/auth.test.ts`

**Interfaces:**
- Consumes: `verifyGatewayDatabase`, `closeGatewayDatabase`, and async `userStore.listStoredConfigs`.
- Produces: deterministic database initialization before supervisor bootstrap.
- Produces: fail-closed request behavior when MySQL is unavailable.

- [ ] **Step 1: Write failing lifecycle tests**

Test that the supervisor does not connect stored hosts before `verifyGatewayDatabase` and config load
succeed, bootstraps each stored user exactly once, closes the pool on Nitro shutdown, and fails
authenticated API/realtime requests with `database_unavailable` when MySQL cannot be reached.

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm exec vitest run \
  server/utils/gateway/runtime/host-runtime-supervisor.test.ts \
  server/utils/gateway/storage/mysql.test.ts
```

Expected: FAIL because startup still watches a local SQLite file/readiness callback.

- [ ] **Step 3: Add the Nitro database lifecycle plugin**

On Nitro startup, verify MySQL connectivity, then start and await `hostRuntimeSupervisor.bootstrapStoredUsers`.
Register shutdown hooks that stop the supervisor before closing the MySQL pool. Remove
`gatewayDatabaseExists`, `gatewayDatabaseReady`, and `onGatewayDatabaseReady` from the supervisor.
Do not run schema migrations in this plugin.

- [ ] **Step 4: Finish async caller propagation**

Await authentication and stores in every API route listed above. Update realtime authentication to
await `userStore.authenticateToken` before setting peer state. Remove `node:sqlite` from Nitro
externals and ensure `mysql2` is bundled/externalized in a way the production runner actually ships.

- [ ] **Step 5: Prove no live Gateway runtime import uses SQLite**

Run:

```bash
rg -n "from .*storage/migrations|gatewayDatabaseExists|gatewayDatabaseReady|onGatewayDatabaseReady" \
  server/utils/gateway server/api server/middleware server/plugins
pnpm typecheck
pnpm build
```

Expected: search returns no live import/readiness match (exit 1); typecheck and build pass. The old
SQLite migration source remains temporarily for Task 8's fixture/import validation but is unreachable
from the Gateway runtime.

- [ ] **Step 6: Commit**

```bash
git add server/plugins server/middleware server/api server/utils/gateway/runtime \
  server/utils/gateway/storage/database.ts nuxt.config.ts
git commit -m "feat(gateway): bootstrap from mysql"
```

---

### Task 8: Add the verified SQLite-to-MySQL importer

**Files:**
- Create: `scripts/database/import-sqlite.mjs`
- Create: `scripts/database/verify-import.mjs`
- Create: `scripts/database/sqlite-import.ts`
- Create: `scripts/database/sqlite-import.test.ts`
- Delete: `server/utils/gateway/storage/migrations.ts`
- Delete: `server/utils/gateway/storage/migrations.test.ts`
- Modify: `package.json`
- Modify: `Dockerfile`
- Create: `tests/fixtures/build-gateway-v8-sqlite.mjs`

**Interfaces:**
- Produces: `pnpm db:import-sqlite -- --source <path> --dry-run`.
- Produces: `pnpm db:verify-import -- --source <path>`.
- Consumes: an already migrated, empty MySQL database and existing encryption secret.

- [ ] **Step 1: Build a representative SQLite fixture and failing dry-run test**

The fixture must contain all current tables and relationships: local and DataOps users, active and
expired sessions, encrypted user config, once/permanent tmux monitors, runtime status, audit events,
two providers/models/grants, and external session contexts. Include explicit non-default primary keys.

Assert `--dry-run` reads and validates the fixture but leaves every MySQL table empty.

- [ ] **Step 2: Run RED**

Run:

```bash
tests/mysql/run-in-containers.sh pnpm exec vitest run scripts/database/sqlite-import.test.ts
```

Expected: FAIL because the importer does not exist.

- [ ] **Step 3: Implement ordered, transactional import**

Open SQLite read-only, run `PRAGMA quick_check` and reject anything except `ok`, require MySQL to
contain no business rows, and import in FK order using prepared parameterized inserts. Preserve source
IDs and encrypted strings byte-for-byte. Run the import in one MySQL transaction; rollback all tables
on any duplicate, FK, conversion, or decryption validation error.

- [ ] **Step 4: Implement verification and auto-increment reset**

For each table compare row count and deterministic primary-key/hash manifests, query FK orphan counts,
validate unique relationships, decrypt sampled `user_configs` and provider API keys using the current
`CODEX_GATEWAY_CONFIG_SECRET`, and reset each auto-increment above the imported maximum. Output only
table names, counts, checksums, and pass/fail; never output hashes used as credentials or decrypted data.

- [ ] **Step 5: Test failure and rerun behavior**

Cover corrupt SQLite, non-empty MySQL, duplicate keys, missing foreign rows, wrong config secret,
mid-import failure rollback, `--dry-run`, successful import, and refusing a second real import into the
now non-empty target.

- [ ] **Step 6: Run GREEN and bundle smoke test**

Run:

```bash
tests/mysql/run-in-containers.sh pnpm exec vitest run scripts/database/sqlite-import.test.ts
pnpm db:import-sqlite -- --help
pnpm db:verify-import -- --help
pnpm build
rg -n "node:sqlite|DatabaseSync|CODEX_GATEWAY_DB_PATH|PRAGMA" \
  server/utils/gateway server/api server/middleware server/plugins
```

Expected: importer tests pass, production image scripts start without missing modules, and the final
search returns no Gateway production match (exit 1). Runtime Manager nonce SQLite and importer files
under `packages/agent-runtime-manager` and `scripts/database` are intentionally outside the search.

- [ ] **Step 7: Commit**

```bash
git add package.json Dockerfile scripts/database tests/fixtures \
  server/utils/gateway/storage/migrations.ts server/utils/gateway/storage/migrations.test.ts
git commit -m "feat(storage): migrate sqlite data to mysql"
```

---

### Task 9: Switch Compose and real E2E to MySQL

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `Dockerfile`
- Modify: `tests/e2e/docker-compose.yml`
- Modify: `tests/e2e/run-in-containers.sh`
- Modify: `tests/e2e/global-setup.ts`
- Modify: `tests/e2e/global-teardown.ts`
- Modify: `tests/unit/setup.ts`
- Modify: `README.md` if present deployment instructions reference SQLite
- Create: `docs/operations/mysql-cutover.md`
- Create: `docs/operations/mysql-backup-restore.md`

**Interfaces:**
- Produces: Compose `mysql`, one-shot `database-migrate`, and Gateway dependency on successful schema migration.
- Produces: an external-MySQL production mode via `DATABASE_URL` without requiring the bundled MySQL service.
- Produces: tested cutover, backup, restore, and rollback runbooks.

- [ ] **Step 1: Add MySQL to E2E and verify RED**

Add a healthy MySQL service and replace `CODEX_GATEWAY_DB_PATH` with `DATABASE_URL` in build runner,
Gateway, and test runner. Make the build/test bootstrap run `db:migrate` followed by MySQL
`user:create`. Run one auth E2E and require failure before the application conversion is complete.

- [ ] **Step 2: Update production Compose safely**

Add a MySQL service with a persistent named volume and healthcheck for self-contained deployments.
Add a one-shot `database-migrate` service using the built Gateway image; `codex-gateway` starts only
after it exits successfully. Support an override that removes the bundled MySQL service and supplies
an external `DATABASE_URL`. Never put a real password in committed Compose or `.env.example`.

- [ ] **Step 3: Rewrite test bootstrapping**

`tests/unit/setup.ts` must stop assigning a SQLite path. Database repository tests run only through
the MySQL harness; pure unit tests inject repository doubles. Containerized E2E creates users after
MySQL is healthy, uses a unique Compose project/database, and removes only its own volume in teardown.

- [ ] **Step 4: Add operational runbooks**

`mysql-cutover.md` must contain the exact maintenance sequence: stop writes, SQLite online backup,
`quick_check`, MySQL migrate, importer dry-run, real import, verification, smoke tests, entry switch,
and the point after which direct SQLite rollback is forbidden.

`mysql-backup-restore.md` must cover `--single-transaction` backup, binlog retention, off-host copy,
restore into a temporary database, verification, secret restoration, cold Gateway start, and DataOps
entry switch. State explicitly that database backup does not back up `/workspace` or `/codex-home`.

- [ ] **Step 5: Run focused real E2E**

Run:

```bash
pnpm test:e2e -- dataops-embed.spec.ts provider-settings.spec.ts managed-runtime-isolation.spec.ts
```

Expected: password/DataOps login, provider authorization, managed runtime startup, thread history, and
user isolation pass against real MySQL.

- [ ] **Step 6: Run full milestone verification**

Run:

```bash
tests/mysql/run-in-containers.sh pnpm test:unit
pnpm lint
pnpm test:e2e
pnpm build
git diff --check
```

Expected: zero failures; E2E uses real MySQL and the real Runtime Manager/App Server topology.

- [ ] **Step 7: Perform a pre-production import rehearsal on CentOS 10**

Use a copy of `/opt/codex-gateway/data/codex-gateway.db`, never the live file. Start an isolated MySQL
database and isolated Gateway ports/project name, run dry-run/import/verification, then smoke-test
login, DataOps SSO, providers, one existing runtime record, and audit/tmux reads. Delete only the
explicit isolated test project after recording counts and checksums.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml .env.example Dockerfile tests README.md docs/operations
git commit -m "test(storage): run gateway on mysql"
```

---

## Milestone Completion Gate

Before opening a PR for milestone 1:

- [ ] Confirm every requirement in this plan has a passing test or an explicit runbook verification.
- [ ] Confirm `server/utils/gateway`, `server/api`, `server/middleware`, and `server/plugins` have no Gateway-business `node:sqlite`, `DatabaseSync`, `PRAGMA`, or `CODEX_GATEWAY_DB_PATH` references.
- [ ] Confirm Runtime Manager nonce SQLite tests remain unchanged and passing.
- [ ] Confirm the importer preserves every source table count, primary key, encrypted blob, and FK relationship.
- [ ] Confirm full unit, typecheck, lint, build, and real containerized E2E pass.
- [ ] Confirm the CentOS rehearsal uses only a copied SQLite database and isolated Compose resources.
- [ ] Request code review before production cutover.
