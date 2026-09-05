import type { ComposerTurnOptions } from "~~/shared/types";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayComposerStore } from "@/stores/gateway-composer";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { useGatewayThreadTurnsStore } from "@/stores/gateway-thread-turns";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { errorMessageLabels, messageFromError } from "@/stores/gateway/thread-utils/identity";
import { requestScrollToLatest } from "@/stores/gateway/thread-open/view-state";
import {
  createClientUserMessageId,
  optimisticUserContent,
} from "@/stores/gateway/thread-turns/turn-content";
import {
  acceptStartedTurn,
  insertOptimisticNewTurnMessage,
  insertOptimisticSteerMessage,
  removeOptimisticUserMessage,
} from "./history";
import { runTurnRequestWithAutoRetry } from "./retry";
import { requestTurnStart, requestTurnSteer } from "./transport";
import type { Translate, TurnRequestResult } from "./types";
import { captureSessionEpoch } from "@/utils/session-epoch";

export async function sendTurn(
  t: Translate,
  text: string,
  options: ComposerTurnOptions = {},
  controller = new AbortController(),
) {
  const sessionIsCurrent = captureSessionEpoch();
  const catalog = useGatewayCatalogStore();
  const gateway = useGatewayBootstrapStore();
  const composer = useGatewayComposerStore();
  const navigation = useGatewayNavigationStore();
  const runtimeStore = useGatewayThreadRuntimeStore();
  const turns = useGatewayThreadTurnsStore();
  const views = useGatewayThreadViewStore();
  const hostId = navigation.selectedHostId;
  const threadId = navigation.selectedThreadId;
  if (hostId === null || threadId === null) {
    return false;
  }

  const runtime = runtimeStore.threadRuntimeProjection(hostId, threadId);
  const previousStatus = runtime.status;
  const steerTurnId = runtime.canSteer ? runtime.activeTurnId : null;
  const shouldSteerActiveTurn = steerTurnId !== null;
  const clientUserMessageId = createClientUserMessageId(shouldSteerActiveTurn ? "steer" : "turn");
  if (!shouldSteerActiveTurn) {
    runtimeStore.setThreadStatus(hostId, threadId, "running", { phase: "submitting" });
  }

  // Sending is an explicit request to show the new user message, even if a completed-turn collapse
  // or restored layout left the strict two-pixel end detector detached. Issue the command before
  // the optimistic append; the viewport consumes it after Vue commits that row and uses TanStack's
  // public scrollToEnd transaction instead of writing scrollTop directly.
  requestScrollToLatest();
  const optimisticContent = optimisticUserContent(text, options);
  if (steerTurnId !== null) {
    insertOptimisticSteerMessage(threadId, steerTurnId, clientUserMessageId, optimisticContent);
  } else {
    insertOptimisticNewTurnMessage(threadId, clientUserMessageId, optimisticContent);
  }

  const projectId = navigation.selectedProjectId;
  if (projectId === null) {
    gateway.setError(t("app.projectRequiredForFileReferences"), { hostId, threadId });
    if (!shouldSteerActiveTurn) {
      runtimeStore.setThreadStatus(hostId, threadId, previousStatus);
    }
    removeOptimisticUserMessage(hostId, threadId, clientUserMessageId);
    return false;
  }
  const cwd = catalog.projects.find((project) => project.id === projectId)?.remotePath ?? null;
  const requestKind = shouldSteerActiveTurn ? "steer" : "start";
  const executeTurnRequest =
    steerTurnId !== null
      ? () =>
          requestTurnSteer({
            hostId,
            threadId,
            projectId,
            expectedTurnId: steerTurnId,
            text,
            clientUserMessageId,
            options,
            signal: controller.signal,
          })
      : () =>
          requestTurnStart({
            hostId,
            threadId,
            projectId,
            text,
            clientUserMessageId,
            cwd,
            options,
            signal: controller.signal,
          });

  views.loading = true;
  gateway.clearError({ hostId, projectId, threadId });
  try {
    const result = await runTurnRequestWithAutoRetry<TurnRequestResult>(
      t,
      {
        kind: requestKind,
        hostId,
        projectId,
        threadId,
        cwd,
        text,
        clientUserMessageId,
        previousStatus,
        options,
      },
      executeTurnRequest,
      controller,
    );
    if (!sessionIsCurrent()) return false;
    turns.markRequestAdmitted(hostId, threadId);
    applyAcceptedTurnResult(hostId, threadId, result, clientUserMessageId, optimisticContent);
    if (!shouldSteerActiveTurn) {
      composer.updateSelectedThreadSettings({
        ...(options.model !== undefined ? { model: options.model } : {}),
        ...(options.effort !== undefined ? { effort: options.effort } : {}),
        ...(options.approvalPolicy !== undefined ? { approvalPolicy: options.approvalPolicy } : {}),
      });
    }
    return true;
  } catch (error: unknown) {
    if (!sessionIsCurrent()) return false;
    turns.clearRequest(hostId, threadId);
    removeOptimisticUserMessage(hostId, threadId, clientUserMessageId);
    if (controller.signal.aborted) {
      if (!shouldSteerActiveTurn) {
        runtimeStore.setThreadStatus(hostId, threadId, previousStatus);
      }
      return false;
    }
    gateway.setError(messageFromError(error, t("app.sendMessageFailed"), errorMessageLabels(t)), {
      hostId,
      projectId,
      threadId,
    });
    if (!shouldSteerActiveTurn) {
      runtimeStore.setThreadStatus(hostId, threadId, "failed", { phase: "failed" });
    }
    return false;
  } finally {
    if (sessionIsCurrent()) views.loading = false;
  }
}

export async function retryLastTurn(t: Translate) {
  const navigation = useGatewayNavigationStore();
  const hostId = navigation.selectedHostId;
  const threadId = navigation.selectedThreadId;
  if (hostId === null || threadId === null) return false;
  const previous = useGatewayThreadTurnsStore().lastRequestForThread(hostId, threadId);
  if (previous === undefined) return false;
  await sendTurn(t, previous.text, previous.options);
  return true;
}

function applyAcceptedTurnResult(
  hostId: number,
  threadId: string,
  result: TurnRequestResult | undefined,
  clientUserMessageId: string,
  optimisticContent: unknown[],
) {
  const runtime = useGatewayThreadRuntimeStore();
  if (result?.type === "turn.start.accepted" && result.turn !== null && result.turn !== undefined) {
    const startedTurnId =
      result.turn.id === null || result.turn.id === undefined ? "" : String(result.turn.id);
    if (startedTurnId !== "" && !startedTurnId.startsWith("client-")) {
      runtime.setThreadStatus(hostId, threadId, "running", {
        phase: "running",
        turnId: startedTurnId,
      });
    }
    acceptStartedTurn(threadId, result.turn, clientUserMessageId, optimisticContent);
  }
  if (
    result?.type === "turn.steer.accepted" &&
    result.turnId !== undefined &&
    result.turnId !== ""
  ) {
    insertOptimisticSteerMessage(threadId, result.turnId, clientUserMessageId, optimisticContent);
  }
}
