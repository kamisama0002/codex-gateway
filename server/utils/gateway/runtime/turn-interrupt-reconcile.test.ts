import { describe, expect, it, vi } from "vitest";
import { CodexRpcError } from "../http/errors";
import { interruptTurnAndReconcile } from "./turn-interrupt-reconcile";

describe("interruptTurnAndReconcile", () => {
  it("treats no active turn as already stopped and refreshes live status", async () => {
    const request = vi.fn(async () => {
      throw new CodexRpcError("turn/interrupt", -32600, "no active turn to interrupt");
    });
    const onIdle = vi.fn(async () => undefined);

    await expect(
      interruptTurnAndReconcile({
        turnId: "stale-turn",
        request,
        onIdle,
      }),
    ).resolves.toEqual({});
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("retries interrupt against the current active turn id", async () => {
    const request = vi.fn(async (turnId: string) => {
      if (turnId === "stale-turn") {
        throw new CodexRpcError(
          "turn/interrupt",
          -32600,
          "expected active turn id stale-turn but found live-turn",
        );
      }
      return { accepted: true };
    });
    const onIdle = vi.fn(async () => undefined);
    const onStaleTurn = vi.fn();

    await expect(
      interruptTurnAndReconcile({
        turnId: "stale-turn",
        request,
        onStaleTurn,
        onIdle,
      }),
    ).resolves.toEqual({ accepted: true });
    expect(request).toHaveBeenCalledTimes(2);
    expect(onStaleTurn).toHaveBeenCalledWith("live-turn");
    expect(onIdle).not.toHaveBeenCalled();
  });
});
