#!/usr/bin/env node
import { createMysqlGatewayDb } from "../../server/utils/gateway/storage/mysql.ts";
import { migrateMysqlGatewayDatabase } from "../../server/utils/gateway/storage/mysql-migrations.ts";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  console.error("DATABASE_URL is required");
  process.exitCode = 1;
} else {
  const db = createMysqlGatewayDb(databaseUrl);
  try {
    await migrateMysqlGatewayDatabase(db);
    const row = await db.one("SELECT COUNT(*) AS count, MAX(version) AS version FROM schema_migrations");
    const count = Number(row?.count ?? 0);
    const version = Number(row?.version ?? 0);
    console.log(`MySQL schema version ${version} (${count} migrations)`);
  } catch {
    console.error("Database migration failed");
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
