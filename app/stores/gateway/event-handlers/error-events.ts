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
      toast: false,
    });
  },
  "thread/realtime/error": (event, params, threadId) => {
    const gateway = useGatewayBootstrapStore();
    gateway.setError(
      typeof params.message === "string" ? params.message : gateway.t("app.appServerError"),
      { hostId: event.hostId, threadId, category: "unavailable", toast: false },
    );
  },
};
