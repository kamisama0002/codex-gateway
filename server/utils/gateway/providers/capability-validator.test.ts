import { describe, expect, it } from "vitest";
import { assertProviderSupportsRequest } from "./capability-validator";

describe("provider capability validation", () => {
  it("rejects streamed tools when the model lacks streaming tool support", () => {
    expect(() =>
      assertProviderSupportsRequest(
        { model: "m", stream: true, tools: [{ type: "function", name: "f" }] },
        { tools: true, streamingTools: false, vision: false, reasoning: false, maxContextTokens: null },
      ),
    ).toThrow(/streaming tools/);
  });
});
