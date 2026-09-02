import {
  currentActiveTurnIdFromInterruptError,
  isNoActiveTurnToInterruptError,
} from "~~/shared/turn-interrupt";

export async function interruptTurnAndReconcile(input: {
  turnId: string;
  request: (turnId: string) => Promise<unknown>;
  onStaleTurn?: (currentTurnId: string) => void;
  onIdle: () => Promise<void>;
}): Promise<unknown> {
  try {
    return await input.request(input.turnId);
  } catch (error) {
    const currentTurnId = currentActiveTurnIdFromInterruptError(error);
    if (currentTurnId !== null && currentTurnId !== input.turnId) {
      input.onStaleTurn?.(currentTurnId);
      try {
        return await input.request(currentTurnId);
      } catch (retryError) {
        if (!isNoActiveTurnToInterruptError(retryError)) {
          throw retryError;
        }
      }
    } else if (!isNoActiveTurnToInterruptError(error)) {
      throw error;
    }
    await input.onIdle();
    return {};
  }
}
