import type { QueuedSubmission } from "~~/shared/types";
import { useGatewayRealtimeStore } from "@/stores/gateway-realtime";
import {
  expectThreadQueueAdded,
  expectThreadQueueDeleted,
  expectThreadQueueReordered,
  expectThreadQueueSnapshot,
  expectThreadQueueStarted,
  expectThreadQueueSteered,
  expectThreadQueueUpdated,
} from "@/stores/gateway-realtime/response-parsers";

interface ThreadQueueScope {
  hostId: number;
  threadId: string;
}

export function requestThreadQueueList(input: ThreadQueueScope) {
  return useGatewayRealtimeStore().request(
    (requestId) => ({ type: "thread.queue.list", requestId, ...input }),
    expectThreadQueueSnapshot,
    { errorMode: "return" },
  );
}

export function requestThreadQueueAdd(
  input: ThreadQueueScope &
    Pick<QueuedSubmission, "input" | "clientUserMessageId"> & { signal?: AbortSignal },
) {
  const { signal, ...request } = input;
  return useGatewayRealtimeStore().request(
    (requestId) => ({ type: "thread.queue.add", requestId, ...request }),
    expectThreadQueueAdded,
    { signal },
  );
}

export function requestThreadQueueUpdate(
  input: ThreadQueueScope & {
    queuedSubmissionId: string;
    input: QueuedSubmission["input"];
  },
) {
  return useGatewayRealtimeStore().request(
    (requestId) => ({ type: "thread.queue.update", requestId, ...input }),
    expectThreadQueueUpdated,
  );
}

export function requestThreadQueueDelete(input: ThreadQueueScope & { queuedSubmissionId: string }) {
  return useGatewayRealtimeStore().request(
    (requestId) => ({ type: "thread.queue.delete", requestId, ...input }),
    expectThreadQueueDeleted,
  );
}

export function requestThreadQueueReorder(
  input: ThreadQueueScope & { queuedSubmissionIds: string[] },
) {
  return useGatewayRealtimeStore().request(
    (requestId) => ({ type: "thread.queue.reorder", requestId, ...input }),
    expectThreadQueueReordered,
  );
}

export function requestThreadQueueStart(
  input: ThreadQueueScope & { queuedSubmissionId?: string | null },
) {
  return useGatewayRealtimeStore().request(
    (requestId) => ({
      type: "thread.queue.start",
      requestId,
      ...input,
      queuedSubmissionId: input.queuedSubmissionId ?? null,
    }),
    expectThreadQueueStarted,
  );
}

export function requestThreadQueueSteer(
  input: ThreadQueueScope & { queuedSubmissionId: string; expectedTurnId: string },
) {
  return useGatewayRealtimeStore().request(
    (requestId) => ({ type: "thread.queue.steer", requestId, ...input }),
    expectThreadQueueSteered,
  );
}
