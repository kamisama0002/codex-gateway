import type { RealtimeClientMessage } from "~~/shared/types";
import { turnInterruptSchema } from "../http/validation/threads";
import { threadBroker } from "../runtime/broker";
import { requireWorkspaceHost } from "../runtime-manager/local-workspace";

export type RealtimeTurnInterruptMessage = Extract<
  RealtimeClientMessage,
  { type: "turn.interrupt" }
>;

export async function interruptTurnFromRealtime(message: RealtimeTurnInterruptMessage) {
  const input = turnInterruptSchema.parse(message);
  const host = await requireWorkspaceHost(input.hostId);
  return threadBroker.interruptTurn(host, input.threadId, input.turnId);
}
