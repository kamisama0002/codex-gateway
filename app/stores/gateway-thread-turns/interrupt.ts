import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { useGatewayThreadTurnsStore } from "@/stores/gateway-thread-turns";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { errorMessageLabels, messageFromError } from "@/stores/gateway/thread-utils/identity";
import { isNoActiveTurnToInterruptError } from "~~/shared/turn-interrupt";
import { requestTurnInterrupt } from "./transport";
import { removeOptimisticUserMessage } from "./history";
import type { Translate } from "./types";

export async function interruptActiveTurn(t: Translate) {
  const navigation = useGatewayNavigationStore();
  if (navigation.selectedHostId === null || navigation.selectedThreadId === null) {
    return;
  }
  await interruptThreadTurn(t, {
    hostId: navigation.selectedHostId,
    projectId: navigation.selectedProjectId,
    threadId: navigation.selectedThreadId,
  });
}

export async function interruptThreadTurn(
  t: Translate,
  input: { hostId: number; threadId: string; projectId?: number | null },
) {
  const gateway = useGatewayBootstrapStore();
  const runtime = useGatewayThreadRuntimeStore();
  const turns = useGatewayThreadTurnsStore();
  const views = useGatewayThreadViewStore();
  const projectId = input.projectId ?? null;
  const turnId = runtime.threadRuntimeProjection(input.hostId, input.threadId).activeTurnId;
  const cancelledRequest = turns.cancelRequest(input.hostId, input.threadId);
  if (cancelledRequest !== null && !cancelledRequest.admitted) {
    removeOptimisticUserMessage(input.hostId, input.threadId, cancelledRequest.clientUserMessageId);
  }
  if (turnId === null) {
    if (cancelledRequest !== null) {
      runtime.setThreadStatus(input.hostId, input.threadId, cancelledRequest.previousStatus);
    }
    return;
  }

  views.loading = true;
  gateway.clearError({ hostId: input.hostId, projectId, threadId: input.threadId });
  try {
    await requestTurnInterrupt(input.hostId, input.threadId, turnId);
  } catch (error: unknown) {
    if (isNoActiveTurnToInterruptError(error)) {
      runtime.setThreadStatus(input.hostId, input.threadId, "completed");
      return;
    }
    gateway.setError(messageFromError(error, t("app.interruptTurnFailed"), errorMessageLabels(t)), {
      hostId: input.hostId,
      projectId,
      threadId: input.threadId,
    });
  } finally {
    views.loading = false;
  }
}
