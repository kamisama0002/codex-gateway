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
});
