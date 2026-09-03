import { describe, expect, it } from "vitest";
import {
  classifyUpstreamProviderFailure,
  codexErrorHttpStatus,
  providerErrorMessage,
  providerFailureKindFromAppServerError,
} from "./provider-failure";

describe("provider failure classification", () => {
  it.each([
    [401, "unauthorized", "unauthorized", 400, false],
    [403, "forbidden", "forbidden", 400, false],
    [402, "payment required", "quotaExhausted", 400, false],
    [429, '{"error":{"code":"insufficient_quota"}}', "quotaExhausted", 400, false],
    [429, "too many requests", "rateLimited", 429, true],
    [504, "timeout", "timeout", 504, true],
    [503, "at capacity", "unavailable", 503, true],
    [422, "unsupported parameter", "requestRejected", 400, false],
  ] as const)("maps HTTP %s to %s", (status, body, kind, responseStatus, retryable) => {
    expect(classifyUpstreamProviderFailure(status, body)).toMatchObject({
      kind,
      responseStatus,
      retryable,
    });
  });

  it("reads a bounded provider message", () => {
    expect(providerErrorMessage('{"error":{"message":"Invalid API key"}}', 401)).toBe(
      "Invalid API key",
    );
    expect(providerErrorMessage("", 503)).toBe("Provider request failed with HTTP 503.");
  });

  it("recovers provider meaning from app-server errors", () => {
    expect(
      providerFailureKindFromAppServerError({
        codexErrorInfo: "badRequest",
        additionalDetails: '{"error":{"code":"provider_unauthorized"}}',
      }),
    ).toBe("unauthorized");
    expect(
      providerFailureKindFromAppServerError({
        codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 429 } },
      }),
    ).toBe("rateLimited");
    expect(codexErrorHttpStatus({ responseStreamDisconnected: { httpStatusCode: 504 } })).toBe(504);
  });
});
