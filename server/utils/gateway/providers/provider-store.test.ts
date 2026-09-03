import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { createProviderStore } from "./provider-store";
import { migrateGatewayDatabase } from "../storage/migrations";

describe("providerStore", () => {
  let store: ReturnType<typeof createProviderStore>;

  beforeEach(() => {
    const db = new DatabaseSync(":memory:");
    migrateGatewayDatabase(db);
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run(
      "u1",
      "hash",
      "user",
    );
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run(
      "u2",
      "hash",
      "user",
    );
    store = createProviderStore(db);
  });

  it("redacts the API key from public provider rows", () => {
    const provider = store.create({
      id: "deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      wireApi: "chat_completions",
      apiKey: "secret-value",
    });
    expect(provider).not.toHaveProperty("apiKey");
    expect(provider).not.toHaveProperty("encryptedApiKey");
    expect(JSON.stringify(provider)).not.toContain("secret-value");
    expect(store.getWithSecret(provider.id)?.apiKey).toBe("secret-value");
  });

  it("preserves a stored key when an empty update is submitted", () => {
    const provider = store.create({
      id: "qwen",
      name: "Qwen",
      baseUrl: "https://dashscope.aliyuncs.com",
      wireApi: "responses",
      apiKey: "old-key",
    });
    store.update(provider.id, { name: "Qwen Cloud", apiKey: "" });
    expect(store.getWithSecret(provider.id)?.apiKey).toBe("old-key");
  });

  it("returns only enabled models granted to the requesting user", () => {
    const provider = store.create({
      id: "glm",
      name: "GLM",
      baseUrl: "https://open.bigmodel.cn",
      wireApi: "chat_completions",
      apiKey: "secret",
    });
    store.upsertModel(provider.id, {
      modelId: "glm-4",
      displayName: "GLM-4",
      capabilities: {
        tools: true,
        streamingTools: true,
        vision: false,
        reasoning: true,
        maxContextTokens: 128000,
      },
    });
    store.upsertModel(provider.id, {
      modelId: "disabled",
      displayName: "Disabled",
      enabled: false,
      capabilities: {
        tools: false,
        streamingTools: false,
        vision: false,
        reasoning: false,
        maxContextTokens: null,
      },
    });
    store.grant({ userId: 1, providerId: provider.id, modelId: "glm-4" });
    store.grant({ userId: 1, providerId: provider.id, modelId: "disabled" });
    expect(store.listForUser(1).map((item) => item.modelId)).toEqual(["glm-4"]);
    expect(store.listForUser(2)).toEqual([]);
  });

  it("cascades grants and models when an administrator deletes a provider", () => {
    const provider = store.create({
      id: "minimax",
      name: "MiniMax",
      baseUrl: "https://api.minimax.chat",
      wireApi: "chat_completions",
      apiKey: "secret",
    });
    store.upsertModel(provider.id, {
      modelId: "abab",
      displayName: "ABAB",
      capabilities: {
        tools: true,
        streamingTools: false,
        vision: false,
        reasoning: false,
        maxContextTokens: null,
      },
    });
    store.grant({ userId: 1, providerId: provider.id, modelId: "abab" });
    expect(store.delete(provider.id)).toBe(true);
    expect(store.listForUser(1)).toEqual([]);
  });
});
