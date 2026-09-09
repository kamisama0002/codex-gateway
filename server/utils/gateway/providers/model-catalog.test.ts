import { describe, expect, it } from "vitest";
import { filterManagedModelCatalog } from "./model-catalog";

describe("managed provider model catalog", () => {
  it("exposes only globally enabled models from the runtime provider and recalculates the default", () => {
    const result = filterManagedModelCatalog(
      {
        data: [
          { id: "sol", model: "gpt-5.6-sol", displayName: "Sol", isDefault: true },
          { id: "luna", model: "gpt-5.6-luna", displayName: "Luna" },
          { id: "deepseek", model: "deepseek-v4", displayName: "DeepSeek" },
        ],
        nextCursor: "3",
      },
      [
        { providerId: "gpt", modelId: "gpt-5.6-luna" },
        { providerId: "deepseek", modelId: "deepseek-v4" },
      ],
    );

    expect(result).toEqual({
      data: [{ id: "luna", model: "gpt-5.6-luna", displayName: "Luna", isDefault: true }],
      nextCursor: "3",
    });
  });

  it("adds enabled provider models missing from the app-server catalog", () => {
    const result = filterManagedModelCatalog(
      {
        data: [
          { id: "terra", model: "gpt-5.6-terra", displayName: "Terra", isDefault: true },
        ],
      },
      [
        { providerId: "gpt", modelId: "gpt-5.6-terra", displayName: "Terra" },
        { providerId: "gpt", modelId: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro" },
      ],
    );

    expect(result.data).toEqual([
      { id: "terra", model: "gpt-5.6-terra", displayName: "Terra", isDefault: true },
      { id: "deepseek-v4-pro", model: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro" },
    ]);
  });

  it("uses provider reasoning metadata for existing and discovered models", () => {
    const result = filterManagedModelCatalog(
      {
        data: [{ id: "qwen", model: "qwen3", displayName: "Qwen" }],
      },
      [
        {
          providerId: "qwen",
          modelId: "qwen3",
          displayName: "Qwen 3",
          capabilities: {
            tools: true,
            streamingTools: true,
            vision: true,
            reasoning: true,
            maxContextTokens: 131072,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "low" },
              { reasoningEffort: "medium" },
            ],
          },
        },
        {
          providerId: "qwen",
          modelId: "qwen2",
          displayName: "Qwen 2",
          capabilities: {
            tools: true,
            streamingTools: true,
            vision: false,
            reasoning: true,
            maxContextTokens: null,
            supportedReasoningEfforts: [{ reasoningEffort: "high" }],
          },
        },
      ],
    );

    expect(result.data).toEqual([
      {
        id: "qwen",
        model: "qwen3",
        displayName: "Qwen 3",
        isDefault: true,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          { reasoningEffort: "low" },
          { reasoningEffort: "medium" },
        ],
      },
      {
        id: "qwen2",
        model: "qwen2",
        displayName: "Qwen 2",
        supportedReasoningEfforts: [{ reasoningEffort: "high" }],
      },
    ]);
  });
});
