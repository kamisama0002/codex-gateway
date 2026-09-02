import type { RealtimeClientMessage, RealtimeServerMessage } from "../types";
import { realtimeClientMessageSchema } from "./realtime/client-message-schema";
import { realtimeServerMessageSchema } from "./realtime/server-message-schema";

export function parseRealtimeClientMessage(value: unknown): RealtimeClientMessage {
  const result = realtimeClientMessageSchema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  throw new Error(issue?.message ?? "Invalid realtime message");
}

export function parseRealtimeServerMessage(value: unknown): RealtimeServerMessage {
  return realtimeServerMessageSchema.parse(value);
}
