import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRealtimeServerMessage } from "~~/shared/runtime/realtime";
import { userStore } from "../auth/users";
import { handleRealtimePeerMessage } from "./connection";
import type { RealtimePeer } from "./peer-state";

describe("realtime authentication failure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("closes an invalid bearer session instead of leaving the peer open", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(userStore, "authenticateToken").mockResolvedValue(null);
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

  it("sends database_unavailable without authenticating when token storage rejects", async () => {
    const logError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(userStore, "authenticateToken").mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    );
    const send = vi.fn();
    const peer: RealtimePeer = {
      send,
      close: vi.fn(),
      context: {},
    };

    const token = "stored-session-token";
    await handleRealtimePeerMessage(peer, JSON.stringify({ type: "auth.authenticate", token }));

    const serializedError = String(send.mock.calls[0]?.[0]);
    const errorFrame = parseRealtimeServerMessage(JSON.parse(serializedError));
    expect(errorFrame).toMatchObject({
      type: "error",
      code: "database_unavailable",
      request: { type: "auth.authenticate", token: "[REDACTED]" },
    });
    expect(serializedError).not.toContain(token);
    expect(JSON.stringify(logError.mock.calls)).not.toContain(token);
  });
});
