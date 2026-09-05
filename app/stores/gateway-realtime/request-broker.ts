import type { RealtimeClientMessage, RealtimeServerMessage } from "~~/shared/types";
import { createUuid } from "@/lib/uuid";
import { RealtimeRequestError } from "./request-errors";

type RealtimeRequestMessage = Extract<RealtimeClientMessage, { requestId: string }>;
type RealtimeResponseMessage = Extract<RealtimeServerMessage, { requestId: string }>;

interface PendingRealtimeRequest {
  resolve: (value: RealtimeResponseMessage) => void;
  reject: (error: Error) => void;
  timer: number;
  request: RealtimeRequestMessage;
  errorMode: RealtimeRequestErrorMode;
  signal?: AbortSignal;
  abortListener?: () => void;
  sent: boolean;
}

export type RealtimeRequestErrorMode = "return" | "notify";

interface RealtimeRequestOptions {
  timeoutMs?: number;
  errorMode?: RealtimeRequestErrorMode;
  signal?: AbortSignal;
}

export interface RealtimeRequestRejection {
  delivered: boolean;
  notify: boolean;
}

interface RealtimeRequestBrokerOptions {
  waitForReady: (timeoutMs: number, signal?: AbortSignal) => Promise<void>;
  send: (message: RealtimeClientMessage) => boolean;
  unavailableMessage: () => string;
  timeoutMessage: () => string;
  requestContext: (request: RealtimeRequestMessage) => Record<string, unknown>;
}

const REALTIME_READY_TIMEOUT_MS = 15_000;
// SSH reconnect and a remote Codex upgrade can precede app-server RPC work.
// Keep the browser deadline beyond the backend's 30-minute operation cap.
const REALTIME_REQUEST_TIMEOUT_MS = 31 * 60_000;

export function createRealtimeRequestBroker(options: RealtimeRequestBrokerOptions) {
  const pendingRequests = new Map<string, PendingRealtimeRequest>();

  function request(
    buildMessage: (requestId: string) => RealtimeRequestMessage,
    options?: RealtimeRequestOptions,
  ): Promise<RealtimeResponseMessage>;
  function request<T>(
    buildMessage: (requestId: string) => RealtimeRequestMessage,
    parse: (message: RealtimeResponseMessage) => T,
    options?: RealtimeRequestOptions,
  ): Promise<T>;
  async function request<T>(
    buildMessage: (requestId: string) => RealtimeRequestMessage,
    parseOrOptions?: ((message: RealtimeResponseMessage) => T) | RealtimeRequestOptions,
    configuredOptions?: RealtimeRequestOptions,
  ): Promise<RealtimeResponseMessage | T> {
    const requestId = `gateway-ws-${createUuid()}`;
    const requestMessage = buildMessage(requestId);
    const parse = typeof parseOrOptions === "function" ? parseOrOptions : undefined;
    const requestOptions =
      typeof parseOrOptions === "function" ? configuredOptions : parseOrOptions;
    const timeoutMs = requestOptions?.timeoutMs ?? REALTIME_REQUEST_TIMEOUT_MS;
    const errorMode = requestOptions?.errorMode ?? "return";
    const signal = requestOptions?.signal;
    await waitForReady(signal, requestMessage);

    const response = await new Promise<RealtimeResponseMessage>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        const pending = pendingRequests.get(requestId);
        if (pending === undefined) return;
        cancelServerRequest(pending);
        settlePending(requestId, pending);
        pending.reject(
          new RealtimeRequestError(options.timeoutMessage(), requestMessage, "timeout", {
            requestId,
            timeoutMs,
            ...options.requestContext(requestMessage),
          }),
        );
      }, timeoutMs);

      const pending: PendingRealtimeRequest = {
        resolve,
        reject,
        timer,
        request: requestMessage,
        errorMode,
        signal,
        sent: false,
      };
      if (signal !== undefined) {
        pending.abortListener = () => {
          cancelServerRequest(pending);
          rejectRequest(requestId, cancelledError(signal, requestMessage));
        };
        signal.addEventListener("abort", pending.abortListener, { once: true });
      }
      pendingRequests.set(requestId, pending);
      if (signal?.aborted === true) {
        pending.abortListener?.();
        return;
      }
      if (!options.send(requestMessage)) {
        rejectRequest(
          requestId,
          new RealtimeRequestError(options.unavailableMessage(), requestMessage, "unavailable", {
            requestId,
            ...options.requestContext(requestMessage),
          }),
        );
        return;
      }
      pending.sent = true;
    });
    return parse === undefined ? response : parse(response);
  }

  function resolveRequest(message: RealtimeResponseMessage) {
    const pending = pendingRequests.get(message.requestId);
    if (!pending) return;
    settlePending(message.requestId, pending);
    pending.resolve(message);
  }

  function rejectRequest(requestId: string, error: Error) {
    const pending = pendingRequests.get(requestId);
    if (!pending) return { delivered: false, notify: true };
    settlePending(requestId, pending);
    pending.reject(error);
    return { delivered: true, notify: pending.errorMode === "notify" };
  }

  function rejectAllRequests(error: Error) {
    for (const [requestId, pending] of pendingRequests) {
      rejectRequest(
        requestId,
        new RealtimeRequestError(error.message, pending.request, "disconnected", {
          requestId,
          ...options.requestContext(pending.request),
        }),
      );
    }
  }

  async function waitForReady(signal: AbortSignal | undefined, request: RealtimeRequestMessage) {
    try {
      await options.waitForReady(REALTIME_READY_TIMEOUT_MS, signal);
    } catch (error: unknown) {
      if (signal?.aborted === true) throw cancelledError(signal, request);
      throw error;
    }
    if (signal?.aborted === true) throw cancelledError(signal, request);
  }

  function settlePending(requestId: string, pending: PendingRealtimeRequest) {
    window.clearTimeout(pending.timer);
    pendingRequests.delete(requestId);
    if (pending.signal !== undefined && pending.abortListener !== undefined) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
  }

  function cancelServerRequest(pending: PendingRealtimeRequest) {
    if (!pending.sent) return;
    options.send({
      type: "request.cancel",
      targetRequestId: pending.request.requestId,
    });
  }

  return { request, resolveRequest, rejectRequest, rejectAllRequests };
}

function cancelledError(signal: AbortSignal, request: RealtimeRequestMessage) {
  const message = signal.reason instanceof Error ? signal.reason.message : "Request cancelled";
  return new RealtimeRequestError(message, request, "cancelled", {
    requestId: request.requestId,
  });
}
