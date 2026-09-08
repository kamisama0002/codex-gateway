import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  listResults: [] as Array<Promise<unknown>>,
  addResult: null as unknown,
  updateResult: null as unknown,
  deleteResult: null as unknown,
  reorderResult: null as unknown,
  steerResult: null as unknown,
}));

vi.mock("./transport", () => ({
  requestThreadQueueList: () => harness.listResults.shift(),
  requestThreadQueueAdd: () => harness.addResult,
  requestThreadQueueUpdate: () => harness.updateResult,
  requestThreadQueueDelete: () => harness.deleteResult,
  requestThreadQueueReorder: () => harness.reorderResult,
  requestThreadQueueStart: vi.fn(),
  requestThreadQueueSteer: () => harness.steerResult,
}));
vi.mock("@/utils/session-epoch", () => ({ captureSessionEpoch: () => () => true }));

import { useGatewayThreadQueueStore } from "./index";

describe("Gateway thread queue projection", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    harness.listResults.length = 0;
    harness.addResult = null;
    harness.updateResult = null;
    harness.deleteResult = null;
    harness.reorderResult = null;
    harness.steerResult = null;
  });

  it("keeps the newest authoritative list when an older request finishes later", async () => {
    const older = deferred<unknown>();
    const newer = deferred<unknown>();
    harness.listResults.push(older.promise, newer.promise);
    const queue = useGatewayThreadQueueStore();

    const first = queue.loadQueue(1, "thread-1");
    const second = queue.loadQueue(1, "thread-1", { force: true });
    newer.resolve({ items: [submission("queue-new", "new")] });
    await second;
    older.resolve({ items: [submission("queue-old", "old")] });
    await first;

    expect(queue.queueForThread(1, "thread-1").map((item) => item.id)).toEqual(["queue-new"]);
  });

  it("projects successful add, update, delete and reorder responses", async () => {
    const queue = useGatewayThreadQueueStore();
    harness.addResult = { item: submission("queue-1", "first") };
    harness.updateResult = { item: submission("queue-1", "edited") };
    harness.deleteResult = { queuedSubmissionId: "queue-1", deleted: true };
    harness.reorderResult = { queuedSubmissionIds: ["queue-2", "queue-1"] };

    await queue.queueMessage(1, "thread-1", submission("queue-1", "first"));
    await queue.editQueuedMessage(1, "thread-1", "queue-1", "edited");
    expect(queue.queueForThread(1, "thread-1")[0]?.input[0]).toMatchObject({ text: "edited" });

    queue.replaceQueue(1, "thread-1", [
      submission("queue-1", "edited"),
      submission("queue-2", "second"),
    ]);
    await queue.reorderQueuedMessages(1, "thread-1", ["queue-2", "queue-1"]);
    expect(queue.queueForThread(1, "thread-1").map((item) => item.id)).toEqual([
      "queue-2",
      "queue-1",
    ]);

    await queue.deleteQueuedMessage(1, "thread-1", "queue-1");
    expect(queue.queueForThread(1, "thread-1").map((item) => item.id)).toEqual(["queue-2"]);
  });

  it("does not let an older empty load erase a newly admitted queue item", async () => {
    const stale = deferred<unknown>();
    harness.listResults.push(stale.promise);
    harness.addResult = { item: submission("queue-new", "new") };
    const queue = useGatewayThreadQueueStore();

    const loading = queue.loadQueue(1, "thread-1");
    await queue.queueMessage(1, "thread-1", submission("queue-new", "new"));
    stale.resolve({ items: [] });
    await loading;

    expect(queue.queueForThread(1, "thread-1").map((item) => item.id)).toEqual(["queue-new"]);
  });

  it("does not reinsert a consumed item when its add response finishes after an empty snapshot", async () => {
    const added = deferred<unknown>();
    harness.addResult = added.promise;
    harness.listResults.push(Promise.resolve({ items: [] }), Promise.resolve({ items: [] }));
    const queue = useGatewayThreadQueueStore();

    const adding = queue.queueMessage(1, "thread-1", submission("queue-consumed", "consumed"));
    await queue.loadQueue(1, "thread-1", { force: true });
    added.resolve({ item: submission("queue-consumed", "consumed") });
    await adding;

    expect(queue.queueForThread(1, "thread-1")).toEqual([]);
  });

  it("reconciles a successful add with the authoritative queue", async () => {
    harness.addResult = { item: submission("queue-consumed", "consumed") };
    harness.listResults.push(Promise.resolve({ items: [] }));
    const queue = useGatewayThreadQueueStore();

    await queue.queueMessage(1, "thread-1", submission("queue-consumed", "consumed"));

    await vi.waitFor(() => {
      expect(queue.queueForThread(1, "thread-1")).toEqual([]);
    });
  });

  it("does not reinsert a consumed item when its update response finishes after an empty snapshot", async () => {
    const updated = deferred<unknown>();
    harness.updateResult = updated.promise;
    harness.listResults.push(Promise.resolve({ items: [] }), Promise.resolve({ items: [] }));
    const queue = useGatewayThreadQueueStore();
    queue.replaceQueue(1, "thread-1", [submission("queue-consumed", "before")]);

    const updating = queue.editQueuedMessage(1, "thread-1", "queue-consumed", "after");
    await queue.loadQueue(1, "thread-1", { force: true });
    updated.resolve({ item: submission("queue-consumed", "after") });
    await updating;

    expect(queue.queueForThread(1, "thread-1")).toEqual([]);
  });

  it("removes an exact queue item after the server atomically steers it", async () => {
    const queue = useGatewayThreadQueueStore();
    queue.replaceQueue(1, "thread-1", [submission("queue-1", "correct scope")]);
    harness.steerResult = {
      queuedSubmissionId: "queue-1",
      turnId: "turn-active",
      deleted: true,
    };

    await queue.steerQueuedMessage(1, "thread-1", "queue-1", "turn-active");

    expect(queue.queueForThread(1, "thread-1")).toEqual([]);
  });
});

function submission(id: string, text: string) {
  return {
    id,
    input: [{ type: "text", text, text_elements: [] }],
    clientUserMessageId: `client-${id}`,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
