import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayThreadTurnsStore } from "@/stores/gateway-thread-turns";
import { useGatewayTurnRecoveryStore } from "@/stores/gateway-turn-recovery";
import { appServerTurnErrorFromNotification, misalignmentDetailsFromNotification } from "../errors";
import type { GatewayEventHandlerRegistry } from "./types";
import { idFromUnknown } from "~~/shared/utils/records";
import { gatewayDomainEvents } from "../domain-events";

export const errorEventHandlers: GatewayEventHandlerRegistry = {
  error: (event, params, threadId) => {
    const gateway = useGatewayBootstrapStore();
    const error = appServerTurnErrorFromNotification(params, gateway.t);
    const turnIdValue = idFromUnknown(params.turnId);
    const turnId = turnIdValue === null ? "" : String(turnIdValue);
    const misalignment = misalignmentDetailsFromNotification(params);
    if (misalignment?.steer !== null && misalignment !== null) {
      gatewayDomainEvents.emit("thread-status-detected", {
        hostId: event.hostId,
        threadId,
        status: "running",
        phase: "waitingForInput",
        turnId: turnId === "" ? null : turnId,
      });
      useGatewayTurnRecoveryStore().setRequest({
        hostId: event.hostId,
        threadId,
        turnId: turnId === "" ? null : turnId,
        ...misalignment,
      });
      return;
    }
    if (
      turnId !== "" &&
      useGatewayThreadTurnsStore().maybeQueueServerOverloadedRetry(
        event.hostId,
        threadId,
        turnId,
        error,
      )
    )
      return;
    // A non-retryable app-server error is the terminal result for this submission. Keep the
    // last request available for the explicit Retry action, but remove the pending admission
    // record so the composer does not stay in "cancel send" state forever.
    if (!error.willRetry) {
      useGatewayThreadTurnsStore().clearRequest(event.hostId, threadId);
    }
    gatewayDomainEvents.emit("thread-status-detected", {
      hostId: event.hostId,
      threadId,
      status: error.willRetry ? "running" : "failed",
      phase: error.willRetry ? "retrying" : "failed",
      turnId: turnId === "" ? null : turnId,
    });
    gateway.setError(error.toDisplayMessage(), {
      hostId: event.hostId,
      threadId,
      turnId: turnId === "" ? null : turnId,
      transient: error.willRetry,
      category: error.category,
      code: error.code,
      details: error.additionalDetails,
      retryable: error.willRetry,
      // Surface terminal failures immediately. The inline error row is populated only after a
      // valid failed Turn is persisted, so malformed or interrupted completions still need a
      // toast to explain why the run stopped.
      toast: !error.willRetry,
    });
  },
  "thread/realtime/error": (event, params, threadId) => {
    const gateway = useGatewayBootstrapStore();
    useGatewayThreadTurnsStore().clearRequest(event.hostId, threadId);
    gatewayDomainEvents.emit("thread-status-detected", {
      hostId: event.hostId,
      threadId,
      status: "failed",
      phase: "failed",
    });
    gateway.setError(
      typeof params.message === "string" ? params.message : gateway.t("app.appServerError"),
      { hostId: event.hostId, threadId, category: "unavailable", toast: true },
    );
  },
};
