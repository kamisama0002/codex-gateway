import type { RealtimeClientMessage } from "~~/shared/types";
import { requireWorkspaceHost } from "../../runtime-manager/local-workspace";
import { tmuxMonitorService } from "../../tmux-monitor/monitor-service";
import {
  authenticatedUserId,
  sendRealtimePeerMessage,
  stateFor,
  type RealtimePeer,
} from "../peer-state";
import { removeSubscription, replaceSubscription } from "../subscription-map";

export async function subscribeTmuxSessions(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "tmux.sessions.subscribe" }>,
) {
  const userId = authenticatedUserId(peer);
  const host = await requireWorkspaceHost(request.hostId);
  const subscriptions = stateFor(peer).tmuxSessionUnsubscribers;
  const unsubscribe = replaceSubscription(subscriptions, host.id, () =>
    tmuxMonitorService.sessionStream.subscribe(userId, host, (snapshot) => {
      sendRealtimePeerMessage(peer, { type: "tmux.sessions.updated", ...snapshot });
    }),
  );
  const snapshot = await tmuxMonitorService.sessionStream.refresh(userId, host);
  if (subscriptions.get(host.id) !== unsubscribe) return;
  sendRealtimePeerMessage(peer, {
    type: "tmux.sessions.snapshot",
    requestId: request.requestId,
    ...snapshot,
  });
}

export async function refreshTmuxSessions(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "tmux.sessions.refresh" }>,
) {
  const host = await requireWorkspaceHost(request.hostId);
  const snapshot = await tmuxMonitorService.sessionStream.refresh(
    authenticatedUserId(peer),
    host,
    true,
  );
  sendRealtimePeerMessage(peer, {
    type: "tmux.sessions.snapshot",
    requestId: request.requestId,
    ...snapshot,
  });
}

export function unsubscribeTmuxSessions(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "tmux.sessions.unsubscribe" }>,
) {
  const subscriptions = stateFor(peer).tmuxSessionUnsubscribers;
  removeSubscription(subscriptions, request.hostId);
}
