# SQLite to MySQL Cutover

This runbook moves one active Codex Gateway from the legacy SQLite v8 database to MySQL 8. It does
not introduce dual writes. Schedule a maintenance window, name one operator, and keep the old
Gateway image and frozen SQLite database until the post-cutover retention period ends.

## Preconditions

- The exact release image has passed unit, real-MySQL, full E2E, lint, and build gates.
- MySQL 8 is reachable from the Gateway host, uses UTC and `utf8mb4`, and has an empty target
  database owned by a least-privileged application user.
- The existing `CODEX_GATEWAY_CONFIG_SECRET` and `RUNTIME_MANAGER_SHARED_SECRET` are available from
  the production secret store. Do not rotate either secret during this cutover.
- Docker Compose supports the `!reset` and `!override` tags used by
  `docker-compose.external-db.yml` (Compose 2.24.4 or newer).
- A tested rollback artifact contains the old Gateway image and Compose files.
- Operators have a known password-admin login and a one-time DataOps ticket flow for smoke tests.

For a managed external database, use all three files in this order:

```bash
cd /opt/codex-gateway
COMPOSE=(docker compose \
  -f /opt/codex-gateway/docker-compose.yml \
  -f /opt/codex-gateway/docker-compose.external-db.yml \
  -f /opt/codex-gateway/docker-compose.override.yml)
```

For bundled MySQL, omit `docker-compose.external-db.yml`. Never print `docker compose config` from
a production shell because the rendered model contains secrets.

## 1. Stop all writes

1. Put the public entry and DataOps ticket issuer into maintenance mode. Confirm that no load
   balancer, job, administrator CLI, or alternate Gateway can write the database.
2. Stop only Gateway. Runtime Manager and existing Agent containers do not need to be stopped.
3. Confirm the Gateway container is stopped and no `user:create` or database job is running.

```bash
cd /opt/codex-gateway
docker compose \
  -f docker-compose.yml \
  -f docker-compose.override.yml \
  stop codex-gateway
docker compose \
  -f docker-compose.yml \
  -f docker-compose.override.yml \
  ps codex-gateway
```

Do not continue until writes are quiesced. Record the maintenance start time and the old image ID.

## 2. Make a consistent SQLite online backup

Do not use `cp codex-gateway.db`. A database in WAL mode can have committed data in
`codex-gateway.db-wal`; copying only the `.db` file is not a consistent snapshot. Use SQLite's
online backup API even though writes are already stopped.

```bash
set +x
umask 077
SOURCE_DIR=/opt/codex-gateway/data
SNAPSHOT_DIR=/var/backups/codex-gateway/cutover-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$SNAPSHOT_DIR"

docker compose \
  -f /opt/codex-gateway/docker-compose.yml \
  -f /opt/codex-gateway/docker-compose.override.yml \
  run --rm --no-deps \
  -v "$SOURCE_DIR:/source:ro" \
  -v "$SNAPSHOT_DIR:/snapshot" \
  -e SOURCE_DB=/source/codex-gateway.db \
  -e BACKUP_DB=/snapshot/codex-gateway.sqlite \
  codex-gateway node --input-type=module - <<'NODE'
import { backup, DatabaseSync } from "node:sqlite";

const source = new DatabaseSync(process.env.SOURCE_DB, { readOnly: true });
try {
  await backup(source, process.env.BACKUP_DB);
} finally {
  source.close();
}
NODE
```

The source mount is read-only and the destination is a new restricted directory. Preserve the live
database and its WAL/SHM files in place; never edit or delete them during cutover.

## 3. Validate and fingerprint the snapshot

Run `PRAGMA quick_check` against the backup, not the live path, and require the single result `ok`.

```bash
docker compose \
  -f /opt/codex-gateway/docker-compose.yml \
  -f /opt/codex-gateway/docker-compose.override.yml \
  run --rm --no-deps \
  -v "$SNAPSHOT_DIR:/snapshot:ro" \
  -e BACKUP_DB=/snapshot/codex-gateway.sqlite \
  codex-gateway node --input-type=module - <<'NODE'
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(process.env.BACKUP_DB, { readOnly: true });
try {
  const rows = db.prepare("PRAGMA quick_check").all();
  if (rows.length !== 1 || rows[0].quick_check !== "ok") {
    throw new Error("SQLite snapshot quick_check failed");
  }
  console.log("SQLite snapshot quick_check: ok");
} finally {
  db.close();
}
NODE

sha256sum "$SNAPSHOT_DIR/codex-gateway.sqlite" | tee "$SNAPSHOT_DIR/sha256.txt"
```

Stop if the backup or check fails. Do not substitute a raw file copy.

## 4. Build and migrate the empty MySQL target

Load `DATABASE_URL` through the production secret mechanism with shell tracing disabled. Do not put
it on a command line, in shell history, or in a committed file.

```bash
set +x
"${COMPOSE[@]}" build codex-gateway
"${COMPOSE[@]}" run --rm database-migrate
```

The migration command must report the current schema version. A failure leaves Gateway stopped;
diagnose MySQL connectivity or migration checksums before continuing.

## 5. Dry-run, import, and verify

The dry-run reads and validates every SQLite row, performs the complete import inside a MySQL
transaction, verifies it, and rolls the transaction back. The real import refuses a non-empty target.

```bash
"${COMPOSE[@]}" run --rm --no-deps \
  -v "$SNAPSHOT_DIR:/snapshot:ro" \
  codex-gateway node scripts/database/import-sqlite.mjs \
  --source /snapshot/codex-gateway.sqlite --dry-run

"${COMPOSE[@]}" run --rm --no-deps \
  -v "$SNAPSHOT_DIR:/snapshot:ro" \
  codex-gateway node scripts/database/import-sqlite.mjs \
  --source /snapshot/codex-gateway.sqlite

"${COMPOSE[@]}" run --rm --no-deps \
  -v "$SNAPSHOT_DIR:/snapshot:ro" \
  codex-gateway node scripts/database/verify-import.mjs \
  --source /snapshot/codex-gateway.sqlite
```

Save the three secret-safe reports. Require matching table counts and manifests, valid foreign keys
and uniqueness, decryptable sampled configuration/provider blobs, and a final pass result. Do not
continue on any mismatch, and do not retry a real import into a partially populated target. Drop and
recreate only the target database after investigating the cause.

Before starting a write-capable Gateway, preserve this exact pristine post-import state:

1. Keep the verified SQLite snapshot read-only and retain its SHA-256 file. This remains the source
   for every cutover retry.
2. Store the import and independent verification reports off-host with the release and snapshot
   identifiers.
3. Follow the [backup and restore runbook](mysql-backup-restore.md) to capture a post-import,
   pre-smoke MySQL backup and binlog position. Label it as the pristine verification point and do not
   replace it with a backup taken after smoke writes.

## 6. Start cold and smoke-test before switching entry

This step crosses the technical MySQL-write boundary for the current target. Starting Gateway makes
the database write-capable; password login inserts a session, and DataOps login can update users,
external identities, sessions, and external session contexts. From this point, do not treat the live
MySQL target as the pristine import result recorded in step 5.

Keep the public entry, ordinary DataOps ticket issuance, and every other external writer in
maintenance mode. Only the named operator's private endpoint and controlled one-time smoke ticket
may reach Gateway. Start Gateway against MySQL and confirm the one-shot migration completed
successfully.

```bash
"${COMPOSE[@]}" up -d codex-gateway
"${COMPOSE[@]}" ps mysql database-migrate codex-gateway
"${COMPOSE[@]}" logs --no-color --tail=100 database-migrate codex-gateway
```

With `set +x`, capture credentials and bearer tokens only in shell variables. Do not echo response
bodies or tokens. Verify all of the following through the private/pre-entry endpoint:

- password login and `/api/auth/me` for a known administrator;
- one-time DataOps SSO and `/api/auth/me` for the mapped user;
- `/api/admin/providers` returns the expected provider/model inventory without decrypted keys;
- `/api/admin/runtimes` contains at least one expected existing runtime record;
- `/api/tmux/monitors` returns successfully for an imported user with known access;
- MySQL read-only count checks for `agent_audit_events` and `tmux_monitors` match the import report;
- the Gateway healthcheck remains healthy and no database/startup errors appear in logs.

These private smoke writes are controlled and disposable. They do not authorize public traffic and
must never be merged into another target or accepted as part of the imported source state.

If any private smoke check fails:

1. Keep the public and DataOps entries blocked and stop the smoke Gateway.
2. Preserve secret-safe failure logs, but discard the entire smoke-written MySQL target.
3. Recreate an empty target, run schema migration, and import again from the same verified read-only
   SQLite snapshot retained in step 5.
4. Run independent verification again and create a new pristine post-import recovery point before
   repeating any smoke check.

Never selectively delete, merge, or trust partial smoke writes. Only after every private smoke check
succeeds may the operator continue to the public/DataOps entry switch.

Do not restart or reprovision an Agent merely to validate database cutover. Runtime Manager and
workspace/codex-home data are outside this migration.

## 7. Switch the entry and cross the production rollback boundary

1. Confirm every private smoke check passed and the pristine post-import MySQL recovery point,
   read-only SQLite snapshot, and verification reports remain preserved.
2. Take a separate post-smoke MySQL backup and record its binlog position for forward recovery.
3. Switch the reverse proxy/load balancer and re-enable ordinary DataOps ticket issuance.
4. Record the entry-open timestamp and the first externally initiated business write accepted by
   MySQL. Watch login, provider, runtime, audit, and tmux requests as production traffic begins.

Schema migration and the controlled import do not move the rollback boundary because the old SQLite
database remains frozen and no new production state exists only in MySQL. The boundary is crossed as
soon as the public/DataOps entry opens or the first externally initiated business write reaches
MySQL, whichever occurs first. Do not wait for telemetry to prove a first write after opening entry;
assume one can race immediately. Business writes include a session, activity timestamp, config
revision, audit event, runtime state, provider change, or tmux monitor.

**After the public/DataOps entry opens or the first external MySQL business write, direct rollback to
SQLite is forbidden.** Use a forward fix or restore MySQL from backup plus binlogs. A reverse export
is allowed only if a separately reviewed and rehearsed tool preserves all post-cutover data; this
release does not provide such a tool.

## Recovery before the public entry boundary

Private smoke writes cross the technical boundary for that MySQL target, but remain disposable while
all public and DataOps entry paths are blocked. Before opening entry, choose one complete recovery
path rather than reconciling databases:

- To retry MySQL cutover, stop Gateway, discard and recreate the exact target, migrate, re-import the
  same verified read-only SQLite snapshot, independently verify it, preserve a new pristine recovery
  point, and repeat the private smoke sequence.
- To abandon cutover, stop Gateway, discard the smoke-written MySQL target, restore the old Gateway
  image/Compose artifact with the original secrets, and start it against the untouched frozen SQLite
  database. Smoke-test the old path privately before restoring its entry.

Never merge partial smoke writes into a rebuilt target, copy the snapshot over the live database
while any old Gateway process is running, or roll back only the application binary after the
public/DataOps entry boundary has been crossed.
