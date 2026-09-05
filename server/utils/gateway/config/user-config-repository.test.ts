import { beforeEach, describe, expect, it } from "vitest";
import { defaultGatewayConfig } from "../../../../shared/config";
import type { GatewayConfig } from "../../../../shared/types";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import { UserRepository } from "../auth/user-repository";
import { createUserStore } from "../auth/users";
import type { GatewayDb } from "../storage/contracts";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";

describe("UserConfigRepository", () => {
  let db: GatewayDb;
  let userId: number;

  beforeEach(async () => {
    db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    userId = (
      await new UserRepository(db).createWithAutomaticRole({
        username: "config-user",
        passwordHash: "stored-password-hash",
        now: "2026-09-05T00:00:00.000Z",
      })
    ).id;
  });

  it("loads the default config with the initial revision when no row exists", async () => {
    await expect(createUserStore(db).loadConfig(userId)).resolves.toEqual({
      config: defaultGatewayConfig(),
      revision: 0,
    });
  });

  it("rejects a stale revision without overwriting the winning config", async () => {
    const store = createUserStore(db);
    const initial = await store.loadConfig(userId);
    const configA = configWithGroup("winner");
    const configB = configWithGroup("stale-loser");

    const revision1 = await store.saveConfig(userId, configA, initial.revision);
    await expect(store.saveConfig(userId, configB, initial.revision)).rejects.toMatchObject({
      code: "config_revision_conflict",
      reason: "stale",
    });

    await expect(store.loadConfig(userId)).resolves.toEqual({
      config: configA,
      revision: revision1,
    });
  });

  it("distinguishes a missing row from a stale stored revision", async () => {
    await expect(
      createUserStore(db).saveConfig(userId, configWithGroup("missing"), 2),
    ).rejects.toMatchObject({
      code: "config_revision_conflict",
      reason: "missing",
    });
  });

  it("rejects a stored BIGINT revision outside the safe JavaScript range", async () => {
    const store = createUserStore(db);
    await store.saveConfig(userId, configWithGroup("unsafe-revision"), 0);
    await db.execute("UPDATE user_configs SET revision = ? WHERE user_id = ?", [
      9_007_199_254_740_992n,
      userId,
    ]);

    await expect(store.loadConfig(userId)).rejects.toThrow(
      "Stored config revision is outside JavaScript's safe integer range",
    );
  });

  it("rejects invalid encrypted configuration instead of returning partial state", async () => {
    await db.execute(
      "INSERT INTO user_configs (user_id, encrypted_config_json, revision, updated_at) VALUES (?, ?, 1, ?)",
      [userId, "not-encrypted", "2026-09-05T00:00:00.000Z"],
    );

    await expect(createUserStore(db).loadConfig(userId)).rejects.toThrow(
      "Invalid encrypted config format",
    );
  });
});

function configWithGroup(group: string): GatewayConfig {
  const config = defaultGatewayConfig();
  config.notifications.bark.group = group;
  return config;
}
