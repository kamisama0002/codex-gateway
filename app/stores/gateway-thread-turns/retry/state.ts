import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayThreadTurnsStore } from "@/stores/gateway-thread-turns";
import type { SubmittedTurnRequestState } from "@/stores/gateway-thread-turns";

export function pendingTurnRequest(hostId: number, threadId: string) {
  return useGatewayThreadTurnsStore().requestForThread(hostId, threadId);
}

export function markPendingRetryTurn(hostId: number, threadId: string, turnId: string) {
  useGatewayThreadTurnsStore().patchRequest(hostId, threadId, { pendingRetryTurnId: turnId });
}

export function updateRetryAttempt(
  request: Pick<SubmittedTurnRequestState, "hostId" | "threadId">,
  attempt: number,
  retryAt: number | null = null,
) {
  useGatewayThreadTurnsStore().patchRequest(request.hostId, request.threadId, {
    retryCount: attempt,
    pendingRetryTurnId: null,
    retryAt,
  });
}

export function storeRetryTimer(
  request: SubmittedTurnRequestState,
  retryTimer: number,
  retryAt: number,
) {
  useGatewayThreadTurnsStore().patchRequest(request.hostId, request.threadId, {
    retryTimer,
    retryCount: request.retryCount + 1,
    retryAt,
  });
}

export function clearPendingTurnRequest(hostId: number, threadId: string) {
  useGatewayThreadTurnsStore().clearRequest(hostId, threadId);
}

export function clearThreadScopedError(hostId: number, threadId: string) {
  const gateway = useGatewayBootstrapStore();
  const current = [...gateway.errors]
    .reverse()
    .find((entry) => entry.hostId === hostId && entry.threadId === threadId);
  if (!current) {
    return;
  }
  gateway.clearError({
    hostId: current.hostId,
    projectId: current.projectId,
    threadId: current.threadId,
  });
}

export function isTerminalTurnStatus(status: unknown) {
  return status === "completed" || status === "failed" || status === "interrupted";
}
