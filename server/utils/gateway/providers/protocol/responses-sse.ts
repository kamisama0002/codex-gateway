import type { ResponsesStreamEvent } from "./chat-stream-assembler";

const encoder = new TextEncoder();

export function encodeResponsesSse(event: ResponsesStreamEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export function encodeResponsesSseComment(comment: string): Uint8Array {
  return encoder.encode(`: ${comment}\n\n`);
}

export function parseResponsesSseChunk(chunk: string): ResponsesStreamEvent[] {
  const events: ResponsesStreamEvent[] = [];
  for (const frame of chunk.split(/\n\n+/)) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data === "" || data === "[DONE]") continue;
    const value: unknown = JSON.parse(data);
    if (!isResponsesStreamEvent(value)) {
      throw new Error("Invalid Responses SSE event");
    }
    events.push(value);
  }
  return events;
}

function isResponsesStreamEvent(value: unknown): value is ResponsesStreamEvent {
  return isRecord(value) && typeof value.type === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
