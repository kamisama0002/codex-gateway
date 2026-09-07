import { randomUUID } from "node:crypto";
import { afterAll } from "vitest";
import { createConnection } from "mysql2/promise";
import { createMysqlGatewayDb } from "../../server/utils/gateway/storage/mysql";
import type { GatewayDb } from "../../server/utils/gateway/storage/contracts";

interface TestDatabase {
  databaseName: string;
  db: GatewayDb;
}

const databases: TestDatabase[] = [];

afterAll(async () => {
  const adminDatabaseUrl = requiredEnvironment("MYSQL_TEST_ADMIN_DATABASE_URL");
  const admin = await createConnection(adminDatabaseUrl);
  try {
    for (const testDatabase of databases.splice(0)) {
      await testDatabase.db.close();
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(testDatabase.databaseName)}`);
    }
  } finally {
    await admin.end();
  }
});

export async function freshMysqlTestDatabase(): Promise<GatewayDb> {
  const adminDatabaseUrl = requiredEnvironment("MYSQL_TEST_ADMIN_DATABASE_URL");
  const testDatabaseUrl = requiredEnvironment("MYSQL_TEST_DATABASE_URL");
  const databaseName = uniqueDatabaseName();
  const username = mysqlUsername(testDatabaseUrl);
  const admin = await createConnection(adminDatabaseUrl);
  try {
    await admin.query(
      `CREATE DATABASE ${quoteIdentifier(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
    await admin.query(
      `GRANT ALL PRIVILEGES ON ${quoteIdentifier(databaseName)}.* TO ${quoteIdentifier(username)}@'%'`,
    );
  } finally {
    await admin.end();
  }

  const db = createMysqlGatewayDb(databaseUrlFor(testDatabaseUrl, databaseName));
  databases.push({ databaseName, db });
  return db;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for MySQL integration tests`);
  }
  return value;
}

function databaseUrlFor(databaseUrl: string, databaseName: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function mysqlUsername(databaseUrl: string): string {
  const username = decodeURIComponent(new URL(databaseUrl).username);
  if (!/^[A-Za-z0-9_]+$/.test(username)) {
    throw new Error("MYSQL_TEST_DATABASE_URL must contain a simple MySQL username");
  }
  return username;
}

function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replaceAll("`", "``")}\``;
}

function uniqueDatabaseName(): string {
  const workerId = process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? "worker";
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  return `codex_gateway_test_${process.pid}_${workerId}_${suffix}`.replaceAll(
    /[^A-Za-z0-9_]/g,
    "_",
  );
}
