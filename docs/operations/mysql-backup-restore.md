# MySQL Backup and Restore

This runbook covers Gateway business data in MySQL 8. It does not back up Agent files or execution
state. In particular, a database backup does **not** back up `/workspace`, `/codex-home`, Runtime
Manager's local nonce database, or node-local/named Docker volumes for Agents. Back those up under a
separate, node-storage policy.

## Backup policy

Define and record an RPO, RTO, full-backup cadence, retention period, encryption policy, and off-host
destination. Keep at least one backup outside the MySQL host and Docker volume. Monitor both backup
age and binary-log continuity.

The backup identity should have only the privileges required by `mysqldump`. Put credentials in a
root-readable MySQL option file or secret mount, never in command arguments:

```ini
[client]
host=mysql.example.internal
port=3306
user=codex_gateway_backup
password=<from-secret-store>
ssl-mode=VERIFY_IDENTITY
ssl-ca=/run/secrets/mysql-ca.pem
```

Use `chmod 0600` and a short-lived path such as `/run/secrets/codex-gateway-backup.cnf`. Disable shell
tracing before handling it.

## Consistent full backup

For InnoDB tables, use one repeatable snapshot without taking Gateway offline:

```bash
set +x
umask 077
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR=/var/backups/codex-gateway/mysql/$STAMP
install -d -m 0700 "$BACKUP_DIR"

mysqldump \
  --defaults-extra-file=/run/secrets/codex-gateway-backup.cnf \
  --single-transaction \
  --quick \
  --hex-blob \
  --routines \
  --triggers \
  --events \
  --source-data=2 \
  --set-gtid-purged=OFF \
  codex_gateway \
  > "$BACKUP_DIR/codex_gateway.sql"

gzip -9 "$BACKUP_DIR/codex_gateway.sql"
sha256sum "$BACKUP_DIR/codex_gateway.sql.gz" > "$BACKUP_DIR/codex_gateway.sql.gz.sha256"
```

`--single-transaction` is mandatory. Do not add `--lock-all-tables`; all Gateway business tables are
InnoDB. Treat the dump and checksum as sensitive because encrypted blobs, password hashes, session
hashes, and identity mappings remain security-sensitive even without plaintext credentials.

Encrypt the artifact using the organization's backup key, then copy it to the approved off-host
store. Verify the remote size and cryptographic checksum before declaring the backup complete. A
Docker named volume on the same host is not an off-host backup.

## Binary logs and point-in-time recovery

Enable MySQL binary logging before relying on point-in-time recovery. Set
`binlog_expire_logs_seconds` long enough to cover the oldest retained full backup plus the maximum
recovery window. Confirm daily that:

- `log_bin` is `ON`;
- the dump contains `-- CHANGE REPLICATION SOURCE TO ...` coordinates from `--source-data=2`;
- every binlog from those coordinates through the present is retained and copied off-host;
- server ID, UTC clock, disk capacity, and purge alarms are healthy.

Copy closed binlog files and the current index to encrypted off-host storage without exposing MySQL
credentials. Never purge logs until a newer full backup and its restore test have passed. For a
point-in-time restore, load the full dump first, then replay only the required interval with
`mysqlbinlog`; stop before the bad transaction or at the approved UTC timestamp.

## Scheduled restore test

Every backup cycle must include, or be sampled by, a restore into a new temporary database. Never
restore over production as a test.

```bash
set +x
RESTORE_DB=codex_gateway_restore_$(date -u +%Y%m%d%H%M%S)
mysql --defaults-extra-file=/run/secrets/codex-gateway-restore-admin.cnf \
  --execute="CREATE DATABASE \`$RESTORE_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin"

gunzip -c /secure/restore-input/codex_gateway.sql.gz | \
  mysql --defaults-extra-file=/run/secrets/codex-gateway-restore-admin.cnf "$RESTORE_DB"
```

Verify the temporary target before deletion:

- all current `schema_migrations` versions and checksums are present;
- counts for all 11 business tables match the backup manifest;
- primary-key manifests, foreign-key orphan checks, and unique relationships pass;
- sampled `user_configs` and provider keys decrypt with the restored
  `CODEX_GATEWAY_CONFIG_SECRET` without printing plaintext;
- a cold Gateway can start against the temporary database and complete the smoke checks below.

Drop only the exact temporary database after recording the test result:

```bash
mysql --defaults-extra-file=/run/secrets/codex-gateway-restore-admin.cnf \
  --execute="DROP DATABASE \`$RESTORE_DB\`"
unset RESTORE_DB
```

## Cold Gateway recovery

1. Fence or stop the old active Gateway. Confirm it cannot accept traffic or write MySQL. Never run
   active and cold Gateway instances concurrently in this milestone.
2. Restore the required MySQL full backup and, when needed, replay binlogs to the approved point.
3. Restore the exact release image, Compose files, external database CA/configuration, and secrets.
   `CODEX_GATEWAY_CONFIG_SECRET` must match the encrypted rows. Restore the same runtime identity and
   Runtime Manager shared secret; do not generate replacements during recovery.
4. Start only `database-migrate`. It must validate or advance schema checksums successfully.
5. Start the cold Gateway with public and DataOps entries still disabled.
6. Smoke-test password login, DataOps SSO, providers/models/grants, one existing runtime record,
   audit reads, tmux-monitor reads, and database/Gateway health. Do not reprovision existing Agents
   as a database smoke test.
7. Confirm `/workspace` and `/codex-home` are available from their separately restored node storage.
   MySQL recovery cannot reconstruct either directory.
8. Only after the old Gateway is fenced and all checks pass, switch the reverse proxy and DataOps
   entry to the cold Gateway. Record the recovery point and first new write.

If verification fails, keep the entry closed. Diagnose or repeat the restore in another temporary
database; do not make ad hoc changes to the only restored copy.

## Secret and artifact handling

- Back up `CODEX_GATEWAY_CONFIG_SECRET`, runtime identity/shared secrets, database TLS trust, image
  digests, and Compose overrides in the approved secret/configuration system.
- Store database credentials separately from encrypted database dumps.
- Never print `DATABASE_URL`, option-file contents, bearer/session tokens, decrypted provider keys,
  or decrypted user configuration in backup logs.
- Restrict local artifacts to the backup account, encrypt before off-host transfer, and document
  retention/destruction.
- A successful SQL restore is not a complete platform recovery until the independent Agent
  `/workspace` and `/codex-home` backups have also been verified.
