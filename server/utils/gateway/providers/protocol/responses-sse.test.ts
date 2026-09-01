import { describe, expect, it } from "vitest";
import { encodeResponsesSse, parseResponsesSseChunk } from "./responses-sse";

describe("Responses SSE", () => {
  it("encodes and parses a Responses event", () => {
    const text = new TextDecoder().decode(encodeResponsesSse({ type: "response.output_text.delta", delta: "OK" }));
    expect(parseResponsesSseChunk(text)).toEqual([{ type: "response.output_text.delta", delta: "OK" }]);
  });
});
