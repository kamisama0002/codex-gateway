import type { ComposerTurnOptions } from "~~/shared/types";
import type { ThreadHistoryTurn } from "~~/shared/thread-history/types";
import type { AppServerTurnDisplayError } from "@/stores/gateway/errors";
import { useGatewayTranslator } from "@/composables/i18n/useGatewayTranslator";
import { interruptActiveTurn, interruptThreadTurn } from "./interrupt";
import { loadOlderTurns } from "./older-turns";
import { loadTurnItems } from "./turn-items";
import { maybeQueueServerOverloadedRetry, maybeRetryAfterTurnFailure } from "./retry";
import { retryLastTurn, sendTurn } from "./submission";
import { respondToServerRequest } from "./transport";

export function createGatewayThreadTurnActions() {
  const t = useGatewayTranslator();
  return {
    sendTurn: (text: string, options?: ComposerTurnOptions) => sendTurn(t, text, options),
    retryLastTurn: () => retryLastTurn(t),
    loadOlderTurns: (options?: { limit?: number }) => loadOlderTurns(t, options),
    loadTurnItems: (turnId: string) => loadTurnItems(t, turnId),
    interruptActiveTurn: () => interruptActiveTurn(t),
    interruptThreadTurn: (input: { hostId: number; threadId: string; projectId?: number | null }) =>
      interruptThreadTurn(t, input),
    respondToServerRequest,
    maybeQueueServerOverloadedRetry: (
      hostId: number,
      threadId: string,
      turnId: string,
      error: AppServerTurnDisplayError,
    ) => maybeQueueServerOverloadedRetry(t, hostId, threadId, turnId, error),
    maybeRetryAfterTurnFailure: (hostId: number, threadId: string, turn: ThreadHistoryTurn) =>
      maybeRetryAfterTurnFailure(t, hostId, threadId, turn),
  };
}
