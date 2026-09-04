import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { createEvent } from "h3";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/users";
import { runtimeStatusForEvent } from "../../../api/runtime/me.get";
import { startRuntimeForEvent } from "../../../api/runtime/start.post";
import { restartOwnRuntimeForEvent } from "../../../api/runtime/restart.post";
import { listRuntimesForEvent } from "../../../api/admin/runtimes/index.get";
import { restartRuntimeForEvent } from "../../../api/admin/runtimes/[userId]/restart.post";

describe("runtime routes", () => {
  it("derives status and start ownership only from the authenticated user", async () => {
    const service = {
      getStatus: vi.fn(() => ({ userId: 7, status: "ready" })),
      start: vi.fn(async () => ({ userId: 7, status: "ready" })),
      restart: vi.fn(async () => ({ userId: 7, status: "ready" })),
    };
    const event = eventFor({ id: 7, username: "user", role: "user" });
    event.context.body = { userId: 99, containerId: "caller-container", endpoint: "ws://caller" };

    expect(runtimeStatusForEvent(event, service)).toEqual({ userId: 7, status: "ready" });
    await expect(startRuntimeForEvent(event, service)).resolves.toEqual({
      userId: 7,
      status: "ready",
    });
    await expect(restartOwnRuntimeForEvent(event, service)).resolves.toEqual({
      userId: 7,
      status: "ready",
    });
    expect(service.getStatus).toHaveBeenCalledWith(7);
    expect(service.start).toHaveBeenCalledWith(7, 7);
    expect(service.restart).toHaveBeenCalledWith(7, 7);
  });

  it("requires an administrator and accepts only the target user ID for restart", async () => {
    const service = {
      listStatuses: vi.fn(() => [{ userId: 7, status: "ready" }]),
      restart: vi.fn(async () => ({ userId: 7, status: "ready" })),
    };
    const ordinaryEvent = eventFor({ id: 7, username: "user", role: "user" });
    ordinaryEvent.context.params = { userId: "8" };
    expect(() => listRuntimesForEvent(ordinaryEvent, service)).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    );
    expect(() => restartRuntimeForEvent(ordinaryEvent, service)).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    );

    const adminEvent = eventFor({ id: 1, username: "admin", role: "admin" });
    adminEvent.context.params = { userId: "7" };
    adminEvent.context.body = {
      userId: 99,
      containerId: "caller-container",
      endpoint: "ws://caller",
      serviceToken: "caller-token",
    };
    expect(listRuntimesForEvent(adminEvent, service)).toEqual([{ userId: 7, status: "ready" }]);
    await expect(restartRuntimeForEvent(adminEvent, service)).resolves.toEqual({
      userId: 7,
      status: "ready",
    });
    expect(service.restart).toHaveBeenCalledWith(7, 1);
  });
});

function eventFor(user: AuthenticatedUser) {
  const request = new IncomingMessage(new Socket());
  const response = new ServerResponse(request);
  const event = createEvent(request, response);
  event.context.auth = { user, token: "token" };
  return event;
}
