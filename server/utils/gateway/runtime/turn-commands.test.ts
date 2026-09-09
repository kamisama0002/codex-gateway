import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostRecord } from "~~/shared/types";
import { CodexRpcClient } from "../infra/rpc/rpc";
import { ControllerRegistry } from "./controller-registry";
import { ThreadHistoryReader } from "./thread-history-reader";
import { ThreadOpenService } from "./thread-open-service";
import { ThreadController } from "./thread-controller";
import type { TurnStartInput } from "./types";

const record = vi.hoisted(() => vi.fn());

vi.mock("./thread-runtime-events", () => ({
  threadRuntimeEvents: { record },
}));

import { ThreadTurnCommandService } from "./turn-commands";

describe("ThreadTurnCommandService", () => {
  beforeEach(() => {
    record.mockReset();
  });

  it("publishes a terminal error event when turn admission times out", async () => {
    const host: HostRecord = {
      id: 2,
      connectionKind: "managed",
      name: "Managed",
      sshHost: "managed-runtime.internal",
      username: null,
      port: null,
      authMode: "agent",
      privateKeyPath: null,
      proxyUrl: null,
      hasPassword: false,
      createdAt: "",
      updatedAt: "",
    };
    const client = new CodexRpcClient(host, { skipVersionCheck: true });
    vi.spyOn(client, "request").mockRejectedValue(
      new Error("Codex RPC request timed out: turn/start"),
    );
    const controller = new ThreadController(host, "thread-1", client, true, true, false);
    const registry = new ControllerRegistry();
    vi.spyOn(registry, "withScopedSubscription").mockImplementation(
      async (_host, _threadId, operation) => operation(controller),
    );
    const openService = new ThreadOpenService(registry, new ThreadHistoryReader(registry));
    const service = new ThreadTurnCommandService(registry, openService);
    const input: TurnStartInput = { text: "hello" };

    await expect(service.startTurn(host, "thread-1", input)).rejects.toThrow("timed out");

    expect(record).toHaveBeenCalledWith(
      2,
      "thread-1",
      "error",
      {
        method: "error",
        params: {
          threadId: "thread-1",
          turnId: null,
          willRetry: false,
          error: { message: "Model request timed out before the turn started. Please retry." },
        },
      },
    );
    expect(record).toHaveBeenCalledOnce();
  });
});
