import { describe, expect, it, vi } from "vitest";
import type { HostRecord } from "~~/shared/types";
import { recordFromUnknown } from "~~/shared/utils/records";
import { ThreadQueueService, type ThreadQueueControllerRegistry } from "./thread-queue";

const host = {
  id: 1,
  name: "host",
  sshHost: "127.0.0.1",
  username: "codex",
  port: 22,
  authMode: "agent",
  privateKeyPath: null,
  proxyUrl: null,
  hasPassword: false,
  createdAt: "",
  updatedAt: "",
} satisfies HostRecord;

describe("ThreadQueueService", () => {
  it("maps all official queue operations and preserves paginated order", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const request = vi.fn(async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "thread/queue/list") {
        const cursor = recordFromUnknown(params)?.cursor ?? null;
        return cursor === null
          ? {
              data: [submission("queue-1", "first")],
              nextCursor: "cursor-2",
            }
          : { data: [submission("queue-2", "second")], nextCursor: null };
      }
      if (method === "thread/queue/add" || method === "thread/queue/update") {
        return { queuedSubmission: submission("queue-1", "updated") };
      }
      if (method === "thread/queue/delete") return { deleted: true };
      if (method === "thread/queue/start") return { turn: turn("turn-queued") };
      return {};
    });
    const { service } = serviceWithRequest(request);
    const input = [{ type: "text", text: "queued", text_elements: [] }];

    expect((await service.list(host, "thread-1")).map((item) => item.id)).toEqual([
      "queue-1",
      "queue-2",
    ]);
    await service.add(host, "thread-1", input, "client-1");
    await service.update(host, "thread-1", "queue-1", input);
    await service.delete(host, "thread-1", "queue-1");
    await service.reorder(host, "thread-1", ["queue-2", "queue-1"]);
    await service.start(host, "thread-1", "queue-2");

    expect(requests.map(({ method }) => method)).toEqual([
      "thread/queue/list",
      "thread/queue/list",
      "thread/queue/add",
      "thread/queue/update",
      "thread/queue/delete",
      "thread/queue/reorder",
      "thread/queue/start",
    ]);
    expect(requests).toContainEqual({
      method: "thread/queue/add",
      params: { threadId: "thread-1", input, clientUserMessageId: "client-1" },
    });
    expect(requests).toContainEqual({
      method: "thread/queue/update",
      params: { threadId: "thread-1", queuedSubmissionId: "queue-1", input },
    });
    expect(requests).toContainEqual({
      method: "thread/queue/reorder",
      params: { threadId: "thread-1", queuedSubmissionIds: ["queue-2", "queue-1"] },
    });
    expect(requests).toContainEqual({
      method: "thread/queue/start",
      params: { threadId: "thread-1", queuedSubmissionId: "queue-2" },
    });
  });

  it("steers the authoritative queued input before deleting that exact queue item", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const request = vi.fn(async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "thread/queue/list") {
        return { data: [submission("queue-1", "correct scope")], nextCursor: null };
      }
      if (method === "turn/steer") return { turnId: "turn-active" };
      if (method === "thread/queue/delete") return { deleted: true };
      throw new Error(`Unexpected method ${method}`);
    });
    const { service, markActiveMainThread } = serviceWithRequest(request);

    const result = await service.steer(host, "thread-1", "queue-1", "turn-active");

    expect(result).toEqual({ turnId: "turn-active", deleted: true });
    expect(requests.map(({ method }) => method)).toEqual([
      "thread/queue/list",
      "turn/steer",
      "thread/queue/delete",
    ]);
    expect(requests[1]).toEqual({
      method: "turn/steer",
      params: {
        threadId: "thread-1",
        expectedTurnId: "turn-active",
        clientUserMessageId: "client-queue-1",
        input: [{ type: "text", text: "correct scope", text_elements: [] }],
        additionalContext: {},
      },
    });
    expect(markActiveMainThread).toHaveBeenCalledOnce();
  });

  it("finds an authoritative queued item beyond the first list page before steering it", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const request = vi.fn(async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "thread/queue/list") {
        const cursor = recordFromUnknown(params)?.cursor ?? null;
        return cursor === null
          ? { data: [submission("queue-1", "first page")], nextCursor: "cursor-2" }
          : { data: [submission("queue-101", "later page")], nextCursor: null };
      }
      if (method === "turn/steer") return { turnId: "turn-active" };
      if (method === "thread/queue/delete") return { deleted: true };
      throw new Error(`Unexpected method ${method}`);
    });
    const { service } = serviceWithRequest(request);

    await expect(service.steer(host, "thread-1", "queue-101", "turn-active")).resolves.toEqual({
      turnId: "turn-active",
      deleted: true,
    });
    expect(requests.filter(({ method }) => method === "thread/queue/list")).toHaveLength(2);
    expect(requests.find(({ method }) => method === "turn/steer")).toEqual({
      method: "turn/steer",
      params: {
        threadId: "thread-1",
        expectedTurnId: "turn-active",
        clientUserMessageId: "client-queue-101",
        input: [{ type: "text", text: "later page", text_elements: [] }],
        additionalContext: {},
      },
    });
  });
});

function serviceWithRequest(request: (method: string, params: unknown) => Promise<unknown>) {
  const markActiveMainThread = vi.fn();
  const controller = {
    client: {
      request: async <T>(
        method: string,
        params: unknown,
        _timeoutMs: number,
        parse: (value: unknown) => T,
      ) => parse(await request(method, params)),
    },
    enqueue: <T>(operation: () => Promise<T>) => operation(),
    markActiveMainThread,
  };
  const registry: ThreadQueueControllerRegistry = {
    withScopedSubscription: (_host, _threadId, operation) => operation(controller),
  };
  return { service: new ThreadQueueService(registry), markActiveMainThread };
}

function submission(id: string, text: string) {
  return {
    id,
    input: [{ type: "text", text, text_elements: [] }],
    clientUserMessageId: `client-${id}`,
  };
}

function turn(id: string) {
  return {
    id,
    items: [],
    itemsView: "full",
    status: "inProgress",
    error: null,
    startedAt: 1,
    completedAt: null,
    durationMs: null,
  };
}
