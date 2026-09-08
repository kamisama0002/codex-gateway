import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import type { GatewayDb } from "../storage/contracts";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";
import { createCapabilityStore } from "../capabilities/store";
import { createCredentialStore, type CredentialStore } from "./store";

describe("CredentialStore", () => {
  let db: GatewayDb;
  let store: CredentialStore;

  beforeEach(async () => {
    vi.stubEnv("CODEX_GATEWAY_CONFIG_SECRET", "credential-store-test-key");
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
      sensitiveFields: ["BUSINESS_TOKEN"],
      enabled: true,
    });
    store = createCredentialStore(db, () => "2026-09-07T00:00:00.000Z");
  });

  it("stores no plaintext and resolves only the exact user and project scope", async () => {
    await store.create({
      id: "cred__business",
      capabilityId: "org__business",
      userId: 7,
      projectId: 10,
      kind: "username_password",
      secret: { username: "revenue-user", password: "literal-password-fixture" },
      mappings: [
        { field: "username", target: { type: "env", name: "BUSINESS_USERNAME" } },
        { field: "password", target: { type: "file", path: "/run/codex-secrets/business" } },
      ],
      notBefore: null,
      expiresAt: "2026-09-08T00:00:00.000Z",
    });

    const raw = await db.many("SELECT * FROM credentials");
    expect(JSON.stringify(raw)).not.toContain("revenue-user");
    expect(JSON.stringify(raw)).not.toContain("literal-password-fixture");
    expect(
      await store.resolveSecretsForContext({ userId: 7, projectId: 10 }, ["org__business"]),
    ).toEqual([
      expect.objectContaining({
        id: "cred__business",
        secret: { username: "revenue-user", password: "literal-password-fixture" },
      }),
    ]);
    await expect(
      store.resolveSecretsForContext({ userId: 7, projectId: 11 }, ["org__business"]),
    ).resolves.toEqual([]);
    await expect(
      store.resolveSecretsForContext({ userId: 8, projectId: 10 }, ["org__business"]),
    ).resolves.toEqual([]);
  });

  it("increments versions on rotation and never resolves revoked rows", async () => {
    await store.create({
      id: "cred__business",
      capabilityId: "org__business",
      userId: 7,
      projectId: null,
      kind: "token",
      secret: { token: "first-token" },
      mappings: [{ field: "token", target: { type: "env", name: "BUSINESS_TOKEN" } }],
      notBefore: null,
      expiresAt: null,
    });
    await expect(store.rotate("cred__business", { token: "second-token" })).resolves.toMatchObject({
      version: 2,
    });
    await store.revoke("cred__business");

    await expect(
      store.resolveSecretsForContext({ userId: 7, projectId: 10 }, ["org__business"]),
    ).resolves.toEqual([]);
    expect(JSON.stringify(await db.many("SELECT * FROM credentials"))).not.toContain(
      "second-token",
    );
  });
});
