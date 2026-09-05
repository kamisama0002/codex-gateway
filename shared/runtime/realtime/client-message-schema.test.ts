import { describe, expect, it } from "vitest";
import { parseRealtimeClientMessage } from "../realtime";

describe("realtime request cancellation message", () => {
  it("accepts a request cancellation with an opaque target request id", () => {
    expect(
      parseRealtimeClientMessage({
        type: "request.cancel",
        targetRequestId: "gateway-ws-request-1",
      }),
    ).toEqual({
      type: "request.cancel",
      targetRequestId: "gateway-ws-request-1",
    });
  });
});
