import { createHash } from "node:crypto";
import type { DbRow, GatewayDb } from "./contracts";
import { MYSQL_SCHEMA_MIGRATIONS, type MysqlSchemaMigration } from "./mysql-schema.ts";

const MIGRATION_LOCK_NAME = "codex_gateway_schema_migrate";
const MIGRATION_LOCK_TIMEOUT_SECONDS = 30;

interface AppliedMigration extends DbRow {
  version: number;
  checksum: string;
}

export async function migrateMysqlGatewayDatabase(db: GatewayDb): Promise<void> {
  await db.transaction(async (tx) => {
    const lock = await tx.one<{ acquired: number | null }>("SELECT GET_LOCK(?, ?) AS acquired", [
      MIGRATION_LOCK_NAME,
      MIGRATION_LOCK_TIMEOUT_SECONDS,
    ]);
    if (lock?.acquired !== 1) {
      throw new Error("Timed out acquiring the MySQL schema migration lock");
    }

    try {
      await tx.execute(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INT UNSIGNED NOT NULL,
          checksum CHAR(64) NOT NULL,
          applied_at VARCHAR(32) NOT NULL,
          PRIMARY KEY (version)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
      `);

      const appliedMigrations = await tx.many<AppliedMigration>(
        "SELECT version, checksum FROM schema_migrations ORDER BY version ASC",
      );
      validateAppliedMigrationChecksums(appliedMigrations);
      const appliedVersions = new Set(appliedMigrations.map((migration) => migration.version));

      for (const migration of MYSQL_SCHEMA_MIGRATIONS) {
        if (appliedVersions.has(migration.version)) {
          continue;
        }
        for (const [statementIndex, statement] of migration.statements.entries()) {
          if (await migrationStatementAlreadyApplied(tx, migration.version, statementIndex)) {
            continue;
          }
          try {
            await tx.execute(statement);
          } catch (error) {
            throw new Error(
              `MySQL schema migration ${migration.version} statement ${statementIndex + 1} failed`,
              { cause: error },
            );
          }
        }
        await tx.execute(
          "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)",
          [migration.version, migrationChecksum(migration), new Date().toISOString()],
        );
      }
    } finally {
      await tx.one("SELECT RELEASE_LOCK(?) AS released", [MIGRATION_LOCK_NAME]);
    }
  });
}

async function migrationStatementAlreadyApplied(
  db: GatewayDb,
  version: number,
  statementIndex: number,
): Promise<boolean> {
  if (version === 2 && statementIndex === 0) {
    const roleColumn = await db.one(
      "SELECT 1 AS exists_row FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'role'",
    );
    const roleConstraint = await db.one(
      "SELECT 1 AS exists_row FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'users' AND constraint_name = 'chk_users_role'",
    );
    return roleColumn !== null && roleConstraint !== null;
  }
  if (version === 7 && statementIndex === 0) {
    return (
      (await db.one(
        "SELECT 1 AS exists_row FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'model_providers' AND index_name = 'idx_model_providers_enabled'",
      )) !== null
    );
  }
  return false;
}

function validateAppliedMigrationChecksums(appliedMigrations: readonly AppliedMigration[]): void {
  const migrationsByVersion = new Map(
    MYSQL_SCHEMA_MIGRATIONS.map((migration) => [migration.version, migration]),
  );
  for (const appliedMigration of appliedMigrations) {
    const migration = migrationsByVersion.get(appliedMigration.version);
    if (migration === undefined) {
      throw new Error(`Unknown applied MySQL schema migration ${appliedMigration.version}`);
    }
    if (appliedMigration.checksum !== migrationChecksum(migration)) {
      throw new Error(`MySQL schema migration ${appliedMigration.version} checksum mismatch`);
    }
  }
}

function migrationChecksum(migration: MysqlSchemaMigration): string {
  return createHash("sha256").update(migration.statements.join("\n")).digest("hex");
}
