import { describe, expect, it, vi } from "vitest";
import { discoverProviderModels, normalizeModelList } from "./model-discovery";

describe("provider model discovery", () => {
  it("normalizes OpenAI-compatible model metadata and reasoning levels", () => {
    expect(
      normalizeModelList({
        object: "list",
        data: [
          {
            id: "qwen3-max",
            display_name: "Qwen 3 Max",
            context_length: 131072,
            capabilities: {
              tools: true,
              streaming_tools: false,
              vision: true,
              supported_reasoning_efforts: [
                { reasoning_effort: "low", description: "Quick" },
                "high",
              ],
              default_reasoning_effort: "low",
            },
          },
        ],
      }),
    ).toEqual([
      {
        modelId: "qwen3-max",
        displayName: "Qwen 3 Max",
        enabled: true,
        capabilities: {
          tools: true,
          streamingTools: false,
          vision: true,
          reasoning: true,
          maxContextTokens: 131072,
          defaultReasoningEffort: "low",
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Quick" },
            { reasoningEffort: "high", description: null },
          ],
        },
      },
    ]);
  });

  it("skips unusable and duplicate model records", () => {
    expect(
      normalizeModelList({ data: [{ id: "valid" }, { id: "valid" }, { object: "model" }] }),
    ).toHaveLength(1);
  });

  it("uses the provider URL, bearer key, and timeout", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ data: [{ id: "model-a" }] }),
    );
    const result = await discoverProviderModels(
      {
        baseUrl: "https://provider.example/v1/",
        wireApi: "responses",
        apiKey: "secret",
        requestTimeoutMs: 5000,
      },
      fetcher,
    );
    expect(result[0]?.modelId).toBe("model-a");
    expect(fetcher).toHaveBeenCalledWith(
      "https://provider.example/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ authorization: "Bearer secret" }),
      }),
    );
  });
});
