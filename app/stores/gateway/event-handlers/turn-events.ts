import { useGatewayThreadTurnsStore } from "@/stores/gateway-thread-turns";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { threadHistoryTurnFromUnknown } from "~~/shared/runtime/app-server";
import { idFromUnknown, stringFromUnknown } from "~~/shared/utils/records";
import { gatewayDomainEvents } from "../domain-events";
import { runtimeStatusFromCompletedTurn } from "../thread-utils/status";
import { runtimePhaseFromStatus } from "~~/shared/thread-runtime-status";
import { appServerTurnErrorFromNotification } from "../errors";
import type { GatewayEventHandlerRegistry } from "./types";
import { useGatewayTurnRecoveryStore } from "@/stores/gateway-turn-recovery";

export const turnEventHandlers: GatewayEventHandlerRegistry = {
  "turn/started": (event, params, threadId) => {
    useGatewayTurnRecoveryStore().clearRequest(event.hostId, threadId);
    const turn = threadHistoryTurnFromUnknown(params.turn);
    gatewayDomainEvents.emit("thread-status-detected", {
      hostId: event.hostId,
      threadId,
      status: "running",
      phase: "running",
      turnId: turn === null ? null : String(turn.id),
    });
    if (turn !== null) {
      gatewayDomainEvents.emit("history-turn-appended", {
        hostId: event.hostId,
        threadId,
        turn,
      });
    }
  },
  "turn/completed": (event, params, threadId) => {
    const turn = threadHistoryTurnFromUnknown(params.turn);
    // A malformed completion is still terminal for the browser submission, but it is not
    // evidence of a successful turn. Mark it failed so a prior app-server error cannot be
    // overwritten by a synthetic "completed" status and the composer becomes usable again.
    const status = turn === null ? "failed" : runtimeStatusFromCompletedTurn(turn);
    gatewayDomainEvents.emit("thread-status-detected", {
      hostId: event.hostId,
      threadId,
      status,
      phase: runtimePhaseFromStatus(status),
      turnId: turn === null ? null : String(turn.id),
    });
    if (turn === null) {
      // A completion without a valid Turn can still be emitted after a provider failure. It is
      // terminal for the browser submission even though there is no history object to hydrate.
      useGatewayThreadTurnsStore().clearRequest(event.hostId, threadId);
      showFallbackTurnError(event.hostId, threadId, null);
      return;
    }
    gatewayDomainEvents.emit("history-turn-synced", {
      hostId: event.hostId,
      threadId,
      turn,
    });
    const turns = useGatewayThreadTurnsStore();
    turns.maybeRetryAfterTurnFailure(event.hostId, threadId, turn);
    if (turn.status === "failed") {
      showFallbackTurnError(event.hostId, threadId, String(turn.id), turn.error);
    }
    if (turn.status !== "failed") turns.clearRequest(event.hostId, threadId);
  },
  "turn/diff/updated": (event, params, threadId) => {
    gatewayDomainEvents.emit("history-turn-diff-updated", {
      hostId: event.hostId,
      threadId,
      params,
    });
  },
  "turn/plan/updated": (event, params, threadId) => {
    const turnId = idFromUnknown(params.turnId);
    if (turnId === null) return;
    gatewayDomainEvents.emit("history-item-upsert", {
      hostId: event.hostId,
      threadId,
      item: {
        type: "turnPlan",
        id: `${turnId}-plan`,
        turnId,
        explanation: stringFromUnknown(params.explanation),
        plan: Array.isArray(params.plan) ? params.plan : [],
      },
    });
  },
};

function showFallbackTurnError(
  hostId: number,
  threadId: string,
  turnId: string | null,
  turnError?: {
    message?: string | null;
    codexErrorInfo?: unknown;
    additionalDetails?: string | null;
  } | null,
) {
  const gateway = useGatewayBootstrapStore();
  const existing = gateway.errorForScope({ hostId, projectId: null, threadId });
  if (existing?.turnId === turnId && existing.transient === false) return;
  const error = appServerTurnErrorFromNotification(
    { turnId, willRetry: false, error: turnError ?? { message: gateway.t("app.appServerError") } },
    gateway.t,
  );
  gateway.setError(error.toDisplayMessage(), {
    hostId,
    threadId,
    turnId,
    category: error.category,
    code: error.code,
    details: error.additionalDetails,
    retryable: false,
    toast: true,
  });
}
