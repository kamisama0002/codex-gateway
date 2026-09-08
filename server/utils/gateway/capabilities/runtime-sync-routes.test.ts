import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { createEvent } from "h3";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/users";
import { listRuntimeSyncsForEvent } from "../../../api/admin/runtime-syncs/index.get";
import { retryRuntimeSyncForEvent } from "../../../api/admin/runtime-syncs/[userId].post";

describe("runtime capability sync routes", () => {
  it("requires an administrator for listing and retrying", async () => {
    const event = eventFor({ id: 7, username: "user", role: "user" });
    event.context.params = { userId: "8" };
    const store = { list: vi.fn() };
    const reconcile = vi.fn();

    await expect(listRuntimeSyncsForEvent(event, store)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(retryRuntimeSyncForEvent(event, reconcile)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(store.list).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("lists a selected user and retries only the route user and query project", async () => {
    const listEvent = eventFor(
      { id: 1, username: "admin", role: "admin" },
      "/api/admin/runtime-syncs?userId=7",
    );
    const retryEvent = eventFor(
      { id: 1, username: "admin", role: "admin" },
      "/api/admin/runtime-syncs/7?projectId=10&containerId=caller",
    );
    retryEvent.context.params = { userId: "7" };
    const store = { list: vi.fn(async () => [{ userId: 7, status: "succeeded" }]) };
    const reconcile = vi.fn(async () => ({ userId: 7, projectId: 10, status: "succeeded" }));

    await expect(listRuntimeSyncsForEvent(listEvent, store)).resolves.toEqual([
      { userId: 7, status: "succeeded" },
    ]);
    await expect(retryRuntimeSyncForEvent(retryEvent, reconcile)).resolves.toMatchObject({
      userId: 7,
      projectId: 10,
      status: "succeeded",
    });
    expect(store.list).toHaveBeenCalledWith(7);
    expect(reconcile).toHaveBeenCalledWith({
      userId: 7,
      projectId: 10,
      reason: "administratorRetry",
    });
  });
});

function eventFor(user: AuthenticatedUser, url = "/") {
  const request = new IncomingMessage(new Socket());
  request.url = url;
  const response = new ServerResponse(request);
  const event = createEvent(request, response);
  event.context.auth = { user, token: "token" };
  return event;
}
