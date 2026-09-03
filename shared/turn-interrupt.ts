import { recordFromUnknown, stringFromUnknown } from "./utils/records";

const NO_ACTIVE_TURN_TO_INTERRUPT = "no active turn to interrupt";
const STALE_INTERRUPT_TURN_ID = /expected active turn id (\S+) but found (\S+)/i;

export function interruptErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  return stringFromUnknown(recordFromUnknown(error)?.message);
}

export function isNoActiveTurnToInterruptError(error: unknown): boolean {
  const message = interruptErrorMessage(error);
  return message !== null && message.toLowerCase().includes(NO_ACTIVE_TURN_TO_INTERRUPT);
}

export function currentActiveTurnIdFromInterruptError(error: unknown): string | null {
  const message = interruptErrorMessage(error);
  if (message === null) {
    return null;
  }
  const found = message.match(STALE_INTERRUPT_TURN_ID)?.[2];
  if (found === undefined || found === "") {
    return null;
  }
  return found.replace(/[.,;:]+$/, "");
}
