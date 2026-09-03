import { describe, expect, it } from "vitest";
import { issueRuntimeModelToken, verifyRuntimeModelToken } from "./runtime-token";

describe("runtime model tokens", () => {
  const input = { userId: 1, runtimeId: "runtime-a", providerId: "p1", modelId: "m1" };

  it("binds a token to provider and model scope", () => {
    const token = issueRuntimeModelToken(input, "test-secret", 1_000);
    expect(verifyRuntimeModelToken(token, { providerId: "p1", modelId: "m1" }, "test-secret", 1_001)).toMatchObject(input);
    expect(() => verifyRuntimeModelToken(token, { providerId: "p2", modelId: "m1" }, "test-secret", 1_001)).toThrow();
  });

  it("rejects expiry and tampering", () => {
    const token = issueRuntimeModelToken({ ...input, ttlMs: 100 }, "test-secret", 1_000);
    expect(() => verifyRuntimeModelToken(token, { providerId: "p1", modelId: "m1" }, "test-secret", 1_101)).toThrow();
    const parts = token.split(".");
    parts[1] = `${parts[1]}x`;
    expect(() => verifyRuntimeModelToken(parts.join("."), { providerId: "p1", modelId: "m1" }, "test-secret", 1_001)).toThrow();
  });
});
