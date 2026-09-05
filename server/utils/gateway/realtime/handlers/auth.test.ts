import { afterEach, describe, expect, it, vi } from "vitest";
import { userStore } from "../../auth/users";
import { stateFor, type RealtimePeer } from "../peer-state";
import { authenticatePeer } from "./auth";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("realtime peer authentication", () => {
  it("does not authenticate the peer before the token query resolves", async () => {
    let resolveAuthentication!: (user: { id: number; username: string; role: "user" }) => void;
    vi.spyOn(userStore, "authenticateToken").mockReturnValue(
      new Promise((resolve) => {
        resolveAuthentication = resolve;
      }),
    );
    const { peer, send } = realtimePeer();

    const authentication = authenticatePeer(peer, {
      type: "auth.authenticate",
      token: "stored-token",
    });

    expect(stateFor(peer).authenticated).toBe(false);
    expect(send).not.toHaveBeenCalled();

    resolveAuthentication({ id: 7, username: "stored-user", role: "user" });
    await authentication;

    expect(stateFor(peer)).toMatchObject({ authenticated: true, userId: 7 });
  });

  it("keeps the peer unauthenticated and reports database_unavailable when storage rejects", async () => {
    vi.spyOn(userStore, "authenticateToken").mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    );
    const { peer, send } = realtimePeer();

    await expect(
      authenticatePeer(peer, { type: "auth.authenticate", token: "stored-token" }),
    ).rejects.toMatchObject({
      code: "database_unavailable",
      statusCode: 503,
    });

    expect(stateFor(peer).authenticated).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

function realtimePeer() {
  const send = vi.fn();
  const peer: RealtimePeer = {
    send,
    close: vi.fn(),
    context: {},
  };
  return {
    peer,
    send,
  };
}
