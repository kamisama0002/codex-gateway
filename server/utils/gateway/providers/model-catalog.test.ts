import { describe, expect, it } from "vitest";
import { filterManagedModelCatalog } from "./model-catalog";

describe("managed provider model catalog", () => {
  it("exposes only enabled grants from the runtime provider and recalculates the default", () => {
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
});
