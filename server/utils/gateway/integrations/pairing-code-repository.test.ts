import { beforeEach, describe, expect, it } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import type { GatewayDb } from "../storage/contracts";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";
import { createPairingCodeRepository } from "./pairing-code-repository";

describe("PairingCodeRepository", () => {
  let db: GatewayDb;
  let store: ReturnType<typeof createPairingCodeRepository>;

  beforeEach(async () => {
    db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await db.execute("INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)", [
      1,
      "local-admin",
      "hash",
      "admin",
    ]);
    store = createPairingCodeRepository(db);
  });

  it("consumes a valid code exactly once", async () => {
    await store.create({
      actorUserId: 1,
      codeHash: "a".repeat(64),
      expiresAt: "2026-09-08T00:10:00.000Z",
      now: "2026-09-08T00:00:00.000Z",
    });

    await expect(
      store.consume("a".repeat(64), "pairing-1", "2026-09-08T00:05:00.000Z"),
    ).resolves.toBe(true);
    await expect(
      store.consume("a".repeat(64), "pairing-2", "2026-09-08T00:05:00.000Z"),
    ).resolves.toBe(false);
  });

  it("rejects expired codes and revokes the prior active code on replacement", async () => {
    await store.create({
      actorUserId: 1,
      codeHash: "b".repeat(64),
      expiresAt: "2026-09-08T00:01:00.000Z",
      now: "2026-09-08T00:00:00.000Z",
    });
    await store.create({
      actorUserId: 1,
      codeHash: "c".repeat(64),
      expiresAt: "2026-09-08T00:20:00.000Z",
      now: "2026-09-08T00:02:00.000Z",
    });

    await expect(
      store.consume("b".repeat(64), "pairing-old", "2026-09-08T00:03:00.000Z"),
    ).resolves.toBe(false);
    await expect(store.activeStatus("2026-09-08T00:03:00.000Z")).resolves.toMatchObject({
      expiresAt: "2026-09-08T00:20:00.000Z",
    });
  });
});
