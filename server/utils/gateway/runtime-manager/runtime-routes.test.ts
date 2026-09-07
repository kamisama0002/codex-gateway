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
    const view = runtimeView();
    const absent = absentRuntimeView();
    const service = {
      getStatus: vi.fn(async () => ({ userId: 7, status: "ready" })),
      getStatusView: vi.fn().mockResolvedValueOnce(absent).mockResolvedValue(view),
      start: vi.fn(async () => ({ userId: 7, status: "ready" })),
      restart: vi.fn(async () => ({ userId: 7, status: "ready" })),
    };
    const event = eventFor({ id: 7, username: "user", role: "user" });
    event.context.body = { userId: 99, containerId: "caller-container", endpoint: "ws://caller" };

    await expect(runtimeStatusForEvent(event, service)).resolves.toEqual(absent);
    await expect(startRuntimeForEvent(event, service)).resolves.toEqual(view);
    await expect(restartOwnRuntimeForEvent(event, service)).resolves.toEqual(view);
    expect(service.getStatusView).toHaveBeenCalledTimes(3);
    expect(service.getStatusView).toHaveBeenNthCalledWith(1, 7);
    expect(service.getStatusView).toHaveBeenNthCalledWith(2, 7);
    expect(service.getStatusView).toHaveBeenNthCalledWith(3, 7);
    expect(service.start).toHaveBeenCalledWith(7, 7);
    expect(service.restart).toHaveBeenCalledWith(7, 7);
    expect(JSON.stringify(view)).not.toMatch(/tenantId|containerId|serviceToken|runtimeId/i);
  });

  it("requires an administrator and accepts only the target user ID for restart", async () => {
    const view = runtimeView();
    const service = {
      listStatuses: vi.fn(async () => [{ userId: 7, status: "ready" }]),
      listStatusViews: vi.fn(async () => [view]),
      getStatusView: vi.fn(async () => view),
      restart: vi.fn(async () => ({ userId: 7, status: "ready" })),
    };
    const ordinaryEvent = eventFor({ id: 7, username: "user", role: "user" });
    ordinaryEvent.context.params = { userId: "8" };
    await expect(listRuntimesForEvent(ordinaryEvent, service)).rejects.toEqual(
      expect.objectContaining({ statusCode: 403 }),
    );
    await expect(restartRuntimeForEvent(ordinaryEvent, service)).rejects.toEqual(
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
    await expect(listRuntimesForEvent(adminEvent, service)).resolves.toEqual([view]);
    await expect(restartRuntimeForEvent(adminEvent, service)).resolves.toEqual(view);
    expect(service.listStatusViews).toHaveBeenCalledOnce();
    expect(service.restart).toHaveBeenCalledWith(7, 1);
    expect(service.getStatusView).toHaveBeenCalledWith(7);
  });
});

function runtimeView() {
  return {
    runtime: {
      userId: 7,
      hostId: 2_000_000_000,
      runtimeType: "codex-app-server" as const,
      imageVersion: "0.151.0",
      runtimeVersion: "0.151.0",
      schemaHash: "schema-v1",
      status: "ready" as const,
      lastError: null,
      createdAt: "2026-09-07T00:00:00.000Z",
      updatedAt: "2026-09-07T00:00:01.000Z",
    },
    assignedPolicy: {
      imageAlias: "tenant-stable",
      memoryMiB: 1024,
      cpuCores: 1.5,
      pidsLimit: 128,
    },
    actualResources: {
      memoryBytes: 1024 * 1024 * 1024,
      nanoCpus: 1_500_000_000,
      pidsLimit: 128,
    },
    currentImageAlias: "tenant-stable",
    requiresRestart: false,
    requiresUpgrade: false,
  };
}

function absentRuntimeView() {
  return {
    runtime: null,
    assignedPolicy: null,
    actualResources: null,
    currentImageAlias: null,
    requiresRestart: false,
    requiresUpgrade: false,
  };
}

function eventFor(user: AuthenticatedUser) {
  const request = new IncomingMessage(new Socket());
  const response = new ServerResponse(request);
  const event = createEvent(request, response);
  event.context.auth = { user, token: "token" };
  return event;
}
