import { describe, expect, it, vi } from "vitest";
import type { ProviderStore } from "../providers/provider-store";
import { generateModelThreadTitle } from "./model-title";

describe("generateModelThreadTitle", () => {
  it.each([
    {
      wireApi: "responses" as const,
      upstream: { output_text: "  月度营业额分析  " },
      expectedPath: "/responses",
    },
    {
      wireApi: "chat_completions" as const,
      upstream: { choices: [{ message: { role: "assistant", content: "  月度营业额分析  " } }] },
      expectedPath: "/chat/completions",
    },
  ])("generates a normalized title through $wireApi", async (scenario) => {
    const requests: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fetcher: typeof globalThis.fetch = async (input, init) => {
      requests.push({ input, init });
      return Response.json(scenario.upstream);
    };
    const store = providerStoreFixture(scenario.wireApi);
    const title = await generateModelThreadTitle(
      {
        userId: 7,
        model: "model-1",
        message: "分析本月营业额，并找出主要异常。",
        signal: new AbortController().signal,
      },
      { store, fetch: fetcher },
    );

    expect(title).toBe("月度营业额分析");
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.input).toBe(`https://provider.test/v1${scenario.expectedPath}`);
    const requestBody = request?.init?.body;
    if (typeof requestBody !== "string") throw new Error("Expected a JSON request body");
    const payload: unknown = JSON.parse(requestBody);
    expect(payload).toMatchObject({ model: "model-1", stream: false });
  });

  it("does not fall back to a different granted model", async () => {
    await expect(
      generateModelThreadTitle(
        {
          userId: 7,
          model: "other-model",
          message: "hello",
          signal: new AbortController().signal,
        },
        { store: providerStoreFixture("responses"), fetch: vi.fn() },
      ),
    ).rejects.toThrow("current turn");
  });
});

function providerStoreFixture(wireApi: "responses" | "chat_completions") {
  return {
    listForUser: () => [
      {
        providerId: "provider-1",
        modelId: "model-1",
        displayName: "Model 1",
        enabled: true,
        capabilities: {
          tools: false,
          streamingTools: false,
          vision: false,
          reasoning: true,
          maxContextTokens: null,
        },
        provider: {
          id: "provider-1",
          name: "Provider",
          baseUrl: "https://provider.test/v1",
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
    getWithSecret: () => ({
      id: "provider-1",
      name: "Provider",
      baseUrl: "https://provider.test/v1",
      wireApi,
      apiKey: "test-secret",
      encryptedApiKey: "encrypted",
      enabled: true,
      requestTimeoutMs: 30_000,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
  } satisfies Pick<ProviderStore, "listForUser" | "getWithSecret">;
}
