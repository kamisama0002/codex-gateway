import type { RealtimeClientMessage } from "~~/shared/types";
import { threadBroker } from "../../runtime/broker";
import { requireWorkspaceHost } from "../../runtime-manager/local-workspace";
import { sendRealtimePeerMessage, type RealtimePeer } from "../peer-state";

export async function listMcpStatuses(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "mcp.status.list" }>,
) {
  const host = await requireWorkspaceHost(request.hostId);
  const servers = await threadBroker.listMcpStatuses(host, request.threadId);
  sendRealtimePeerMessage(peer, {
    type: "mcp.status.snapshot",
    requestId: request.requestId,
    hostId: request.hostId,
    threadId: request.threadId,
    servers,
  });
}

export async function startMcpEventStream(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "mcp.event.stream.start" }>,
) {
  const host = await requireWorkspaceHost(request.hostId);
  await threadBroker.startMcpEventStream(host, request);
  sendRealtimePeerMessage(peer, {
    type: "mcp.event.stream.accepted",
    requestId: request.requestId,
    hostId: request.hostId,
    threadId: request.threadId,
    subscriptionId: request.subscriptionId,
    action: "started",
  });
}

export async function stopMcpEventStream(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "mcp.event.stream.stop" }>,
) {
  const host = await requireWorkspaceHost(request.hostId);
  await threadBroker.stopMcpEventStream(host, request.subscriptionId);
  sendRealtimePeerMessage(peer, {
    type: "mcp.event.stream.accepted",
    requestId: request.requestId,
    hostId: request.hostId,
    threadId: request.threadId,
    subscriptionId: request.subscriptionId,
    action: "stopped",
  });
}
