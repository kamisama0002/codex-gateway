# Task 2 Report: MySQL Schema Migrations

## Files Changed

- `server/utils/gateway/storage/mysql-schema.ts`: versioned MySQL 8/InnoDB DDL for the 11 business tables.
- `server/utils/gateway/storage/mysql-migrations.ts`: named-lock migration runner and SHA-256 checksum validation.
- `server/utils/gateway/storage/mysql-migrations.test.ts`: real-MySQL concurrent, checksum, schema, uniqueness, and cascade coverage.
- `scripts/database/migrate.mjs`: separately invoked production migration CLI.
- `package.json`: `db:migrate` command.
- `Dockerfile`: bundled migration CLI in the runtime image.

The existing SQLite `database.ts` and `migrations.ts` were not changed.

## TDD Evidence

Initial setup RED was run on the authorized CentOS 10 host in the isolated project
`/tmp/codex-gateway-task2-w8hbnv`:

```bash
tests/mysql/run-in-containers.sh pnpm exec vitest run server/utils/gateway/storage/mysql-migrations.test.ts
```

It exited 1 with `Cannot find module './mysql-migrations' imported from ...mysql-migrations.test.ts`.
That run collected zero tests, so it is setup evidence only, not the valid behavior RED.

The valid behavior RED used the same exact command after all three tests collected. I temporarily
disabled only the checksum mismatch branch, ran the command, and restored the branch without committing
the mutation. Output was:

```text
Test Files  1 failed (1)
Tests  1 failed | 2 passed (3)
rejects a changed checksum for an applied migration
AssertionError: promise resolved "undefined" instead of rejecting
```

This demonstrated the checksum test fails for the intended behavioral reason.

Final GREEN command, also run in the isolated CentOS project:

```bash
tests/mysql/run-in-containers.sh pnpm exec vitest run server/utils/gateway/storage/mysql-migrations.test.ts
```

Output:

```text
Test Files  1 passed (1)
Tests  3 passed (3)
```

## Schema Invariants Checked

- Two concurrent migration runners create exactly 12 tables (11 business tables plus `schema_migrations`).
- Applied migration checksums reject a modified stored checksum.
- Numeric primary keys use `INT UNSIGNED`; `user_configs.revision` is `BIGINT UNSIGNED NOT NULL DEFAULT 1`.
- `sessions.user_id` has native `ON DELETE CASCADE`.
- `tmux_monitors` has `uq_tmux_active_location`; duplicate active locations are rejected and deleting the user removes the monitor through native cascade.
- The active-location implementation follows the controller ruling: nullable generated
  `active_marker = IF(status = 'active', 1, NULL)` with a composite unique key over user/location/marker.
  This is a deliberate deviation from the original single generated concatenation key because MySQL 8
  rejects `ON DELETE CASCADE` when the FK child column is directly referenced by a generated column.

## CLI and Image

`pnpm db:migrate` was run without `DATABASE_URL`. It resolved all CLI modules and returned only
`DATABASE_URL is required` with exit 1, without exposing credentials. The Dockerfile bundles the same
script with the existing esbuild pattern.

## Type Checks and Diff

`pnpm typecheck:dependencies` locally reported all five workspace typecheck tasks as `Done`, but the
desktop bridge ended at 30 seconds before emitting an exit status. Local `pnpm typecheck` likewise began
under Node 24 but exceeded that bridge window. An isolated CentOS verification then found and the code
fixed this concrete root type error:

```text
server/utils/gateway/storage/mysql-migrations.ts(33,47): error TS2344:
Type 'AppliedMigration' does not satisfy the constraint 'DbRow'.
```

After `AppliedMigration extends DbRow`, the isolated dependency typecheck completed all packages and
root `nuxt typecheck && vue-tsc -p tests/e2e/tsconfig.json --noEmit` remained running with no output or
exit marker at the controller-mandated stop point. That host is Node 22 while the workspace requires
Node >=24, so it is not a valid production-runtime confirmation. `git diff --check` passed with no
whitespace errors; Git printed only CRLF conversion warnings for Windows working-copy files.

## Self-Review

- The runner acquires/releases `GET_LOCK('codex_gateway_schema_migrate', 30)` in one `GatewayDb`
  transaction/connection and releases in `finally`.
- Unknown applied versions and every persisted checksum mismatch fail before pending DDL executes.
- The runner is import-safe: it runs only when the CLI invokes it, not from HTTP or module import.
- CLI errors are generic and the pool is closed in `finally`.
- No SQLite files or unrelated upstream pet changes were modified.

## Concerns

- Final root typecheck proof is incomplete because the local desktop bridge cuts long foreground commands
  at 30 seconds and the isolated CentOS host is Node 22. No type error remains after the targeted
  `DbRow` fix, but a Node 24 full root-typecheck exit status still needs capture before claiming that
  gate passes.

## Node 24 Follow-Up

The shared Windows worktree was confirmed to use Node `v24.17.0`; the repository-pinned pnpm was invoked
through Corepack rather than the system pnpm 9 installation.

```bash
corepack pnpm typecheck
```

Initial output was:

```text
$ nuxt typecheck && vue-tsc -p tests/e2e/tsconfig.json --noEmit
```

The desktop bridge returned at its 30-second boundary without a session ID. Process inspection showed the
same invocation's `nuxt typecheck` and `vue-tsc -b --noEmit` child processes, then both and the Corepack
wrapper exited with no diagnostics printed.

```bash
corepack pnpm typecheck:dependencies
```

Output reached all five workspace projects: `agent-runtime-contracts`, `gateway-browser-runtime`,
`gateway-ui`, `agent-runtime-manager`, and `gateway-ai-elements`; all emitted `Done` where their output
was printed. Its remaining compiler processes then exited with no diagnostics. The bridge again supplied
no session ID or final wrapper exit code. `git diff --check --cached` passed before commit, with only
Windows CRLF conversion warnings from Git.

Committed with subject `feat(storage): add mysql schema migrations`.

## Fix Round 1: Binary Semantics, Retryable DDL, and Defaults

New real-MySQL tests were written before the implementation changes and run on the authorized CentOS 10
host in the same isolated `/tmp/codex-gateway-task2-w8hbnv` project:

```bash
tests/mysql/run-in-containers.sh pnpm exec vitest run server/utils/gateway/storage/mysql-migrations.test.ts
```

Valid RED output collected all five tests and failed two:

```text
Tests  2 failed | 3 passed (5)
Field 'created_at' doesn't have a default value
MySQL schema migration 2 statement 1 failed
Caused by: Duplicate check constraint name 'chk_users_role'.
```

The implementation changes use `utf8mb4_0900_bin` on each business table, add MySQL expression defaults
using `DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%fZ')` for the SQLite-defaulted user/session/config
timestamps, and query `information_schema` to skip only the already-existing migration-2 role DDL and
migration-7 index DDL. Migration 2's data update still executes after its DDL skip.

GREEN used the same command and completed with:

```text
Test Files  1 passed (1)
Tests  5 passed (5)
```

The new tests prove case-distinct user/provider/model/external identifiers coexist, `ACTIVE` is rejected
for the lowercase status check, omitted user/session/config timestamps become non-empty parseable UTC values,
and removing migration rows 2 and 7 after their DDL exists is recovered with one row per migration version.

Local Node `v24.17.0` verification used:

```bash
corepack pnpm typecheck
corepack pnpm typecheck:dependencies
git diff --check
```

The root command ran Nuxt then the E2E `vue-tsc` child; both and the Corepack wrapper exited without
diagnostics. The dependency command completed all five workspace package checks without diagnostics.
The desktop bridge again did not return a session identifier or final wrapper exit code for the long root
command, but process observation confirmed the same invocation's compiler children terminated cleanly.
