import type { RealtimeClientMessage } from "~~/shared/types";
import { respondToServerRequestFromRealtime } from "../server-request-response";
import { interruptTurnFromRealtime } from "../turn-interrupt";
import { startTurnFromRealtime } from "../turn-start";
import { steerTurnFromRealtime } from "../turn-steer";
import { sendRealtimePeerMessage, type RealtimePeer } from "../peer-state";
import { threadBroker } from "../../runtime/broker";
import { requireWorkspaceHost } from "../../runtime-manager/local-workspace";
import { idFromUnknown, recordFromUnknown } from "~~/shared/utils/records";
import { runtimeLog } from "../../runtime/runtime-log";

export async function startTurn(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "turn.start" }>,
  signal: AbortSignal,
) {
  if (signal.aborted) return;
  const result = await startTurnFromRealtime(request);
  if (signal.aborted) {
    const turnId = idFromUnknown(recordFromUnknown(result?.turn)?.id);
    if (turnId !== null) await interruptCancelledTurn(request, String(turnId));
    return;
  }
  sendRealtimePeerMessage(peer, {
    type: "turn.start.accepted",
    requestId: request.requestId,
    hostId: request.hostId,
    threadId: request.threadId,
    turn: result?.turn,
  });
}

export async function steerTurn(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "turn.steer" }>,
  signal: AbortSignal,
) {
  if (signal.aborted) return;
  const result = await steerTurnFromRealtime(request);
  if (signal.aborted) {
    await interruptCancelledTurn(
      request,
      String(idFromUnknown(result?.turnId) ?? request.expectedTurnId),
    );
    return;
  }
  sendRealtimePeerMessage(peer, {
    type: "turn.steer.accepted",
    requestId: request.requestId,
    hostId: request.hostId,
    threadId: request.threadId,
    turnId: result?.turnId,
  });
}

async function interruptCancelledTurn(
  request: { hostId: number; threadId: string },
  turnId: string,
) {
  try {
    const host = await requireWorkspaceHost(request.hostId);
    await threadBroker.interruptTurn(host, request.threadId, turnId);
  } catch (error) {
    runtimeLog("cancelled turn cleanup failed", {
      hostId: request.hostId,
      threadId: request.threadId,
      turnId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function interruptTurn(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "turn.interrupt" }>,
) {
  await interruptTurnFromRealtime(request);
  sendRealtimePeerMessage(peer, {
    type: "turn.interrupt.accepted",
    requestId: request.requestId,
    hostId: request.hostId,
    threadId: request.threadId,
  });
}

export async function updateTurnSettings(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "turn.settings.update" }>,
) {
  const host = await requireWorkspaceHost(request.hostId);
  const result = await threadBroker.updateTurnSettings(host, request.threadId, request.turnId, {
    model: request.model,
    effort: request.effort,
  });
  sendRealtimePeerMessage(peer, {
    type: "turn.settings.updated",
    requestId: request.requestId,
    hostId: request.hostId,
    threadId: request.threadId,
    turnId: request.turnId,
    status: result.status,
  });
}

export async function respondToServerRequest(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "serverRequest.respond" }>,
) {
  await respondToServerRequestFromRealtime(request);
  sendRealtimePeerMessage(peer, {
    type: "serverRequest.respond.accepted",
    requestId: request.requestId,
    hostId: request.hostId,
    threadId: request.threadId,
    serverRequestId: request.serverRequestId,
  });
}

export function ping(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "ping" }>,
) {
  sendRealtimePeerMessage(peer, { type: "pong", nonce: request.nonce });
}
