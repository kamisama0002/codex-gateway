import { describe, expect, it } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import { createProviderStore, type ProviderStore } from "./provider-store";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";
import { issueRuntimeModelToken, verifyRuntimeModelToken } from "./runtime-token";
import { handleProviderResponses } from "./provider-proxy";

describe("provider proxy", () => {
  it("allows a runtime to switch to another globally enabled model from the same provider", async () => {
    const db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await db.execute(
      "INSERT INTO users (username, password_hash, role) VALUES ('u', 'hash', 'user')",
    );
    const store = createProviderStore(db);
    const provider = await store.create({
      id: "p1",
      name: "Provider",
      baseUrl: "https://upstream.test/v1",
      wireApi: "responses",
      apiKey: "secret-key",
    });
    for (const modelId of ["m1", "m2"]) {
      await store.upsertModel(provider.id, {
        modelId,
        displayName: modelId.toUpperCase(),
        capabilities: {
          tools: true,
          streamingTools: true,
          vision: false,
          reasoning: true,
          maxContextTokens: null,
        },
      });
    }
    const token = issueRuntimeModelToken(
      { userId: 1, runtimeId: "r1", providerId: "p1", modelId: "m1" },
      "test-secret",
    );
    const response = await handleProviderResponses(
      new Request("http://gateway/api/internal/providers/p1/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "m2", input: "hello" }),
      }),
      "p1",
      {
        store,
        verifyToken: (value, scope) => verifyRuntimeModelToken(value, scope, "test-secret"),
        fetch: async (_url, init) => {
          const upstreamBody = init?.body;
          expect(typeof upstreamBody).toBe("string");
          expect(
            JSON.parse(typeof upstreamBody === "string" ? upstreamBody : "null"),
          ).toMatchObject({ model: "m2" });
          return Response.json({
            id: "response-1",
            object: "response",
            model: "m2",
            status: "completed",
            output: [],
          });
        },
        runtimeStore: { getByUserId: async () => ({ status: "ready" }) },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ model: "m2", status: "completed" });
  });

  it("translates a Chat Completions upstream into Responses JSON", async () => {
    const { store, token } = memoryProviderFixture("chat_completions");
    let seen: RequestInit | undefined;
    const response = await handleProviderResponses(
      new Request("http://gateway/api/internal/providers/p1/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "m1", input: "hello" }),
      }),
      "p1",
      {
        store,
        verifyToken: (value, scope) => {
          expect(value).toBe(token);
          expect(scope).toEqual({ providerId: "p1" });
          return {
            userId: 1,
            runtimeId: "r1",
            providerId: "p1",
            modelId: "m1",
            jti: "j",
            exp: Date.now() + 10_000,
          };
        },
        fetch: async (url, init) => {
          expect(url).toBe("https://upstream.test/v1/chat/completions");
          seen = init;
          return new Response(
            JSON.stringify({
              id: "chat-1",
              model: "m1",
              choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
        runtimeStore: { getByUserId: async () => ({ status: "ready" }) },
      },
    );
    expect(await response.json()).toMatchObject({
      object: "response",
      output_text: "OK",
      status: "completed",
    });
    expect(seen?.headers).toMatchObject({ authorization: "Bearer secret-key" });
  });

  it("rejects a globally disabled model before contacting upstream", async () => {
    const db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    await db.execute(
      "INSERT INTO users (username, password_hash, role) VALUES ('u', 'hash', 'user')",
    );
    const store = createProviderStore(db);
    const provider = await store.create({
      id: "p1",
      name: "Provider",
      baseUrl: "https://upstream.test/v1",
      wireApi: "responses",
      apiKey: "secret-key",
    });
    await store.upsertModel(provider.id, {
      modelId: "m1",
      displayName: "Model",
      enabled: false,
      capabilities: {
        tools: false,
        streamingTools: false,
        vision: false,
        reasoning: false,
        maxContextTokens: null,
      },
    });
    const token = issueRuntimeModelToken(
      { userId: 1, runtimeId: "r1", providerId: "p1", modelId: "m1" },
      "test-secret",
    );
    const response = await handleProviderResponses(
      new Request("http://gateway", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ model: "m1" }),
      }),
      "p1",
      {
        store,
        fetch: async () => {
          throw new Error("must not call");
        },
        verifyToken: () => ({
          userId: 1,
          runtimeId: "r1",
          providerId: "p1",
          modelId: "m1",
          jti: "j",
          exp: Date.now() + 10_000,
        }),
        runtimeStore: { getByUserId: async () => ({ status: "ready" }) },
      },
    );
    expect(response.status).toBe(403);
  });

  it("rejects a token after its runtime is removed", async () => {
    const response = await handleProviderResponses(
      new Request("http://gateway", {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: JSON.stringify({ model: "m1" }),
      }),
      "p1",
      {
        store: { listForUser: async () => [], getWithSecret: async () => null },
        verifyToken: () => ({
          userId: 1,
          runtimeId: "r1",
          providerId: "p1",
          modelId: "m1",
          jti: "j",
          exp: Date.now() + 10_000,
        }),
        runtimeStore: { getByUserId: async () => null },
      },
    );
    expect(response.status).toBe(401);
  });

  it("awaits runtime readiness, model authorization, and the provider secret before fetch", async () => {
    const runtime = deferred<{ status: string } | null>();
    const models =
      deferred<Awaited<ReturnType<ReturnType<typeof createProviderStore>["listForUser"]>>>();
    const provider =
      deferred<Awaited<ReturnType<ReturnType<typeof createProviderStore>["getWithSecret"]>>>();
    const calls: string[] = [];
    const responsePromise = handleProviderResponses(
      new Request("http://gateway", {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: JSON.stringify({ model: "m1" }),
      }),
      "p1",
      {
        runtimeStore: {
          getByUserId: async () => {
            calls.push("runtime");
            return await runtime.promise;
          },
        },
        store: {
          listForUser: async () => {
            calls.push("models");
            return await models.promise;
          },
          getWithSecret: async () => {
            calls.push("secret");
            return await provider.promise;
          },
        },
        verifyToken: () => ({
          userId: 1,
          runtimeId: "r1",
          providerId: "p1",
          modelId: "m1",
          jti: "j",
          exp: Date.now() + 10_000,
        }),
        fetch: async () => {
          calls.push("fetch");
          return Response.json({
            id: "response-1",
            object: "response",
            model: "m1",
            status: "completed",
            output: [],
          });
        },
      },
    );

    await nextTask();
    expect(calls).toEqual(["runtime"]);
    runtime.resolve({ status: "ready" });
    await nextTask();
    expect(calls).toEqual(["runtime", "models"]);
    models.resolve([
      {
        providerId: "p1",
        modelId: "m1",
        displayName: "Model",
        enabled: true,
        capabilities: {
          tools: false,
          streamingTools: false,
          vision: false,
          reasoning: false,
          maxContextTokens: null,
        },
        provider: {
          id: "p1",
          name: "Provider",
          baseUrl: "https://upstream.test/v1",
          wireApi: "responses",
          enabled: true,
          hasApiKey: true,
          requestTimeoutMs: 30_000,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    await nextTask();
    expect(calls).toEqual(["runtime", "models", "secret"]);
    provider.resolve({
      id: "p1",
      name: "Provider",
      baseUrl: "https://upstream.test/v1",
      wireApi: "responses",
      apiKey: "secret-key",
      encryptedApiKey: "encrypted",
      enabled: true,
      requestTimeoutMs: 30_000,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await expect(responsePromise).resolves.toMatchObject({ status: 200 });
    expect(calls).toEqual(["runtime", "models", "secret", "fetch"]);
  });

  it.each([
    [401, '{"error":{"message":"Invalid API key"}}', 400, "provider_unauthorized"],
    [403, '{"error":{"message":"Model access denied"}}', 400, "provider_forbidden"],
    [
      429,
      '{"error":{"code":"insufficient_quota","message":"No balance"}}',
      400,
      "provider_quota_exhausted",
    ],
    [429, '{"error":{"message":"Rate limited"}}', 429, "provider_rate_limited"],
    [503, '{"error":{"message":"Temporarily unavailable"}}', 503, "provider_unavailable"],
  ] as const)(
    "maps upstream HTTP %s to an actionable provider failure",
    async (upstreamStatus, upstreamBody, expectedStatus, expectedCode) => {
      const { store, token } = memoryProviderFixture("responses");
      const response = await handleProviderResponses(
        new Request("http://gateway", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({ model: "m1" }),
        }),
        "p1",
        {
          store,
          fetch: async () =>
            new Response(upstreamBody, {
              status: upstreamStatus,
              headers: { "retry-after": "3" },
            }),
          verifyToken: () => ({
            userId: 1,
            runtimeId: "r1",
            providerId: "p1",
            modelId: "m1",
            jti: "j",
            exp: Date.now() + 10_000,
          }),
          runtimeStore: { getByUserId: async () => ({ status: "ready" }) },
        },
      );

      expect(response.status).toBe(expectedStatus);
      expect(await response.json()).toMatchObject({
        error: { code: expectedCode },
      });
      expect(response.headers.get("retry-after")).toBe(
        expectedStatus === upstreamStatus && upstreamStatus >= 429 ? "3" : null,
      );
    },
  );

  it("keeps SSE frames split across upstream chunks", async () => {
    const { store, token } = memoryProviderFixture("chat_completions");
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
    const response = await handleProviderResponses(
      new Request("http://gateway", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ model: "m1", stream: true }),
      }),
      "p1",
      {
        store,
        runtimeStore: { getByUserId: async () => ({ status: "ready" }) },
        fetch: async () =>
          new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
        verifyToken: () => ({
          userId: 1,
          runtimeId: "r1",
          providerId: "p1",
          modelId: "m1",
          jti: "j",
          exp: Date.now() + 10_000,
        }),
      },
    );
    const text = await response.text();
    expect(text).toContain('"delta":"OK"');
    expect(text).toContain("response.completed");
  });

  it("rejects the next stream read when a provider stays idle after a chunk", async () => {
    const { store, token } = memoryProviderFixture("responses");
    const encoder = new TextEncoder();
    let cancelled = false;
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: chunk\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await handleProviderResponses(
      new Request("http://gateway", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ model: "m1", stream: true }),
      }),
      "p1",
      {
        store,
        streamIdleTimeoutMs: 20,
        fetch: async () => new Response(upstreamBody, { status: 200 }),
        verifyToken: () => ({
          userId: 1,
          runtimeId: "r1",
          providerId: "p1",
          modelId: "m1",
          jti: "j",
          exp: Date.now() + 10_000,
        }),
        runtimeStore: { getByUserId: async () => ({ status: "ready" }) },
      },
    );

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    expect(await reader?.read()).toMatchObject({ done: false });
    await expect(reader?.read()).rejects.toThrow("provider_stream_timeout");
    expect(cancelled).toBe(true);
  }, 250);

  it("preserves the idle-timeout error when upstream cancellation rejects", async () => {
    const { store, token } = memoryProviderFixture("responses");
    const cancelFailure = new Error("upstream cancel failed");
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const upstreamBody = new ReadableStream<Uint8Array>({
      cancel() {
        return Promise.reject(cancelFailure);
      },
    });

    try {
      const response = await handleProviderResponses(
        new Request("http://gateway", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({ model: "m1", stream: true }),
        }),
        "p1",
        {
          store,
          streamIdleTimeoutMs: 20,
          fetch: async () => new Response(upstreamBody, { status: 200 }),
          verifyToken: () => ({
            userId: 1,
            runtimeId: "r1",
            providerId: "p1",
            modelId: "m1",
            jti: "j",
            exp: Date.now() + 10_000,
          }),
          runtimeStore: { getByUserId: async () => ({ status: "ready" }) },
        },
      );

      const reader = response.body?.getReader();
      await expect(reader?.read()).rejects.toThrow("provider_stream_timeout");
      await nextTask();
      expect(unhandled).not.toContain(cancelFailure);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  }, 250);

  it("absorbs an upstream cancellation rejection when a translated stream is cancelled", async () => {
    const { store, token } = memoryProviderFixture("chat_completions");
    const cancelFailure = new Error("translated upstream cancel failed");
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const upstreamBody = new ReadableStream<Uint8Array>({
      cancel() {
        return Promise.reject(cancelFailure);
      },
    });

    try {
      const response = await handleProviderResponses(
        new Request("http://gateway", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({ model: "m1", stream: true }),
        }),
        "p1",
        {
          store,
          streamIdleTimeoutMs: 20,
          fetch: async () => new Response(upstreamBody, { status: 200 }),
          verifyToken: () => ({
            userId: 1,
            runtimeId: "r1",
            providerId: "p1",
            modelId: "m1",
            jti: "j",
            exp: Date.now() + 10_000,
          }),
          runtimeStore: { getByUserId: async () => ({ status: "ready" }) },
        },
      );

      await response.body?.getReader().cancel("consumer cancelled");
      await nextTask();
      expect(unhandled).not.toContain(cancelFailure);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

function nextTask() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function memoryProviderFixture(wireApi: "responses" | "chat_completions") {
  const store = {
    listForUser: async () => [
      {
        providerId: "p1",
        modelId: "m1",
        displayName: "Model",
        enabled: true,
        capabilities: {
          tools: false,
          streamingTools: false,
          vision: false,
          reasoning: false,
          maxContextTokens: null,
        },
        provider: {
          id: "p1",
          name: "Provider",
          baseUrl: "https://upstream.test/v1",
          wireApi,
          enabled: true,
          hasApiKey: true,
          requestTimeoutMs: 30_000,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    getWithSecret: async () => ({
      id: "p1",
      name: "Provider",
      baseUrl: "https://upstream.test/v1",
      wireApi,
      apiKey: "secret-key",
      encryptedApiKey: "encrypted",
      enabled: true,
      requestTimeoutMs: 30_000,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
  } satisfies Pick<ProviderStore, "listForUser" | "getWithSecret">;
  return {
    store,
    token: issueRuntimeModelToken(
      { userId: 1, runtimeId: "r1", providerId: "p1", modelId: "m1" },
      "test-secret",
    ),
  };
}
