import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRealtimePeerMessage } from "./connection";
import type { RealtimePeer } from "./peer-state";

describe("realtime authentication failure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("closes an invalid bearer session instead of leaving the peer open", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const close = vi.fn();
    const peer: RealtimePeer = {
      send: vi.fn(),
      close: (code, reason) => {
        close(code, reason);
      },
      context: {},
    };

    await handleRealtimePeerMessage(
      peer,
      JSON.stringify({ type: "auth.authenticate", token: "expired-session-token" }),
    );

    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith(4401, "Authentication required");
  });
});
