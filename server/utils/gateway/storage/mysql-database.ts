import type { GatewayDb } from "./contracts";
import { createMysqlGatewayDb } from "./mysql";

let database: GatewayDb | null = null;

export function gatewayMysqlDatabase(): GatewayDb {
  if (database === null) {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined || databaseUrl.length === 0) {
      throw new Error("DATABASE_URL is required for MySQL gateway storage");
    }
    database = createMysqlGatewayDb(databaseUrl);
  }
  return database;
}

export async function verifyMysqlGatewayDatabase(): Promise<void> {
  await gatewayMysqlDatabase().one("SELECT 1 AS ready");
}

export async function closeMysqlGatewayDatabase(): Promise<void> {
  const currentDatabase = database;
  database = null;
  if (currentDatabase !== null) {
    await currentDatabase.close();
  }
}
