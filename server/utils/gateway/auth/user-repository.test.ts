import { beforeEach, describe, expect, it } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import type { GatewayDb } from "../storage/contracts";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";
import { UserRepository } from "./user-repository";
import { createUserStore } from "./users";

describe("UserRepository", () => {
  let db: GatewayDb;

  beforeEach(async () => {
    db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
  });

  it("normalizes usernames before enforcing their unique identity", async () => {
    const repository = new UserRepository(db);

    const user = await repository.createWithAutomaticRole({
      username: "  Alice  ",
      passwordHash: "stored-password-hash",
      now: "2026-09-05T00:00:00.000Z",
    });

    expect(user).toMatchObject({ username: "alice", role: "admin", isActive: true });
    await expect(
      repository.createWithAutomaticRole({
        username: "ALICE",
        passwordHash: "another-password-hash",
        now: "2026-09-05T00:00:01.000Z",
      }),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
  });

  it("assigns exactly one administrator under two concurrent first-user creates", async () => {
    const repository = new UserRepository(db);

    const users = await Promise.all([
      repository.createWithAutomaticRole({
        username: "first",
        passwordHash: "first-password-hash",
        now: "2026-09-05T00:00:00.000Z",
      }),
      repository.createWithAutomaticRole({
        username: "second",
        passwordHash: "second-password-hash",
        now: "2026-09-05T00:00:00.000Z",
      }),
    ]);

    expect(users.map((user) => user.role).sort()).toEqual(["admin", "user"]);
    const stored = await db.many<{ username: string; role: string }>(
      "SELECT username, role FROM users ORDER BY username ASC",
    );
    expect(stored.map((user) => user.username)).toEqual(["first", "second"]);
    expect(stored.filter((user) => user.role === "admin")).toHaveLength(1);
  });

  it("logs in with the stored password and rejects wrong passwords or disabled users", async () => {
    let tokenSequence = 0;
    const store = createUserStore(db, {
      token: () => `token-${++tokenSequence}`,
      now: () => new Date("2026-09-05T00:00:00.000Z"),
    });
    const created = await store.createUser(" Login-User ", "correct-password");

    await expect(store.login("LOGIN-USER", "wrong-password")).resolves.toBeNull();
    await expect(store.login("LOGIN-USER", "correct-password")).resolves.toMatchObject({
      token: "token-1",
      user: { id: created.id, username: "login-user" },
    });

    await db.execute("UPDATE users SET is_active = 0 WHERE id = ?", [created.id]);
    await expect(store.login("login-user", "correct-password")).resolves.toBeNull();
  });

  it("assigns the default web search and browser capabilities to every new user", async () => {
    const repository = new UserRepository(db);
    await db.execute("UPDATE capability_definitions SET enabled = 0 WHERE id = ?", [
      "org__web_search",
    ]);
    const user = await repository.createWithAutomaticRole({
      username: "search-user",
      passwordHash: "stored-password-hash",
      now: "2026-09-07T00:00:00.000Z",
    });

    await expect(
      db.many<{ capability_id: string }>(
        "SELECT capability_id FROM capability_assignments WHERE user_id = ? AND project_id IS NULL ORDER BY capability_id",
        [user.id],
      ),
    ).resolves.toEqual([
      { capability_id: "org__browser" },
      { capability_id: "org__web_search" },
    ]);
  });
});
