import { createHash } from "node:crypto";
import type { DbRow, GatewayDb } from "./contracts";
import { MYSQL_SCHEMA_MIGRATIONS, type MysqlSchemaMigration } from "./mysql-schema.ts";

export interface AppliedMysqlMigration extends DbRow {
  version: number;
  checksum: string;
}

export async function validateMysqlGatewaySchema(db: GatewayDb): Promise<void> {
  const appliedMigrations = await db.many<AppliedMysqlMigration>(
    "SELECT version, checksum FROM schema_migrations ORDER BY version ASC",
  );
  const appliedVersions = validateAppliedMysqlMigrations(appliedMigrations);
  for (const migration of MYSQL_SCHEMA_MIGRATIONS) {
    if (!appliedVersions.has(migration.version)) {
      throw new Error(`MySQL schema migration ${migration.version} is missing`);
    }
  }
}

export function validateAppliedMysqlMigrations(
  appliedMigrations: readonly AppliedMysqlMigration[],
): ReadonlySet<number> {
  const expectedMigrations = new Map(
    MYSQL_SCHEMA_MIGRATIONS.map((migration) => [migration.version, migration]),
  );
  const appliedVersions = new Set<number>();

  for (const appliedMigration of appliedMigrations) {
    const migration = expectedMigrations.get(appliedMigration.version);
    if (migration === undefined) {
      throw new Error(`Unknown applied MySQL schema migration ${appliedMigration.version}`);
    }
    if (appliedVersions.has(appliedMigration.version)) {
      throw new Error(`Duplicate applied MySQL schema migration ${appliedMigration.version}`);
    }
    if (appliedMigration.checksum !== mysqlMigrationChecksum(migration)) {
      throw new Error(`MySQL schema migration ${appliedMigration.version} checksum mismatch`);
    }
    appliedVersions.add(appliedMigration.version);
  }

  return appliedVersions;
}

export function mysqlMigrationChecksum(migration: MysqlSchemaMigration): string {
  return createHash("sha256").update(migration.statements.join("\n")).digest("hex");
}
