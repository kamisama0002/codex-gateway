import type { RealtimeClientMessage } from "~~/shared/types";
import { serverRequestResponseSchema } from "../http/validation/threads";
import { threadBroker } from "../runtime/broker";
import { requireWorkspaceHost } from "../runtime-manager/local-workspace";
import { pendingServerRequests } from "../runtime/pending-server-requests";

export type RealtimeServerRequestResponseMessage = Extract<
  RealtimeClientMessage,
  { type: "serverRequest.respond" }
>;

export async function respondToServerRequestFromRealtime(
  message: RealtimeServerRequestResponseMessage,
) {
  const input = serverRequestResponseSchema.parse({
    ...message,
    requestId: message.serverRequestId,
  });
  const host = await requireWorkspaceHost(input.hostId);
  await threadBroker.respondToServerRequest(host, input.threadId, {
    requestId: input.requestId,
    result: input.result,
    error: input.error,
  });
  pendingServerRequests.resolve(input.hostId, input.threadId, input.requestId);
}
