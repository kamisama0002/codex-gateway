import { createPool, type Pool, type PoolConnection } from "mysql2/promise";
import type { DbRow, DbWriteResult, GatewayDb, SqlValue } from "./contracts";

type MysqlExecutor = Pool | PoolConnection;
type TransactionRunner = <T>(work: (tx: GatewayDb) => Promise<T>) => Promise<T>;

export function createMysqlGatewayDb(databaseUrl: string): GatewayDb {
  const options = mysqlOptions(databaseUrl);
  const pool = createPool(options);
  return createPoolGatewayDb(pool);
}

function createPoolGatewayDb(pool: Pool): GatewayDb {
  return createGatewayDb(
    pool,
    async () => {
      await pool.end();
    },
    async (work) => {
      const connection = await pool.getConnection();
      try {
        return await transactionWithConnection(connection, work);
      } finally {
        connection.release();
      }
    },
  );
}

function createConnectionGatewayDb(connection: PoolConnection): GatewayDb {
  return createGatewayDb(
    connection,
    async () => {},
    async (work) => {
      return await transactionWithConnection(connection, work);
    },
  );
}

function createGatewayDb(
  executor: MysqlExecutor,
  close: () => Promise<void>,
  transaction: TransactionRunner,
): GatewayDb {
  return {
    async one<T extends DbRow>(sql: string, params: readonly SqlValue[] = []): Promise<T | null> {
      const rows = await selectRows<T>(executor, sql, params);
      return rows[0] ?? null;
    },
    async many<T extends DbRow>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
      return await selectRows<T>(executor, sql, params);
    },
    async execute(sql: string, params: readonly SqlValue[] = []): Promise<DbWriteResult> {
      const [result] = await executor.execute(sql, Array.from(params));
      return {
        affectedRows: safeInteger(writeResultField(result, "affectedRows"), "affectedRows"),
        insertId: safeInteger(writeResultField(result, "insertId"), "insertId"),
      };
    },
    transaction,
    close,
  };
}

async function transactionWithConnection<T>(
  connection: PoolConnection,
  work: (tx: GatewayDb) => Promise<T>,
): Promise<T> {
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const result = await work(createConnectionGatewayDb(connection));
    await connection.commit();
    return result;
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    throw error;
  }
}

async function selectRows<T extends DbRow>(
  executor: MysqlExecutor,
  sql: string,
  params: readonly SqlValue[],
): Promise<T[]> {
  const [rows] = await executor.execute(sql, Array.from(params));
  // SQL projection shapes are selected by the caller's generic type.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return rowsFromResult(rows) as T[];
}

function rowsFromResult(value: unknown): DbRow[] {
  if (!Array.isArray(value)) {
    throw new Error("Expected MySQL query to return rows");
  }
  const rows: unknown[] = value;
  return rows.map((row) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error("MySQL query returned an invalid row");
    }
    return { ...row };
  });
}

function writeResultField(value: unknown, field: "affectedRows" | "insertId"): number | bigint {
  if (!isRecord(value) || !(field in value)) {
    throw new Error("Expected MySQL query to return a write result");
  }
  const resultValue = value[field];
  if (typeof resultValue !== "number" && typeof resultValue !== "bigint") {
    throw new Error(`MySQL ${field} is not an integer`);
  }
  return resultValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function mysqlOptions(databaseUrl: string) {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid MySQL URL");
  }
  if (url.protocol !== "mysql:") {
    throw new Error("DATABASE_URL must use the mysql protocol");
  }
  if (url.hostname.length === 0 || url.pathname.length <= 1) {
    throw new Error("DATABASE_URL must identify a MySQL database");
  }

  const port = url.port.length === 0 ? undefined : Number(url.port);
  if (port !== undefined && (!Number.isSafeInteger(port) || port <= 0 || port > 65535)) {
    throw new Error("DATABASE_URL must contain a valid MySQL port");
  }

  return {
    database: decodeURIComponent(url.pathname.slice(1)),
    host: url.hostname,
    multipleStatements: false,
    password: decodeURIComponent(url.password),
    port,
    timezone: "Z",
    user: decodeURIComponent(url.username),
  };
}

function safeInteger(value: number | bigint, field: string): number {
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue)) {
    throw new RangeError(`MySQL ${field} is outside JavaScript's safe integer range`);
  }
  return numberValue;
}
