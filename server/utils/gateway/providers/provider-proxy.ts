import { createError } from "h3";
import { providerStore, type ProviderStore } from "./provider-store";
import { verifyRuntimeModelToken, type RuntimeModelTokenClaims } from "./runtime-token";
import { toChatCompletionRequest } from "./protocol/responses-to-chat";
import { toResponsesResult } from "./protocol/chat-to-responses";
import { ChatStreamAssembler } from "./protocol/chat-stream-assembler";
import { encodeResponsesSse } from "./protocol/responses-sse";
import type { ProviderTool, ResponsesInputItem, ResponsesRequestInput } from "./protocol/types";
import { runtimeStore } from "../runtime-manager/runtime-store";

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const HOP_BY_HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

export interface ProviderProxyOptions {
  store?: Pick<ProviderStore, "listForUser" | "getWithSecret">;
  fetch?: typeof globalThis.fetch;
  verifyToken?: (token: string, scope: { userId: number; providerId: string; modelId: string }) => RuntimeModelTokenClaims;
  runtimeStore?: { getByUserId(userId: number): { status: string } | null };
}

export async function handleProviderResponses(
  request: Request,
  providerId: string,
  options: ProviderProxyOptions = {},
): Promise<Response> {
  const store = options.store ?? providerStore;
  const fetcher = options.fetch ?? globalThis.fetch;
  const token = bearer(request.headers.get("authorization"));
  const body = await readBody(request);
  const payload = parsePayload(body);
  const modelId = typeof payload.model === "string" ? payload.model : "";
  if (modelId === "") return jsonError(400, "invalid_request");
  const claims = extractClaims(token, providerId, modelId, options);
  const activeRuntimeStore = options.runtimeStore ?? runtimeStore;
  const runtime = activeRuntimeStore.getByUserId(claims.userId);
  if (runtime === null || runtime.status !== "ready") return jsonError(401, "runtime_not_ready");
  const models = store.listForUser(claims.userId);
  const model = models.find((entry) => entry.providerId === providerId && entry.modelId === modelId);
  if (model === undefined) return jsonError(403, "model_not_granted");
  const provider = store.getWithSecret(providerId);
  if (provider === null || !provider.enabled) return jsonError(503, "provider_unavailable");
  const upstreamPath = provider.wireApi === "responses" ? "/responses" : "/chat/completions";
  let upstreamBody: string;
  try {
    upstreamBody = provider.wireApi === "responses"
      ? new TextDecoder().decode(body)
      : JSON.stringify(toChatCompletionRequest(parseResponsesRequest(payload, modelId), model.capabilities));
  } catch (error) {
    if (error instanceof Error && error.name === "ProviderCapabilityError") return jsonError(400, "provider_capability_unsupported");
    return jsonError(400, "invalid_request");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), provider.requestTimeoutMs);
  try {
    const upstream = await fetcher(`${provider.baseUrl}${upstreamPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${provider.apiKey}` },
      body: upstreamBody,
      signal: controller.signal,
    });
    if (!upstream.ok) return jsonError(upstream.status === 429 ? 429 : 502, upstream.status === 429 ? "provider_rate_limited" : "provider_request_failed");
    if (provider.wireApi === "responses") return passthrough(upstream);
    if (payload.stream === true) return translateChatStream(upstream);
    const value: unknown = await upstream.json();
    if (!isChatCompletionResponse(value)) return jsonError(502, "provider_invalid_response");
    return Response.json(toResponsesResult(value, modelId));
  } catch {
    if (controller.signal.aborted) return jsonError(504, "provider_timeout");
    return jsonError(502, "provider_unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

function extractClaims(
  token: string,
  providerId: string,
  modelId: string,
  options: ProviderProxyOptions,
): RuntimeModelTokenClaims {
  try {
    const claims = options.verifyToken?.(token, { userId: 0, providerId, modelId });
    if (claims !== undefined) return claims;
    return verifyRuntimeModelToken(token, { providerId, modelId });
  } catch {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }
}

function bearer(value: string | null): string {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  if (match?.[1] === undefined || match[1].trim() === "") throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  return match[1].trim();
}

async function readBody(request: Request): Promise<Uint8Array> {
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_BODY_BYTES) throw createError({ statusCode: 413, statusMessage: "Request too large" });
  return body;
}

function parsePayload(body: Uint8Array): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(body));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    if (!isRecord(value)) throw new Error("Invalid JSON object");
    return value;
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid JSON" });
  }
}

function passthrough(upstream: Response): Response {
  const headers = new Headers();
  upstream.headers.forEach((value, key) => { if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) headers.set(key, value); });
  return new Response(upstream.body, { status: upstream.status, headers });
}

function translateChatStream(upstream: Response): Response {
  if (upstream.body === null) return jsonError(502, "provider_invalid_stream");
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const assembler = new ChatStreamAssembler();
  let pending = "";
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          pending += decoder.decode();
          if (pending.trim() !== "") {
            const data = pending.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
            if (data !== "" && data !== "[DONE]") {
              const chunk: unknown = JSON.parse(data);
              if (!isRecord(chunk)) throw new Error("Invalid Chat stream chunk");
              for (const event of assembler.push(chunk)) controller.enqueue(encodeResponsesSse(event));
            }
          }
          for (const event of assembler.finish()) controller.enqueue(encodeResponsesSse(event));
          controller.close();
          return;
        }
        pending += decoder.decode(value, { stream: true });
        const frames = pending.split(/\n\n+/);
        pending = frames.pop() ?? "";
        for (const frame of frames) {
          const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
          if (data === "" || data === "[DONE]") continue;
          const chunk: unknown = JSON.parse(data);
          if (!isRecord(chunk)) throw new Error("Invalid Chat stream chunk");
          for (const event of assembler.push(chunk)) controller.enqueue(encodeResponsesSse(event));
        }
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() { void reader.cancel(); },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
}

function jsonError(status: number, code: string): Response {
  return Response.json({ error: { code, message: code } }, { status });
}

function parseResponsesRequest(payload: Record<string, unknown>, model: string) {
  const input: ResponsesRequestInput = { model };
  if (typeof payload.instructions === "string") input.instructions = payload.instructions;
  if (typeof payload.input === "string") input.input = payload.input;
  else if (isUnknownArray(payload.input)) {
    if (!payload.input.every(isResponsesInputItem)) throw new Error("Invalid Responses input item");
    input.input = payload.input;
  }
  if (typeof payload.stream === "boolean") input.stream = payload.stream;
  if (typeof payload.temperature === "number") input.temperature = payload.temperature;
  if (typeof payload.top_p === "number") input.top_p = payload.top_p;
  if (typeof payload.max_output_tokens === "number") input.max_output_tokens = payload.max_output_tokens;
  if (isUnknownArray(payload.tools)) {
    if (!payload.tools.every(isProviderTool)) throw new Error("Invalid Responses tool");
    input.tools = payload.tools;
  }
  return input;
}

function isResponsesInputItem(value: unknown): value is ResponsesInputItem {
  return isRecord(value) && typeof value.type === "string";
}

function isProviderTool(value: unknown): value is ProviderTool {
  return isRecord(value) && typeof value.type === "string";
}

function isChatCompletionResponse(value: unknown): value is Parameters<typeof toResponsesResult>[0] {
  return isRecord(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
