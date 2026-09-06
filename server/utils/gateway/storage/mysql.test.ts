import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import {
  closeMysqlGatewayDatabase,
  gatewayMysqlDatabase,
  verifyMysqlGatewayDatabase,
} from "./mysql-database";
import { createMysqlGatewayDb } from "./mysql";
import { closeGatewayDatabase, gatewayDatabase, verifyGatewayDatabase } from "./database";

const mysqlPoolFactory = vi.hoisted(() => ({ calls: 0, options: [] as unknown[] }));

vi.mock("mysql2/promise", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mysql2/promise")>();
  return {
    ...actual,
    createPool: (...args: Parameters<typeof actual.createPool>) => {
      mysqlPoolFactory.calls += 1;
      mysqlPoolFactory.options.push(args[0]);
      return actual.createPool(...args);
    },
  };
});

const originalMysqlTlsMode = process.env.MYSQL_TLS_MODE;
const originalMysqlTlsCaFile = process.env.MYSQL_TLS_CA_FILE;
const temporaryDirectories: string[] = [];

const databaseUrl = "mysql://gateway-user:p%40ssword@database.internal:3307/codex_gateway";
const basePoolOptions = {
  database: "codex_gateway",
  host: "database.internal",
  multipleStatements: false,
  password: "p@ssword",
  port: 3307,
  timezone: "Z",
  user: "gateway-user",
};

describe("MySQL gateway database", () => {
  beforeEach(() => {
    delete process.env.MYSQL_TLS_MODE;
    delete process.env.MYSQL_TLS_CA_FILE;
    mysqlPoolFactory.calls = 0;
    mysqlPoolFactory.options = [];
  });

  afterEach(async () => {
    await closeMysqlGatewayDatabase();
    restoreEnvironment("MYSQL_TLS_MODE", originalMysqlTlsMode);
    restoreEnvironment("MYSQL_TLS_CA_FILE", originalMysqlTlsCaFile);
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("passes exact UTC, single-statement, non-TLS options for an internal MySQL URL", async () => {
    const db = createMysqlGatewayDb(databaseUrl);
    await db.close();

    expect(mysqlPoolFactory.options).toEqual([basePoolOptions]);
  });

  it("passes required TLS options without disabling UTC or single-statement safeguards", async () => {
    process.env.MYSQL_TLS_MODE = "required";

    const db = createMysqlGatewayDb(databaseUrl);
    await db.close();

    expect(mysqlPoolFactory.options).toEqual([
      { ...basePoolOptions, ssl: { rejectUnauthorized: false } },
    ]);
  });

  it("passes CA-backed hostname-verifying TLS options", async () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-gateway-mysql-tls-"));
    temporaryDirectories.push(directory);
    const caFile = join(directory, "mysql-ca.pem");
    writeFileSync(caFile, "test-ca-certificate\n", "utf8");
    process.env.MYSQL_TLS_MODE = "verify-identity";
    process.env.MYSQL_TLS_CA_FILE = caFile;

    const db = createMysqlGatewayDb(databaseUrl);
    await db.close();

    expect(mysqlPoolFactory.options).toEqual([
      {
        ...basePoolOptions,
        ssl: {
          ca: "test-ca-certificate\n",
          rejectUnauthorized: true,
          verifyIdentity: true,
        },
      },
    ]);
  });

  it("rejects an invalid TLS mode before creating a pool", () => {
    process.env.MYSQL_TLS_MODE = "preferred";

    expect(() => createMysqlGatewayDb(databaseUrl)).toThrow("MYSQL_TLS_MODE");
    expect(mysqlPoolFactory.calls).toBe(0);
  });

  it("requires a CA file for hostname-verifying TLS before creating a pool", () => {
    process.env.MYSQL_TLS_MODE = "verify-identity";

    expect(() => createMysqlGatewayDb(databaseUrl)).toThrow("MYSQL_TLS_CA_FILE");
    expect(mysqlPoolFactory.calls).toBe(0);
  });

  it("rejects a CA file when the selected TLS mode would ignore it", () => {
    process.env.MYSQL_TLS_MODE = "required";
    process.env.MYSQL_TLS_CA_FILE = "unused-ca.pem";

    expect(() => createMysqlGatewayDb(databaseUrl)).toThrow("MYSQL_TLS_CA_FILE");
    expect(mysqlPoolFactory.calls).toBe(0);
  });

  it("reports unreadable CA files without exposing connection credentials or file paths", () => {
    const missingCaFile = join(tmpdir(), "missing-codex-gateway-mysql-ca.pem");
    process.env.MYSQL_TLS_MODE = "verify-identity";
    process.env.MYSQL_TLS_CA_FILE = missingCaFile;

    expect.assertions(5);
    try {
      createMysqlGatewayDb(databaseUrl);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("MYSQL_TLS_CA_FILE");
      expect(message).not.toContain("p@ssword");
      expect(message).not.toContain(missingCaFile);
    }
    expect(mysqlPoolFactory.calls).toBe(0);
  });

  it("rejects unsupported and security-sensitive URL query parameters before creating a pool", () => {
    for (const query of [
      "unknown=value",
      "ssl-mode=REQUIRED",
      "multipleStatements=true",
      "timezone=local",
    ]) {
      expect(() => createMysqlGatewayDb(`${databaseUrl}?${query}`)).toThrow(
        "query parameters are not supported",
      );
    }
    expect(mysqlPoolFactory.calls).toBe(0);
  });

  it("commits a successful transaction and rolls back a rejected transaction", async () => {
    const db = await freshMysqlTestDatabase();
    await db.execute("CREATE TABLE samples (id INT PRIMARY KEY, value_text VARCHAR(32) NOT NULL)");
    await db.transaction(async (tx) => {
      await tx.execute("INSERT INTO samples (id, value_text) VALUES (?, ?)", [1, "committed"]);
    });
    await expect(
      db.transaction(async (tx) => {
        await tx.execute("INSERT INTO samples (id, value_text) VALUES (?, ?)", [2, "rolled-back"]);
        throw new Error("reject transaction");
      }),
    ).rejects.toThrow("reject transaction");
    expect(await db.one("SELECT value_text FROM samples WHERE id = ?", [1])).toEqual({
      value_text: "committed",
    });
    expect(await db.one("SELECT value_text FROM samples WHERE id = ?", [2])).toBeNull();
  });

  it("rejects malformed and non-MySQL database URLs before connecting", () => {
    expect(() => createMysqlGatewayDb("not a database URL")).toThrow("DATABASE_URL");
    expect(() =>
      createMysqlGatewayDb("postgres://user:password@localhost:5432/codex_gateway"),
    ).toThrow("DATABASE_URL");
    expect(mysqlPoolFactory.calls).toBe(0);
  });

  it("rejects multiple SQL statements", async () => {
    const db = await freshMysqlTestDatabase();
    await expect(db.execute("SELECT 1; SELECT 2")).rejects.toThrow();
  });

  it("closes the MySQL singleton idempotently", async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = process.env.MYSQL_TEST_DATABASE_URL;
    try {
      gatewayMysqlDatabase();
      await verifyMysqlGatewayDatabase();
      await closeMysqlGatewayDatabase();
      await expect(closeMysqlGatewayDatabase()).resolves.toBeUndefined();
    } finally {
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
    }
  });

  it("serves MySQL through the final Gateway database entry point", async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = process.env.MYSQL_TEST_DATABASE_URL;
    try {
      await verifyGatewayDatabase();
      await expect(gatewayDatabase().one("SELECT 1 AS ready")).resolves.toEqual({
        ready: 1,
      });
      await closeGatewayDatabase();
      await expect(closeGatewayDatabase()).resolves.toBeUndefined();
    } finally {
      await closeGatewayDatabase();
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
    }
  });
});

function restoreEnvironment(
  name: "MYSQL_TLS_MODE" | "MYSQL_TLS_CA_FILE",
  value: string | undefined,
) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
