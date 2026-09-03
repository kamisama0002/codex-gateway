import { recordFromUnknown } from "./utils/records";

export const PROVIDER_FAILURE_CODES = {
  unauthorized: "provider_unauthorized",
  forbidden: "provider_forbidden",
  quotaExhausted: "provider_quota_exhausted",
  rateLimited: "provider_rate_limited",
  timeout: "provider_timeout",
  unavailable: "provider_unavailable",
  requestRejected: "provider_request_rejected",
  protocolError: "provider_protocol_error",
} as const;

export type ProviderFailureKind = keyof typeof PROVIDER_FAILURE_CODES | "unknown";

const PROVIDER_FAILURE_CODE_ENTRIES = [
  ["unauthorized", PROVIDER_FAILURE_CODES.unauthorized],
  ["forbidden", PROVIDER_FAILURE_CODES.forbidden],
  ["quotaExhausted", PROVIDER_FAILURE_CODES.quotaExhausted],
  ["rateLimited", PROVIDER_FAILURE_CODES.rateLimited],
  ["timeout", PROVIDER_FAILURE_CODES.timeout],
  ["unavailable", PROVIDER_FAILURE_CODES.unavailable],
  ["requestRejected", PROVIDER_FAILURE_CODES.requestRejected],
  ["protocolError", PROVIDER_FAILURE_CODES.protocolError],
] as const;

export interface UpstreamProviderFailure {
  kind: Exclude<ProviderFailureKind, "unknown">;
  code: (typeof PROVIDER_FAILURE_CODES)[keyof typeof PROVIDER_FAILURE_CODES];
  responseStatus: number;
  retryable: boolean;
}

const QUOTA_MARKERS = [
  "insufficient_quota",
  "quota_exceeded",
  "quota exceeded",
  "quota exhausted",
  "insufficient balance",
  "insufficient credit",
  "billing",
];

const OVERLOAD_MARKERS = ["server_is_overloaded", "slow_down", "overloaded", "at capacity"];

export function classifyUpstreamProviderFailure(
  status: number,
  responseBody: string,
): UpstreamProviderFailure {
  const normalizedBody = responseBody.toLowerCase();
  if (status === 401) return nonRetryableFailure("unauthorized");
  if (status === 403) return nonRetryableFailure("forbidden");
  if (status === 402 || (status === 429 && includesMarker(normalizedBody, QUOTA_MARKERS))) {
    return nonRetryableFailure("quotaExhausted");
  }
  if (status === 429) {
    return {
      kind: "rateLimited",
      code: PROVIDER_FAILURE_CODES.rateLimited,
      responseStatus: status,
      retryable: true,
    };
  }
  if (status === 408 || status === 504) {
    return {
      kind: "timeout",
      code: PROVIDER_FAILURE_CODES.timeout,
      responseStatus: 504,
      retryable: true,
    };
  }
  if (status >= 500) {
    return {
      kind: "unavailable",
      code: PROVIDER_FAILURE_CODES.unavailable,
      responseStatus: includesMarker(normalizedBody, OVERLOAD_MARKERS) ? 503 : status,
      retryable: true,
    };
  }
  if (status >= 400) return nonRetryableFailure("requestRejected");
  return {
    kind: "protocolError",
    code: PROVIDER_FAILURE_CODES.protocolError,
    responseStatus: 502,
    retryable: false,
  };
}

export function providerFailureKindFromAppServerError(input: {
  codexErrorInfo: unknown;
  message?: string | null;
  additionalDetails?: string | null;
}): ProviderFailureKind {
  const text = `${input.message ?? ""}\n${input.additionalDetails ?? ""}`.toLowerCase();
  for (const [kind, code] of PROVIDER_FAILURE_CODE_ENTRIES) {
    if (text.includes(code)) return kind;
  }

  const info = input.codexErrorInfo;
  if (info === "unauthorized") return "unauthorized";
  if (info === "usageLimitExceeded") return "quotaExhausted";
  if (info === "rateLimitExceeded") return "rateLimited";
  if (info === "serverOverloaded") return "unavailable";
  if (info === "badRequest") return "requestRejected";

  const status = codexErrorHttpStatus(info);
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 402) return "quotaExhausted";
  if (status === 429) return includesMarker(text, QUOTA_MARKERS) ? "quotaExhausted" : "rateLimited";
  if (status === 408 || status === 504) return "timeout";
  if (status !== null && status >= 500) return "unavailable";
  if (status !== null && status >= 400) return "requestRejected";

  if (
    hasCodexErrorVariant(info, "httpConnectionFailed") ||
    hasCodexErrorVariant(info, "responseStreamConnectionFailed") ||
    hasCodexErrorVariant(info, "responseStreamDisconnected")
  ) {
    return "unavailable";
  }
  if (hasCodexErrorVariant(info, "responseTooManyFailedAttempts")) return "unavailable";
  return "unknown";
}

export function codexErrorHttpStatus(value: unknown): number | null {
  const info = recordFromUnknown(value);
  if (info === null) return null;
  for (const variant of [
    "httpConnectionFailed",
    "responseStreamConnectionFailed",
    "responseStreamDisconnected",
    "responseTooManyFailedAttempts",
  ]) {
    const details = recordFromUnknown(info[variant]);
    if (typeof details?.httpStatusCode === "number") return details.httpStatusCode;
  }
  return null;
}

export function providerErrorMessage(responseBody: string, status: number) {
  try {
    const parsed: unknown = JSON.parse(responseBody);
    const root = recordFromUnknown(parsed);
    const error = recordFromUnknown(root?.error);
    const message = error?.message ?? root?.message;
    if (typeof message === "string" && message.trim() !== "") return message.trim().slice(0, 1_000);
  } catch {
    // Non-JSON provider responses use the bounded plain-text fallback below.
  }
  const trimmed = responseBody.trim();
  return trimmed === "" ? `Provider request failed with HTTP ${status}.` : trimmed.slice(0, 1_000);
}

function nonRetryableFailure(
  kind: "unauthorized" | "forbidden" | "quotaExhausted" | "requestRejected",
): UpstreamProviderFailure {
  return {
    kind,
    code: PROVIDER_FAILURE_CODES[kind],
    // Codex treats malformed/configuration requests as terminal. The proxy retains the upstream
    // reason in the stable error code while preventing futile model-stream retries.
    responseStatus: 400,
    retryable: false,
  };
}

function includesMarker(value: string, markers: string[]) {
  return markers.some((marker) => value.includes(marker));
}

function hasCodexErrorVariant(value: unknown, key: string) {
  const record = recordFromUnknown(value);
  return record !== null && Object.hasOwn(record, key);
}
