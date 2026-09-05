import { afterEach, describe, expect, it } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import {
  closeMysqlGatewayDatabase,
  gatewayMysqlDatabase,
  verifyMysqlGatewayDatabase,
} from "./mysql-database";
import { createMysqlGatewayDb } from "./mysql";

describe("MySQL gateway database", () => {
  afterEach(async () => {
    await closeMysqlGatewayDatabase();
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
});
