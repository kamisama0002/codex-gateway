# Task 3 Report: Async MySQL Identity and Config Slice

## Status

Task 3 is complete as a non-deployable conversion checkpoint. Users, bearer sessions, external
DataOps identities, and encrypted user configuration now use the async MySQL `GatewayDb` boundary.
Provider, runtime, audit, tmux-monitor, and remaining runtime persistence stay on SQLite for their
later tasks. The live SQLite database entry and old SQLite migrations were not changed or deleted.

## Files Changed

Repository and service implementation:

- `server/utils/gateway/auth/user-repository.ts`
- `server/utils/gateway/auth/session-repository.ts`
- `server/utils/gateway/config/user-config-repository.ts`
- `server/utils/gateway/auth/users.ts`
- `server/utils/gateway/auth/external-identities.ts`
- `server/utils/gateway/auth/context.ts`
- `server/utils/gateway/config/user-config-mutation-service.ts`
- `server/utils/gateway/http/config-mutation.ts`
- `server/utils/gateway/http/errors.ts`
- `server/utils/gateway/state/memory.ts`

Required async propagation:

- `server/middleware/auth.ts`
- `server/api/auth/dataops.post.ts`
- `server/api/auth/logout.post.ts`
- `server/api/admin/runtimes/index.get.ts`
- `server/api/config/notifications.post.ts`
- `server/api/config/pet.post.ts`
- `server/api/config/pinned-threads.post.ts`
- `server/api/config/sync.post.ts`
- `server/api/hosts/[id].delete.ts`
- `server/api/hosts/[id].patch.ts`
- `server/api/hosts/index.post.ts`
- `server/api/projects/[id].delete.ts`
- `server/api/projects/[id].patch.ts`
- `server/api/projects/index.post.ts`
- `server/api/threads/archive.post.ts`
- `server/api/threads/delete.post.ts`
- `server/api/threads/rename.post.ts`
- `server/tasks/gateway/prune-expired-sessions.ts`
- `server/utils/gateway/realtime/handlers/auth.ts`
- `server/utils/gateway/scheduled-tasks/expired-session-cleanup.ts`
- `server/utils/gateway/thread-titles/projection.ts`
- `server/utils/gateway/thread-titles/service.ts`
- `server/utils/gateway/runtime/host-runtime-supervisor.ts`
- `server/utils/gateway/runtime-manager/runtime-service.ts`
- `server/utils/gateway/tmux-monitor/poll-coordinator.ts`

Tests:

- `server/utils/gateway/auth/user-repository.test.ts`
- `server/utils/gateway/auth/session-repository.test.ts`
- `server/utils/gateway/auth/external-identities.test.ts`
- `server/utils/gateway/auth/context.test.ts`
- `server/utils/gateway/config/user-config-repository.test.ts`
- `server/utils/gateway/config/user-config-mutation-service.test.ts`
- `server/utils/gateway/http/config-mutation.test.ts`
- `server/utils/gateway/http/errors.test.ts`
- `server/utils/gateway/runtime/host-runtime-supervisor.test.ts`
- `server/utils/gateway/runtime-manager/runtime-service.test.ts`
- `server/utils/gateway/runtime-manager/runtime-routes.test.ts`
- `server/api/auth/dataops.post.test.ts`
- `server/utils/gateway/realtime/connection.test.ts`

The narrow files beyond the original Task 3 list are direct async callers approved by the
controller: logout, realtime auth, expired-session task wrappers, thread rename/title service,
runtime route tests, and the tmux poll coordinator's config-only host lookup. No tmux repository or
other tmux persistence was converted.

## Behavior RED Evidence

All real-MySQL runs used the authorized CentOS host and the isolated source directory
`/tmp/codex-gateway-task3-PCxxIR`. No command accessed `/opt/codex-gateway` or a production
container.

Initial command, before repository implementation:

```text
bash tests/mysql/run-in-containers.sh pnpm exec vitest run \
  server/utils/gateway/auth/user-repository.test.ts \
  server/utils/gateway/auth/session-repository.test.ts \
  server/utils/gateway/auth/external-identities.test.ts \
  server/utils/gateway/config/user-config-repository.test.ts
```

Output:

```text
Test Files  4 failed (4)
Tests       11 failed (11)
```

The 11 collected tests failed on the missing async `createUserStore` contract and the old SQLite
`db.exec` transaction path. `user-repository.test.ts` separately collected zero tests because
`./user-repository` did not exist; that part is recorded only as setup evidence, not as the valid
behavior RED. The other three suites supplied the collected behavior RED in the same command.

Async propagation RED on local Windows Node `v24.17.0`:

```text
corepack pnpm exec vitest run \
  server/utils/gateway/auth/context.test.ts \
  server/utils/gateway/config/user-config-mutation-service.test.ts \
  server/utils/gateway/http/config-mutation.test.ts \
  server/utils/gateway/http/errors.test.ts \
  server/utils/gateway/runtime/host-runtime-supervisor.test.ts \
  server/utils/gateway/runtime-manager/runtime-service.test.ts
```

```text
Test Files  5 failed | 1 passed (6)
Tests       9 failed | 19 passed (28)
```

Failures showed Promise-valued auth context, a hidden database fallback in the synchronous guard,
non-awaited config load/commit, no memory revision, synchronous stored-config bootstrap, and a
Promise stored as the runtime username.

Single-flight config-load RED:

```text
corepack pnpm exec vitest run server/utils/gateway/http/errors.test.ts
Test Files  1 failed (1)
Tests       1 failed | 4 passed (5)
expected loadConfig to be called once, but got 2 times
```

Realtime caller RED after the async auth conversion:

```text
corepack pnpm exec vitest run server/utils/gateway/realtime/connection.test.ts
Test Files  1 failed (1)
Tests       1 failed (1)
expected close to be called once, but got 0 times
```

The root cause was the old test implicitly opening SQLite. Its boundary now explicitly returns an
async invalid-session result, which exercises the intended realtime rejection behavior.

## GREEN Evidence

Final focused real-MySQL command, from the formatted final tree:

```text
bash tests/mysql/run-in-containers.sh pnpm exec vitest run \
  server/utils/gateway/auth/user-repository.test.ts \
  server/utils/gateway/auth/session-repository.test.ts \
  server/utils/gateway/auth/external-identities.test.ts \
  server/utils/gateway/config/user-config-repository.test.ts

Test Files  4 passed (4)
Tests       14 passed (14)
Duration    17.20s
```

The brief-defined broad real-MySQL command passed:

```text
bash tests/mysql/run-in-containers.sh pnpm exec vitest run \
  server/utils/gateway/auth \
  server/utils/gateway/config \
  server/utils/gateway/http \
  server/utils/gateway/runtime/host-runtime-supervisor.test.ts \
  server/utils/gateway/runtime-manager/runtime-service.test.ts

Test Files  18 passed (18)
Tests       88 passed (88)
Duration    19.69s
```

The first broad attempt reached 87/88 and timed out one untouched Task 4 SQLite CLI test at five
seconds under parallel Argon load. That test passed alone at 3/3 in 2.13 seconds. Test fixtures that
did not exercise passwords were then changed to use fixed stored hashes through `UserRepository`;
the exact broad command subsequently passed 88/88 without changing Task 4 code or its timeout.

Final six-file propagation run:

```text
corepack pnpm exec vitest run \
  server/utils/gateway/auth/context.test.ts \
  server/utils/gateway/config/user-config-mutation-service.test.ts \
  server/utils/gateway/http/config-mutation.test.ts \
  server/utils/gateway/http/errors.test.ts \
  server/utils/gateway/runtime/host-runtime-supervisor.test.ts \
  server/utils/gateway/runtime-manager/runtime-service.test.ts

Test Files  6 passed (6)
Tests       30 passed (30)
```

Additional affected tests passed:

```text
server/api/auth/dataops.post.test.ts
server/utils/gateway/runtime-manager/runtime-routes.test.ts
server/utils/gateway/realtime/connection.test.ts
server/utils/gateway/auth/create-user-script.test.ts
```

## Transaction, Revision, and Concurrency Evidence

- User creation locks the guaranteed migration-1 row with `SELECT ... FOR UPDATE`, then assigns
  the first administrator and inserts the user in one transaction. Two concurrent first-user
  creates produced exactly one `admin` and one `user`.
- DataOps login uses one MySQL transaction for identity lookup/create, user role/display-name
  update, session creation, and external session context creation. Two concurrent first logins for
  one subject produced one user, one identity, two sessions, and two complete contexts.
- Initial config persistence uses `INSERT ... ON DUPLICATE KEY UPDATE` with
  `LAST_INSERT_ID(revision)` only as a duplicate discriminator and never overwrites the existing
  payload.
- Existing config persistence uses the required compare-and-swap update on `user_id + revision`.
  Zero affected rows are checked inside the same transaction and reported as typed `missing` or
  `stale` `config_revision_conflict` errors.
- The stale-write test proves the winner's revision and decrypted config remain unchanged after a
  losing write. HTTP maps the typed conflict to 409 and preserves the stable public code.
- MySQL `BIGINT` revisions are converted only when they are positive safe JavaScript integers;
  `9007199254740992` is rejected at the service/memory boundary.
- User-scoped memory stores `configRevision`. Mutation drafts are removed before the persistence
  await, restored on encryption/persistence/CAS failure, and installed with the returned revision
  before host or pinned-thread reconciliation is published.
- Initial async config loading is single-flight per user. Concurrent first requests issue one load,
  and a decryption/load rejection leaves memory unloaded and clears the flight so a later request
  can retry.

## Typecheck, Lint, Format, and Diff

Local runtime:

```text
node --version
v24.17.0
```

Final checks:

```text
corepack pnpm typecheck
exit 0

corepack pnpm typecheck:dependencies
all five workspace package checks Done; exit 0

corepack pnpm lint:ox
exit 0

oxfmt --check <all Task 3 TypeScript files>
All matched files use the correct format; exit 0

git diff --check
exit 0
```

The repository-wide `pnpm format:check` still exits 1 on three untouched baseline files:
`nuxt.config.ts`, `playwright.config.ts`, and `tailwind.config.ts`. They were not reformatted because
that would be unrelated churn. The complete Task 3 file set passes the same formatter check.

## Self-Review

- Converted domains call `gatewayMysqlDatabase()` only. `storage/database.ts` and
  `storage/migrations.ts` have no diff.
- Password/token generation, encryption/decryption, and `GatewayConfig` parsing remain in service
  code; repositories contain the domain SQL and row conversion.
- Authentication middleware awaits database authentication. `requireAuthenticatedUser`,
  `requireAdminUser`, and `requireDataOpsAdvancedSettingsAccess` are synchronous context-only guards
  and cannot query storage.
- Session expiry deletes the row before rejecting authentication. Logout and scheduled expiry
  publish revocations only for rows actually deleted.
- Every listed config mutation caller awaits the durable commit. Thread title projection and its
  callers also await pinned-thread persistence.
- Runtime supervisor bootstrap awaits stored configs and installs their revisions. Runtime admin
  listing awaits usernames and returns no Promise-valued fields.
- The controller-authorized tmux change only awaits the already-converted user config for host
  lookup. No tmux SQL or repository was changed.
- No Redis, multi-Gateway invalidation, node scheduling, provider/runtime store conversion, CLI
  migration, live SQLite deletion, production deployment, or unrelated refactor was added.
- `rg` and the successful root typecheck found no remaining synchronous callers of the converted
  auth/config APIs.

## Concerns

- This commit is intentionally not deployable. It temporarily splits converted MySQL domains from
  provider/runtime/tmux and other SQLite persistence until Tasks 4-7 complete the cutover.
- Per controller ruling, `session-activity-tracker.ts` remains the temporary SQLite ancillary
  `last_seen_at` writer; Task 6 owns its MySQL/coalescing conversion. Its file content is unchanged.
- Host supervisor startup still uses the existing SQLite readiness callback; Task 7 owns final
  MySQL startup ordering and pool shutdown. This task only makes stored-config bootstrap awaitable.
- The full repository formatter has the three untouched baseline failures listed above; all Task 3
  files are formatted.

## Fix Round 1: Preserve Transient State and Serialize Remote Config Boundaries

### Blocking Findings Addressed

1. Async config load/save used a whole-state replacement created before the database await. Events,
   thread snapshots, event IDs, and notification bookkeeping written while persistence was pending
   could be silently discarded.
2. Thread delete/archive/rename and automatic title updates performed their remote side effect
   outside the per-user config mutex. Another same-user config mutation could commit between the
   remote operation and its config save, making the completed remote operation lose CAS.

The two deferred Minor findings about inactive expired-session cleanup and an empty config row's
revision were intentionally not changed.

### Files Changed in Fix Round 1

- `server/utils/gateway/state/memory.ts`
- `server/utils/gateway/config/user-config-mutation-service.ts`
- `server/utils/gateway/config/user-config-mutation-service.test.ts`
- `server/utils/gateway/http/errors.ts`
- `server/utils/gateway/http/errors.test.ts`
- `server/utils/gateway/http/config-mutation.ts`
- `server/utils/gateway/http/config-mutation.test.ts`
- `server/utils/gateway/runtime/host-runtime-supervisor.ts`
- `server/api/threads/delete.post.ts`
- `server/api/threads/archive.post.ts`
- `server/api/threads/rename.post.ts`
- `server/utils/gateway/thread-titles/service.ts`

### Fix Round RED Evidence

Tests were written before the implementation changes and used deferred Promises so transient state
and competing operations changed while the target await was unresolved.

```text
corepack pnpm exec vitest run \
  server/utils/gateway/config/user-config-mutation-service.test.ts \
  server/utils/gateway/http/errors.test.ts \
  server/utils/gateway/http/config-mutation.test.ts

Test Files  3 failed (3)
Tests       3 failed | 10 passed (13)
```

The save regression failed because the post-save state was a different object and had empty
`events`, `threadSnapshots`, and notification keys plus the old process event counter. The load
regression lost the event, notification key, and updated `nextEventId`. The remote-boundary test
failed with `withUserConfigLock is not implemented`. All 13 tests collected; there was no missing
module or zero-test setup failure.

### Implementation

`applyGatewayConfigToMemoryState(state, config, revision)` now applies only the durable fields to
the latest live user state:

```text
hosts
projects
configuredProjectIds
pinnedThreads
notifications
pet
configLoaded
configRevision
```

It deliberately preserves all transient fields, including thread metadata/snapshots, sub-agent
state, events, cursor/epoch state, `nextEventId`, and notification delivery bookkeeping. Config
load, config commit, and stored-user supervisor bootstrap use this helper instead of replacing the
whole state after an await. Config commit retains the pre-apply host and pinned-thread array
references only for post-commit reconciliation comparisons.

`withUserConfigLock(userId, operation)` exposes the existing in-process, user-keyed mutex. It now
guards:

- ordinary and advanced config mutation handlers;
- thread delete from remote delete through pinned-config commit;
- thread archive from remote archive through pinned-config commit;
- manual rename from remote rename through title projection/config commit;
- automatic title rename from remote rename through title projection/config commit.

Different users continue independently. The locked callbacks call `commit`, `unpinThread`, or
`updatePinnedThreadTitle`, none of which acquire the mutex themselves, so the new call graph is not
recursively locking.

### Fix Round GREEN Evidence

Focused regression command:

```text
corepack pnpm exec vitest run \
  server/utils/gateway/config/user-config-mutation-service.test.ts \
  server/utils/gateway/http/errors.test.ts \
  server/utils/gateway/http/config-mutation.test.ts

Test Files  3 passed (3)
Tests       13 passed (13)
```

Affected config and title behavior:

```text
corepack pnpm exec vitest run \
  server/utils/gateway/config/user-config-mutation-service.test.ts \
  server/utils/gateway/http/errors.test.ts \
  server/utils/gateway/http/config-mutation.test.ts \
  server/utils/gateway/thread-titles/service.test.ts

Test Files  4 passed (4)
Tests       18 passed (18)
```

Final Task 3 propagation and title suites:

```text
corepack pnpm exec vitest run \
  server/utils/gateway/auth/context.test.ts \
  server/utils/gateway/config/user-config-mutation-service.test.ts \
  server/utils/gateway/http/config-mutation.test.ts \
  server/utils/gateway/http/errors.test.ts \
  server/utils/gateway/runtime/host-runtime-supervisor.test.ts \
  server/utils/gateway/runtime-manager/runtime-service.test.ts \
  server/utils/gateway/thread-titles/service.test.ts

Test Files  7 passed (7)
Tests       38 passed (38)
```

Real MySQL 8.4 repository regression on the authorized isolated CentOS harness:

```text
bash tests/mysql/run-in-containers.sh pnpm exec vitest run \
  server/utils/gateway/auth/user-repository.test.ts \
  server/utils/gateway/auth/session-repository.test.ts \
  server/utils/gateway/auth/external-identities.test.ts \
  server/utils/gateway/config/user-config-repository.test.ts

Test Files  4 passed (4)
Tests       14 passed (14)
Duration    14.35s
```

Static verification:

```text
corepack pnpm typecheck
exit 0

corepack pnpm exec oxfmt --check <12 fix-round TypeScript files>
All matched files use the correct format; exit 0

git diff --check
exit 0
```

### Fix Round Self-Review and Concerns

- Deferred save/load tests prove both persisted config and concurrent transient changes survive on
  the same latest live state object.
- Persistence failure and stale CAS still leave the prior live config/revision installed and do not
  publish runtime reconciliation.
- Config-load single-flight retry behavior remains covered and green.
- `rg` confirms every direct config commit/unpin/title update is inside either a config handler's
  shared lock or one of the explicit thread/background critical sections.
- Locks remain process-local and user-scoped; no Redis or multi-Gateway invalidation was added.
- A CAS conflict caused by a separate active Gateway remains outside this single-Gateway milestone.
- The checkpoint remains intentionally non-deployable, with the same Task 3 concerns documented
  above.
