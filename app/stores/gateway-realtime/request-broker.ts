import type { RealtimeClientMessage, RealtimeServerMessage } from "~~/shared/types";
import { createUuid } from "@/lib/uuid";
import { isRealtimeRequestAbortError, RealtimeRequestError } from "./request-errors";

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
const MAX_INTENTIONALLY_ABORTED_REQUEST_IDS = 256;

export function createRealtimeRequestBroker(options: RealtimeRequestBrokerOptions) {
  const pendingRequests = new Map<string, PendingRealtimeRequest>();
  const intentionallyAbortedRequestIds = new Set<string>();

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
    const parse = typeof parseOrOptions === "function" ? parseOrOptions : undefined;
    const requestOptions =
      typeof parseOrOptions === "function" ? configuredOptions : parseOrOptions;
    await waitForReady(requestOptions?.signal);
    const requestId = `gateway-ws-${createUuid()}`;
    const requestMessage = buildMessage(requestId);
    if (requestOptions?.signal?.aborted === true) {
      throw abortedRequestError(requestMessage);
    }
    const timeoutMs = requestOptions?.timeoutMs ?? REALTIME_REQUEST_TIMEOUT_MS;
    const errorMode = requestOptions?.errorMode ?? "return";

    const response = await new Promise<RealtimeResponseMessage>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        rejectRequest(
          requestId,
          new RealtimeRequestError(options.timeoutMessage(), requestMessage, "timeout", {
            requestId,
            timeoutMs,
            ...options.requestContext(requestMessage),
          }),
        );
      }, timeoutMs);

      pendingRequests.set(requestId, {
        resolve,
        reject,
        timer,
        request: requestMessage,
        errorMode,
        signal: requestOptions?.signal,
      });
      if (requestOptions?.signal !== undefined) {
        const abortListener = () => {
          rememberIntentionalAbort(requestId);
          rejectRequest(requestId, abortedRequestError(requestMessage));
        };
        pendingRequests.get(requestId)!.abortListener = abortListener;
        requestOptions.signal.addEventListener("abort", abortListener, { once: true });
        if (requestOptions.signal.aborted) {
          abortListener();
          return;
        }
      }
      if (!options.send(requestMessage)) {
        rejectRequest(
          requestId,
          new RealtimeRequestError(options.unavailableMessage(), requestMessage, "unavailable", {
            requestId,
            ...options.requestContext(requestMessage),
          }),
        );
      }
    });
    return parse === undefined ? response : parse(response);
  }

  function resolveRequest(message: RealtimeResponseMessage) {
    const pending = pendingRequests.get(message.requestId);
    if (!pending) {
      intentionallyAbortedRequestIds.delete(message.requestId);
      return;
    }
    clearPendingRequest(message.requestId, pending);
    pending.resolve(message);
  }

  function rejectRequest(requestId: string, error: Error) {
    const pending = pendingRequests.get(requestId);
    if (!pending) {
      if (intentionallyAbortedRequestIds.delete(requestId)) {
        return { delivered: true, notify: false };
      }
      return { delivered: false, notify: true };
    }
    clearPendingRequest(requestId, pending);
    pending.reject(error);
    return {
      delivered: true,
      notify: pending.errorMode === "notify" && !isRealtimeRequestAbortError(error),
    };
  }

  function clearPendingRequest(requestId: string, pending: PendingRealtimeRequest) {
    window.clearTimeout(pending.timer);
    if (pending.signal !== undefined && pending.abortListener !== undefined) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
    pendingRequests.delete(requestId);
  }

  async function waitForReady(signal?: AbortSignal) {
    try {
      await options.waitForReady(REALTIME_READY_TIMEOUT_MS, signal);
    } catch (error: unknown) {
      if (signal?.aborted === true) throw abortedRequestError(undefined);
      throw error;
    }
  }

  function abortedRequestError(request: RealtimeRequestMessage | undefined) {
    return new RealtimeRequestError("Realtime request aborted", request, "aborted", {
      ...(request === undefined ? {} : options.requestContext(request)),
    });
  }

  function rememberIntentionalAbort(requestId: string) {
    intentionallyAbortedRequestIds.add(requestId);
    if (intentionallyAbortedRequestIds.size <= MAX_INTENTIONALLY_ABORTED_REQUEST_IDS) return;
    const oldestRequestId = intentionallyAbortedRequestIds.values().next().value;
    if (oldestRequestId !== undefined) intentionallyAbortedRequestIds.delete(oldestRequestId);
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

  return { request, resolveRequest, rejectRequest, rejectAllRequests };
}
