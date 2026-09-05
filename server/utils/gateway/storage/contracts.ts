export type SqlValue = string | number | bigint | boolean | Buffer | Date | null;
export type DbRow = Record<string, unknown>;

export interface DbWriteResult {
  affectedRows: number;
  insertId: number;
}

export interface GatewayTransactionOptions {
  isolationLevel?: "serializable";
}

export interface GatewayDb {
  one<T extends DbRow>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
  many<T extends DbRow>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  execute(sql: string, params?: readonly SqlValue[]): Promise<DbWriteResult>;
  transaction<T>(
    work: (tx: GatewayDb) => Promise<T>,
    options?: GatewayTransactionOptions,
  ): Promise<T>;
  close(): Promise<void>;
}
