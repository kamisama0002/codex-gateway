import type { RealtimeClientMessage } from "~~/shared/types";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import { hostMetricsManager } from "../../infra/host-services";
import {
  authenticatedUserId,
  sendRealtimePeerMessage,
  stateFor,
  type RealtimePeer,
} from "../peer-state";
import { removeSubscription, replaceSubscription } from "../subscription-map";

export function subscribeHostMetrics(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "host.metrics.subscribe" }>,
) {
  if (request.hostId !== MANAGED_RUNTIME_HOST_ID) {
    throw new Error("Host metrics are only available for the Agent runtime");
  }
  const userId = authenticatedUserId(peer);
  hostMetricsManager.ensureCollector(userId);
  const subscriptions = stateFor(peer).hostMetricsUnsubscribers;
  replaceSubscription(subscriptions, request.hostId, () =>
    hostMetricsManager.events.subscribe(userId, request.hostId, (event) => {
      if (event.type === "sample") {
        sendRealtimePeerMessage(peer, {
          type: "host.metrics.sample",
          hostId: event.hostId,
          sample: event.sample,
          gpuProcesses: event.gpuProcesses,
        });
      } else {
        sendRealtimePeerMessage(peer, {
          type: "host.metrics.status",
          hostId: event.snapshot.hostId,
          status: event.snapshot.status,
          message: event.snapshot.message,
        });
      }
    }),
  );
  sendRealtimePeerMessage(peer, {
    type: "host.metrics.snapshot",
    requestId: request.requestId,
    ...hostMetricsManager.snapshot(userId, request.hostId),
  });
}

export function unsubscribeHostMetrics(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "host.metrics.unsubscribe" }>,
) {
  const subscriptions = stateFor(peer).hostMetricsUnsubscribers;
  removeSubscription(subscriptions, request.hostId);
}
