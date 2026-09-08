import { beforeEach, describe, expect, it } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import type { GatewayDb } from "../storage/contracts";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";
import { createCapabilityStore } from "../capabilities/store";
import { createMcpOAuthStateStore } from "./oauth-store";

describe("McpOAuthStateStore", () => {
  let db: GatewayDb;

  beforeEach(async () => {
    db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await db.execute(
      "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
      [7, "operator-seven", "hash", "user", 8, "operator-eight", "hash", "user"],
    );
    await createCapabilityStore(db).create({
      id: "org__business",
      kind: "mcp",
      displayName: "Business",
      description: "Business MCP",
      version: "1",
      source: { type: "internal", locator: "internal:business" },
      config: { transport: "streamable_http", url: "https://mcp.example.test" },
      sensitiveFields: [],
      enabled: true,
    });
  });

  it("binds state to a user, consumes once, and rejects expired state", async () => {
    let currentTime = Date.parse("2026-09-07T00:00:00.000Z");
    const store = createMcpOAuthStateStore(db, () => currentTime);
    const stateHash = "a".repeat(64);
    await store.create({
      stateHash,
      userId: 7,
      projectId: 10,
      capabilityId: "org__business",
      runtimeId: "runtime_7",
      callbackPath: "/api/capabilities/mcp/oauth/callback",
      expiresAt: "2026-09-07T00:10:00.000Z",
      consumedAt: null,
      createdAt: "2026-09-07T00:00:00.000Z",
    });

    await expect(store.consume(stateHash, 8)).resolves.toBeNull();
    await expect(store.consume(stateHash, 7)).resolves.toMatchObject({ userId: 7, projectId: 10 });
    await expect(store.consume(stateHash, 7)).resolves.toBeNull();

    const expiredHash = "b".repeat(64);
    await store.create({
      stateHash: expiredHash,
      userId: 7,
      projectId: null,
      capabilityId: "org__business",
      runtimeId: "runtime_7",
      callbackPath: "/api/capabilities/mcp/oauth/callback",
      expiresAt: "2026-09-07T00:20:00.000Z",
      consumedAt: null,
      createdAt: "2026-09-07T00:10:00.000Z",
    });
    currentTime = Date.parse("2026-09-07T00:20:00.001Z");
    await expect(store.consume(expiredHash, 7)).resolves.toBeNull();
  });
});
