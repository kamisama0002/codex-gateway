import type { RealtimeClientMessage } from "~~/shared/types";
import { threadBroker } from "../../runtime/broker";
import { requireWorkspaceHost } from "../../runtime-manager/local-workspace";
import { sendRealtimePeerMessage, type RealtimePeer } from "../peer-state";

export async function listThreadQueue(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "thread.queue.list" }>,
) {
  const host = await requireWorkspaceHost(request.hostId);
  const items = await threadBroker.listThreadQueue(host, request.threadId);
  sendRealtimePeerMessage(peer, { ...scope(request), type: "thread.queue.snapshot", items });
}

export async function addThreadQueue(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "thread.queue.add" }>,
) {
  const host = await requireWorkspaceHost(request.hostId);
  const result = await threadBroker.addThreadQueue(
    host,
    request.threadId,
    request.input,
    request.clientUserMessageId,
  );
  sendRealtimePeerMessage(peer, {
    ...scope(request),
    type: "thread.queue.added",
    item: result.queuedSubmission,
  });
}

export async function updateThreadQueue(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "thread.queue.update" }>,
) {
  const host = await requireWorkspaceHost(request.hostId);
  const result = await threadBroker.updateThreadQueue(
    host,
    request.threadId,
    request.queuedSubmissionId,
    request.input,
  );
  sendRealtimePeerMessage(peer, {
    ...scope(request),
    type: "thread.queue.updated",
    item: result.queuedSubmission,
  });
}

export async function deleteThreadQueue(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "thread.queue.delete" }>,
) {
  const host = await requireWorkspaceHost(request.hostId);
  const result = await threadBroker.deleteThreadQueue(
    host,
    request.threadId,
    request.queuedSubmissionId,
  );
  sendRealtimePeerMessage(peer, {
    ...scope(request),
    type: "thread.queue.deleted",
    queuedSubmissionId: request.queuedSubmissionId,
    deleted: result.deleted,
  });
}

export async function reorderThreadQueue(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "thread.queue.reorder" }>,
) {
  const host = await requireWorkspaceHost(request.hostId);
  await threadBroker.reorderThreadQueue(host, request.threadId, request.queuedSubmissionIds);
  sendRealtimePeerMessage(peer, {
    ...scope(request),
    type: "thread.queue.reordered",
    queuedSubmissionIds: request.queuedSubmissionIds,
  });
}

export async function startThreadQueue(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "thread.queue.start" }>,
) {
  const host = await requireWorkspaceHost(request.hostId);
  const result = await threadBroker.startThreadQueue(
    host,
    request.threadId,
    request.queuedSubmissionId,
  );
  sendRealtimePeerMessage(peer, {
    ...scope(request),
    type: "thread.queue.started",
    queuedSubmissionId: request.queuedSubmissionId,
    turn: result.turn,
  });
}

export async function steerThreadQueue(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "thread.queue.steer" }>,
) {
  const host = await requireWorkspaceHost(request.hostId);
  const result = await threadBroker.steerThreadQueue(
    host,
    request.threadId,
    request.queuedSubmissionId,
    request.expectedTurnId,
  );
  sendRealtimePeerMessage(peer, {
    ...scope(request),
    type: "thread.queue.steered",
    queuedSubmissionId: request.queuedSubmissionId,
    turnId: result.turnId,
    deleted: result.deleted,
  });
}

function scope(request: { requestId: string; hostId: number; threadId: string }) {
  return {
    requestId: request.requestId,
    hostId: request.hostId,
    threadId: request.threadId,
  };
}
