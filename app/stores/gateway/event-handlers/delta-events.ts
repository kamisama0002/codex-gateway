import { gatewayDomainEvents } from "../domain-events";
import type { GatewayEventHandlerRegistry } from "./types";
import { stringIdFromUnknown } from "~~/shared/utils/records";

export const deltaEventHandlers: GatewayEventHandlerRegistry = {
  "item/agentMessage/delta": (event, params, threadId) => {
    emitRunning(event.hostId, threadId, params);
    gatewayDomainEvents.emit("history-agent-delta", { hostId: event.hostId, threadId, params });
  },
  "item/plan/delta": (event, params, threadId) => {
    emitRunning(event.hostId, threadId, params);
    gatewayDomainEvents.emit("history-plan-delta", { hostId: event.hostId, threadId, params });
  },
  "item/reasoning/summaryTextDelta": (event, params, threadId) => {
    emitRunning(event.hostId, threadId, params);
    gatewayDomainEvents.emit("history-reasoning-summary-delta", {
      hostId: event.hostId,
      threadId,
      params,
    });
  },
  "item/reasoning/textDelta": (event, params, threadId) => {
    emitRunning(event.hostId, threadId, params);
    gatewayDomainEvents.emit("history-reasoning-text-delta", {
      hostId: event.hostId,
      threadId,
      params,
    });
  },
  "item/commandExecution/outputDelta": (event, params, threadId) => {
    emitRunning(event.hostId, threadId, params);
    gatewayDomainEvents.emit("history-command-output-delta", {
      hostId: event.hostId,
      threadId,
      params,
    });
  },
};

function emitRunning(hostId: number, threadId: string, params: Record<string, unknown>) {
  gatewayDomainEvents.emit("thread-status-detected", {
    hostId,
    threadId,
    status: "running",
    phase: "running",
    turnId: stringIdFromUnknown(params.turnId),
  });
}
