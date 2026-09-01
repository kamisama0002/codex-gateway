import { describe, expect, it } from "vitest";
import { createProviderStore } from "./provider-store";
import { migrateGatewayDatabase } from "../storage/migrations";
import { DatabaseSync } from "node:sqlite";
import { issueRuntimeModelToken } from "./runtime-token";
import { handleProviderResponses } from "./provider-proxy";

describe("provider proxy", () => {
  it("translates a Chat Completions upstream into Responses JSON", async () => {
    const db = new DatabaseSync(":memory:");
    migrateGatewayDatabase(db);
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('u', 'hash', 'user')").run();
    const store = createProviderStore(db);
    const provider = store.create({ id: "p1", name: "Provider", baseUrl: "https://upstream.test/v1", wireApi: "chat_completions", apiKey: "secret-key" });
    store.upsertModel(provider.id, { modelId: "m1", displayName: "Model", capabilities: { tools: true, streamingTools: true, vision: false, reasoning: false, maxContextTokens: null } });
    store.grant({ userId: 1, providerId: provider.id, modelId: "m1" });
    expect(store.listForUser(1)).toMatchObject([{ providerId: "p1", modelId: "m1" }]);
    const token = issueRuntimeModelToken({ userId: 1, runtimeId: "r1", providerId: "p1", modelId: "m1" }, "test-secret");
    let seen: RequestInit | undefined;
    const response = await handleProviderResponses(
      new Request("http://gateway/api/internal/providers/p1/v1/responses", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ model: "m1", input: "hello" }) }),
      "p1",
      {
        store,
        verifyToken: (value, scope) => {
          expect(value).toBe(token);
          expect(scope).toEqual({ userId: 0, providerId: "p1", modelId: "m1" });
          return { userId: 1, runtimeId: "r1", providerId: "p1", modelId: "m1", jti: "j", exp: Date.now() + 10_000 };
        },
        fetch: async (url, init) => {
          expect(url).toBe("https://upstream.test/v1/chat/completions");
          seen = init;
          return new Response(JSON.stringify({ id: "chat-1", model: "m1", choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { "content-type": "application/json" } });
        },
        runtimeStore: { getByUserId: () => ({ status: "ready" }) },
      },
    );
    expect(await response.json()).toMatchObject({ object: "response", output_text: "OK", status: "completed" });
    expect(seen?.headers).toMatchObject({ authorization: "Bearer secret-key" });
  });

  it("rejects a revoked model grant before contacting upstream", async () => {
    const db = new DatabaseSync(":memory:");
    migrateGatewayDatabase(db);
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('u', 'hash', 'user')").run();
    const store = createProviderStore(db);
    const provider = store.create({ id: "p1", name: "Provider", baseUrl: "https://upstream.test/v1", wireApi: "responses", apiKey: "secret-key" });
    store.upsertModel(provider.id, { modelId: "m1", displayName: "Model", capabilities: { tools: false, streamingTools: false, vision: false, reasoning: false, maxContextTokens: null } });
    const token = issueRuntimeModelToken({ userId: 1, runtimeId: "r1", providerId: "p1", modelId: "m1" }, "test-secret");
    const response = await handleProviderResponses(new Request("http://gateway", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ model: "m1" }) }), "p1", { store, fetch: async () => { throw new Error("must not call"); }, verifyToken: () => ({ userId: 1, runtimeId: "r1", providerId: "p1", modelId: "m1", jti: "j", exp: Date.now() + 10_000 }), runtimeStore: { getByUserId: () => ({ status: "ready" }) } });
    expect(response.status).toBe(403);
  });

  it("rejects a token after its runtime is removed", async () => {
    const response = await handleProviderResponses(
      new Request("http://gateway", { method: "POST", headers: { authorization: "Bearer token" }, body: JSON.stringify({ model: "m1" }) }),
      "p1",
      {
        store: { listForUser: () => [], getWithSecret: () => null },
        verifyToken: () => ({ userId: 1, runtimeId: "r1", providerId: "p1", modelId: "m1", jti: "j", exp: Date.now() + 10_000 }),
        runtimeStore: { getByUserId: () => null },
      },
    );
    expect(response.status).toBe(401);
  });

  it("keeps SSE frames split across upstream chunks", async () => {
    const db = new DatabaseSync(":memory:");
    migrateGatewayDatabase(db);
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('u', 'hash', 'user')").run();
    const store = createProviderStore(db);
    const provider = store.create({ id: "p1", name: "Provider", baseUrl: "https://upstream.test/v1", wireApi: "chat_completions", apiKey: "secret-key" });
    store.upsertModel(provider.id, { modelId: "m1", displayName: "Model", capabilities: { tools: true, streamingTools: true, vision: false, reasoning: false, maxContextTokens: null } });
    store.grant({ userId: 1, providerId: provider.id, modelId: "m1" });
    const token = issueRuntimeModelToken({ userId: 1, runtimeId: "r1", providerId: "p1", modelId: "m1" }, "test-secret");
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const frame = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "OK" } }] })}\n\n`;
        controller.enqueue(encoder.encode(frame.slice(0, 12)));
        controller.enqueue(encoder.encode(frame.slice(12)));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const response = await handleProviderResponses(new Request("http://gateway", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ model: "m1", stream: true }) }), "p1", {
      store,
      runtimeStore: { getByUserId: () => ({ status: "ready" }) },
      fetch: async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
      verifyToken: () => ({ userId: 1, runtimeId: "r1", providerId: "p1", modelId: "m1", jti: "j", exp: Date.now() + 10_000 }),
    });
    const text = await response.text();
    expect(text).toContain('"delta":"OK"');
    expect(text).toContain("response.completed");
  });
});
