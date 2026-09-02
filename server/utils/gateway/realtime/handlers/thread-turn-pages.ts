import type { RealtimeClientMessage } from "~~/shared/types";
import { threadItemsListSchema, threadTurnsListSchema } from "../../http/validation/threads";
import { threadBroker } from "../../runtime/broker";
import { requireWorkspaceHost } from "../../runtime-manager/local-workspace";
import { sendRealtimePeerMessage, type RealtimePeer } from "../peer-state";

export async function loadThreadTurns(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "thread.turns.load" }>,
) {
  const input = threadTurnsListSchema.parse(request);
  const host = await requireWorkspaceHost(input.hostId);
  const result = await threadBroker.listThreadTurns(host, input.threadId, {
    cursor: input.cursor ?? null,
    limit: input.limit,
    sortDirection: input.sortDirection,
  });
  sendRealtimePeerMessage(peer, {
    type: "thread.turns.page",
    requestId: request.requestId,
    hostId: input.hostId,
    threadId: input.threadId,
    ...result,
  });
}

export async function loadThreadItems(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "thread.items.load" }>,
) {
  const input = threadItemsListSchema.parse(request);
  const host = await requireWorkspaceHost(input.hostId);
  const result = await threadBroker.listThreadItems(host, input.threadId, input);
  sendRealtimePeerMessage(peer, {
    type: "thread.items.page",
    requestId: request.requestId,
    hostId: input.hostId,
    threadId: input.threadId,
    ...result,
  });
}
