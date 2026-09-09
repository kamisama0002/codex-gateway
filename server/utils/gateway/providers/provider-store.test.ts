import { beforeEach, describe, expect, it } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import type { DbRow, GatewayDb } from "../storage/contracts";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";
import { createProviderStore } from "./provider-store";

describe("providerStore", () => {
  let db: GatewayDb;
  let store: ReturnType<typeof createProviderStore>;

  beforeEach(async () => {
    db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await db.execute(
      "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
      [1, "u1", "hash", "user", 2, "u2", "hash", "user"],
    );
    store = createProviderStore(db);
  });

  it("creates, lists, and deletes public provider rows without exposing secrets", async () => {
    const provider = await store.create({
      id: "deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/",
      wireApi: "chat_completions",
      apiKey: "secret-value",
    });

    expect(provider).toMatchObject({ id: "deepseek", baseUrl: "https://api.deepseek.com" });
    expect(provider).not.toHaveProperty("apiKey");
    expect(provider).not.toHaveProperty("encryptedApiKey");
    expect(JSON.stringify(await store.listPublic())).not.toContain("secret-value");
    expect(await store.getPublic(provider.id)).toEqual(provider);
    expect((await store.getWithSecret(provider.id))?.apiKey).toBe("secret-value");
    await expect(store.delete(provider.id)).resolves.toBe(true);
    await expect(store.getPublic(provider.id)).resolves.toBeNull();
    await expect(store.delete(provider.id)).resolves.toBe(false);
  });

  it("updates public fields while preserving a stored key for an empty key update", async () => {
    const provider = await store.create({
      id: "qwen",
      name: "Qwen",
      baseUrl: "https://dashscope.aliyuncs.com",
      wireApi: "responses",
      apiKey: "old-key",
    });

    const updated = await store.update(provider.id, {
      name: "Qwen Cloud",
      apiKey: "",
      requestTimeoutMs: 45_000,
    });

    expect(updated).toMatchObject({ name: "Qwen Cloud", requestTimeoutMs: 45_000 });
    expect((await store.getWithSecret(provider.id))?.apiKey).toBe("old-key");
  });

  it("preserves disjoint concurrent partial updates including an API key rotation", async () => {
    const provider = await store.create({
      id: "concurrent",
      name: "Original",
      baseUrl: "https://concurrent.test",
      wireApi: "responses",
      apiKey: "old-key",
    });
    const concurrentStore = createProviderStore(withProviderUpdateReadBarrier(db));

    await Promise.all([
      concurrentStore.update(provider.id, { name: "Renamed" }),
      concurrentStore.update(provider.id, { apiKey: "rotated-key" }),
    ]);

    await expect(store.getPublic(provider.id)).resolves.toMatchObject({ name: "Renamed" });
    expect((await store.getWithSecret(provider.id))?.apiKey).toBe("rotated-key");
  });

  it("upserts models and exposes globally enabled models to every user", async () => {
    const provider = await store.create({
      id: "glm",
      name: "GLM",
      baseUrl: "https://open.bigmodel.cn",
      wireApi: "chat_completions",
      apiKey: "secret",
    });
    await store.upsertModel(provider.id, {
      modelId: "glm-4",
      displayName: "GLM-4",
      capabilities: capabilities(true),
    });
    const updated = await store.upsertModel(provider.id, {
      modelId: "glm-4",
      displayName: "GLM-4 Plus",
      capabilities: capabilities(false),
    });
    await store.upsertModel(provider.id, {
      modelId: "disabled",
      displayName: "Disabled",
      enabled: false,
      capabilities: capabilities(false),
    });
    expect(updated).toMatchObject({ displayName: "GLM-4 Plus", capabilities: capabilities(false) });
    expect((await store.listModels(provider.id)).map((model) => model.modelId)).toEqual([
      "disabled",
      "glm-4",
    ]);
    expect((await store.listForUser(1)).map((item) => item.modelId)).toEqual(["glm-4"]);
    await expect(store.listForUser(2)).resolves.toMatchObject([
      { providerId: provider.id, modelId: "glm-4", enabled: true },
    ]);

    // Legacy per-user grants remain data-compatible but do not change global
    // model visibility.
    await store.grant({ userId: 1, providerId: provider.id, modelId: "disabled" });

    await store.update(provider.id, { enabled: false });
    await expect(store.listForUser(1)).resolves.toEqual([]);
    await expect(store.listForUser(2)).resolves.toEqual([]);
  });

  it("keeps grants idempotent and revokes only an existing grant", async () => {
    const provider = await providerWithModel(store, "minimax", "abab");
    const input = { userId: 1, providerId: provider.id, modelId: "abab" };

    const first = await store.grant(input);
    const repeated = await store.grant(input);

    expect(repeated).toEqual(first);
    await expect(store.revoke(input)).resolves.toBe(true);
    await expect(store.revoke(input)).resolves.toBe(false);
  });

  it("cascades grants and models when an administrator deletes a provider", async () => {
    const provider = await providerWithModel(store, "minimax", "abab");
    await store.grant({ userId: 1, providerId: provider.id, modelId: "abab" });

    await expect(store.delete(provider.id)).resolves.toBe(true);

    await expect(store.listForUser(1)).resolves.toEqual([]);
    expect(
      await db.one<{ count: number }>("SELECT COUNT(*) AS count FROM provider_models"),
    ).toMatchObject({
      count: 0,
    });
    expect(
      await db.one<{ count: number }>("SELECT COUNT(*) AS count FROM user_model_grants"),
    ).toMatchObject({
      count: 0,
    });
  });

  it("leaves the original provider unchanged when a duplicate ID violates uniqueness", async () => {
    await store.create({
      id: "duplicate",
      name: "Original",
      baseUrl: "https://original.test",
      wireApi: "responses",
      apiKey: "original-secret",
    });

    await expect(
      store.create({
        id: "duplicate",
        name: "Replacement",
        baseUrl: "https://replacement.test",
        wireApi: "responses",
        apiKey: "replacement-secret",
      }),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });

    await expect(store.getPublic("duplicate")).resolves.toMatchObject({
      name: "Original",
      baseUrl: "https://original.test",
    });
    expect((await store.getWithSecret("duplicate"))?.apiKey).toBe("original-secret");
  });

  it("rolls back a grant rejected by the user foreign key", async () => {
    const provider = await providerWithModel(store, "foreign-key", "model-1");

    await expect(
      store.grant({ userId: 99, providerId: provider.id, modelId: "model-1" }),
    ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });

    expect(
      await db.one<{ count: number }>("SELECT COUNT(*) AS count FROM user_model_grants"),
    ).toMatchObject({ count: 0 });
  });
});

function capabilities(tools: boolean) {
  return {
    tools,
    streamingTools: tools,
    vision: false,
    reasoning: true,
    maxContextTokens: tools ? 128_000 : null,
  };
}

async function providerWithModel(
  store: ReturnType<typeof createProviderStore>,
  providerId: string,
  modelId: string,
) {
  const provider = await store.create({
    id: providerId,
    name: providerId,
    baseUrl: `https://${providerId}.test`,
    wireApi: "responses",
    apiKey: "secret",
  });
  await store.upsertModel(provider.id, {
    modelId,
    displayName: modelId,
    capabilities: capabilities(false),
  });
  return provider;
}

function withProviderUpdateReadBarrier(db: GatewayDb): GatewayDb {
  let snapshotReads = 0;
  let releaseSnapshots!: () => void;
  const snapshotsReady = new Promise<void>((resolve) => {
    releaseSnapshots = resolve;
  });

  function wrap(target: GatewayDb, insideTransaction: boolean): GatewayDb {
    let hasWritten = false;
    return {
      async one<T extends DbRow>(sql: string, params = []): Promise<T | null> {
        const row = await target.one<T>(sql, params);
        if (insideTransaction && !hasWritten && isProviderSnapshotRead(sql)) {
          snapshotReads += 1;
          if (snapshotReads === 2) releaseSnapshots();
          await snapshotsReady;
        }
        return row;
      },
      many<T extends DbRow>(sql: string, params = []): Promise<T[]> {
        return target.many<T>(sql, params);
      },
      async execute(sql, params = []) {
        const result = await target.execute(sql, params);
        hasWritten = true;
        return result;
      },
      transaction<T>(work: (tx: GatewayDb) => Promise<T>): Promise<T> {
        return target.transaction((tx) => work(wrap(tx, true)));
      },
      close(): Promise<void> {
        return target.close();
      },
    };
  }

  return wrap(db, false);
}

function isProviderSnapshotRead(sql: string): boolean {
  return /^\s*SELECT \* FROM model_providers WHERE id = \?\s*$/i.test(sql);
}
