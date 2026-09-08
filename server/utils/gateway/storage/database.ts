import type { GatewayDb } from "./contracts";
import { createMysqlGatewayDb } from "./mysql";

export const DATABASE_UNAVAILABLE_CODE = "database_unavailable";

let database: GatewayDb | null = null;

export class GatewayDatabaseUnavailableError extends Error {
  readonly code = DATABASE_UNAVAILABLE_CODE;
  readonly statusCode = 503;
  readonly statusMessage = DATABASE_UNAVAILABLE_CODE;
  readonly data = { code: DATABASE_UNAVAILABLE_CODE };

  constructor(cause: unknown) {
    super("Gateway database is unavailable", { cause });
    this.name = "GatewayDatabaseUnavailableError";
  }
}

export function gatewayDatabase(): GatewayDb {
  if (database === null) {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined || databaseUrl.length === 0) {
      throw new Error("DATABASE_URL is required for MySQL gateway storage");
    }
    database = createMysqlGatewayDb(databaseUrl);
  }
  return database;
}

export async function verifyGatewayDatabase(): Promise<void> {
  await gatewayDatabase().one("SELECT 1 AS ready");
}

export async function closeGatewayDatabase(): Promise<void> {
  const currentDatabase = database;
  database = null;
  if (currentDatabase !== null) {
    await currentDatabase.close();
  }
}

export function databaseUnavailableError(cause: unknown) {
  return cause instanceof GatewayDatabaseUnavailableError
    ? cause
    : new GatewayDatabaseUnavailableError(cause);
}
