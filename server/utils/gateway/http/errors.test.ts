import { createEvent } from "h3";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultGatewayConfig } from "../../../../shared/config";
import { z } from "zod";
import { userStore } from "../auth/users";
import { ConfigRevisionConflictError } from "../config/user-config-repository";
import { currentGatewayMemoryState, runWithGatewayUser } from "../state/memory";
import { defineGatewayEventHandler, publicErrorMessage } from "./errors";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("publicErrorMessage", () => {
  it("renders validation issues as readable text", () => {
    const result = z.object({ name: z.string().min(1, "Name is required") }).safeParse({
      name: "",
    });
    if (result.success) throw new Error("Expected validation to fail");
    expect(publicErrorMessage(result.error)).toBe("Name is required");
  });

  it("recovers issue messages serialized by an HTTP validation wrapper", () => {
    expect(
      publicErrorMessage(
        new Error(
          JSON.stringify([
            { code: "custom", path: [], message: "Workspace action is unavailable" },
          ]),
        ),
      ),
    ).toBe("Workspace action is unavailable");
  });
});

describe("defineGatewayEventHandler", () => {
  it("awaits encrypted configuration before invoking an authenticated handler", async () => {
    const config = defaultGatewayConfig();
    config.notifications.bark.group = "loaded-before-handler";
    const loadConfig = vi.spyOn(userStore, "loadConfig").mockResolvedValue({
      config,
      revision: 8,
    });
    const event = gatewayEvent(701);
    const handler = defineGatewayEventHandler(() => ({
      group: currentGatewayMemoryState().notifications.bark.group,
      revision: currentGatewayMemoryState().configRevision,
    }));

    await expect(handler(event)).resolves.toEqual({
      group: "loaded-before-handler",
      revision: 8,
    });
    expect(loadConfig).toHaveBeenCalledWith(701);
  });

  it("shares one initial config load across concurrent requests for a user", async () => {
    let resolveLoad!: (value: {
      config: ReturnType<typeof defaultGatewayConfig>;
      revision: number;
    }) => void;
    const loaded = new Promise<{
      config: ReturnType<typeof defaultGatewayConfig>;
      revision: number;
    }>((resolve) => {
      resolveLoad = resolve;
    });
    const loadConfig = vi.spyOn(userStore, "loadConfig").mockReturnValue(loaded);
    const handler = defineGatewayEventHandler(() => currentGatewayMemoryState().configRevision);

    const first = handler(gatewayEvent(702));
    const second = handler(gatewayEvent(702));
    await Promise.resolve();
    expect(loadConfig).toHaveBeenCalledOnce();

    resolveLoad({ config: defaultGatewayConfig(), revision: 3 });
    await expect(Promise.all([first, second])).resolves.toEqual([3, 3]);
  });

  it("preserves transient state changed while initial config loading is pending", async () => {
    let resolveLoad!: (value: {
      config: ReturnType<typeof defaultGatewayConfig>;
      revision: number;
    }) => void;
    const loadConfig = vi.spyOn(userStore, "loadConfig").mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const handler = defineGatewayEventHandler(() => currentGatewayMemoryState().configRevision);

    const loading = handler(gatewayEvent(704));
    await vi.waitFor(() => expect(loadConfig).toHaveBeenCalledOnce());
    runWithGatewayUser(704, () => {
      const state = currentGatewayMemoryState();
      state.events.push({
        id: 91_001,
        hostId: 1,
        threadId: "thread-during-load",
        method: "thread/status/changed",
        payload: { method: "thread/status/changed", params: { status: "running" } },
        createdAt: "2026-09-05T01:00:00.000Z",
      });
      state.nextEventId = 91_002;
      state.deliveredNotificationKeys.push("notification-during-load");
    });

    const config = defaultGatewayConfig();
    config.notifications.bark.group = "loaded config";
    resolveLoad({ config, revision: 9 });
    await expect(loading).resolves.toBe(9);
    runWithGatewayUser(704, () => {
      expect(currentGatewayMemoryState()).toMatchObject({
        configRevision: 9,
        nextEventId: 91_002,
        deliveredNotificationKeys: ["notification-during-load"],
      });
      expect(currentGatewayMemoryState().events.map((event) => event.id)).toEqual([91_001]);
      expect(currentGatewayMemoryState().notifications.bark.group).toBe("loaded config");
    });
  });

  it("leaves memory unloaded after config decryption fails and permits a retry", async () => {
    const loadConfig = vi
      .spyOn(userStore, "loadConfig")
      .mockRejectedValueOnce(new Error("Invalid encrypted config format"))
      .mockResolvedValueOnce({ config: defaultGatewayConfig(), revision: 6 });
    const handler = defineGatewayEventHandler(() => currentGatewayMemoryState().configRevision);

    await expect(handler(gatewayEvent(703))).resolves.toMatchObject({
      error: true,
      message: "Invalid encrypted config format",
    });
    runWithGatewayUser(703, () => {
      expect(currentGatewayMemoryState()).toMatchObject({
        configLoaded: false,
        configRevision: 0,
      });
    });

    await expect(handler(gatewayEvent(703))).resolves.toBe(6);
    expect(loadConfig).toHaveBeenCalledTimes(2);
  });

  it("maps config revision conflicts to HTTP 409 with the stable public code", async () => {
    const event = gatewayEvent(null);
    const handler = defineGatewayEventHandler(() => {
      throw new ConfigRevisionConflictError("stale");
    });

    await expect(handler(event)).resolves.toMatchObject({
      error: true,
      statusCode: 409,
      code: "config_revision_conflict",
    });
    expect(event.node.res.statusCode).toBe(409);
  });
});

function gatewayEvent(userId: number | null) {
  const request = new IncomingMessage(new Socket());
  const event = createEvent(request, new ServerResponse(request));
  if (userId !== null) {
    event.context.auth = {
      user: { id: userId, username: `user-${userId}`, role: "user" },
      token: "token",
    };
  }
  return event;
}
