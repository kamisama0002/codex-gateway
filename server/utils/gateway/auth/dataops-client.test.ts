import { describe, expect, it } from "vitest";
import { createDataOpsSsoClient } from "./dataops-client";
import { dataOpsClaimsSchema } from "./dataops-claims";

const claims = {
  audience: "codex-gateway",
  tenantId: 1,
  userId: 9,
  username: "operator",
  externalSubject: "dataops:1:9",
  contextType: "PROJECT",
  projectId: 4,
  runtimeProfile: "DEVELOPMENT",
  platformAdmin: false,
  canDevelopAgents: false,
  canManageAgentStatus: false,
  canManageAgentRuntimeConfig: false,
  permissions: ["agent-center:view"],
  authzVersion: 3,
  issuedAt: "2026-09-04T00:00:00.000Z",
  ticket: null,
};

const runtimePolicy = {
  version: 1 as const,
  imageAlias: "stable",
  memoryMiB: 2048,
  cpuCores: 2,
  pidsLimit: 256,
};

describe("DataOps SSO client", () => {
  it("exchanges an opaque ticket server-to-server and validates the claims", async () => {
    let seenUrl = "";
    let seenAuthorization = "";
    const client = createDataOpsSsoClient({
      baseUrl: "http://dataops.internal:8888",
      sharedSecret: "shared-secret",
      fetch: async (url, init) => {
        seenUrl = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        seenAuthorization = new Headers(init?.headers).get("authorization") ?? "";
        expect(typeof init?.body).toBe("string");
        expect(JSON.parse(typeof init?.body === "string" ? init.body : "null")).toEqual({
          ticket: "pct_once",
        });
        return Response.json({ success: true, code: 0, msg: "success", data: claims });
      },
    });

    await expect(client.exchange("pct_once")).resolves.toEqual(claims);
    expect(seenUrl).toBe("http://dataops.internal:8888/api/codex-gateway/portal-tickets/exchange");
    expect(seenAuthorization).toBe("Bearer shared-secret");
  });

  it("accepts a strict version 1 runtime policy", () => {
    expect(dataOpsClaimsSchema.parse({ ...claims, runtimePolicy }).runtimePolicy).toEqual(
      runtimePolicy,
    );
  });

  it("keeps claims without a runtime policy valid during rollout", () => {
    expect(dataOpsClaimsSchema.parse(claims)).not.toHaveProperty("runtimePolicy");
  });

  it("accepts an offset-form issuedAt for a runtime policy before persistence normalizes it", () => {
    const issuedAt = "2026-09-04T02:00:00.000+02:00";

    expect(dataOpsClaimsSchema.parse({ ...claims, issuedAt, runtimePolicy }).issuedAt).toBe(
      issuedAt,
    );
  });

  it.each([
    ["unknown fields", { ...runtimePolicy, containerId: "container-private" }],
    ["unsupported versions", { ...runtimePolicy, version: 2 }],
    ["non-finite CPU", { ...runtimePolicy, cpuCores: Number.NaN }],
    ["invalid image aliases", { ...runtimePolicy, imageAlias: "Latest Image" }],
    ["memory below the minimum", { ...runtimePolicy, memoryMiB: 127 }],
    ["memory above the maximum", { ...runtimePolicy, memoryMiB: 16_385 }],
    ["CPU below the minimum", { ...runtimePolicy, cpuCores: 0.24 }],
    ["CPU above the maximum", { ...runtimePolicy, cpuCores: 8.01 }],
    ["CPU with more than two decimals", { ...runtimePolicy, cpuCores: 1.001 }],
    ["PID limits below the minimum", { ...runtimePolicy, pidsLimit: 31 }],
    ["PID limits above the maximum", { ...runtimePolicy, pidsLimit: 4097 }],
  ])("rejects runtime policies with %s", (_case, invalidPolicy) => {
    expect(() => dataOpsClaimsSchema.parse({ ...claims, runtimePolicy: invalidPolicy })).toThrow();
  });

  it("rejects invalid audiences without leaking the ticket or shared secret", async () => {
    const client = createDataOpsSsoClient({
      baseUrl: "http://dataops.internal:8888",
      sharedSecret: "shared-secret",
      fetch: async () =>
        Response.json({
          success: true,
          code: 0,
          data: { ...claims, audience: "infiniagent" },
        }),
    });

    const error = await client.exchange("pct_private").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("dataops_invalid_response");
    expect(String(error)).not.toContain("pct_private");
    expect(String(error)).not.toContain("shared-secret");
  });

  it("maps a rejected one-time ticket without exposing credentials", async () => {
    const client = createDataOpsSsoClient({
      baseUrl: "http://dataops.internal:8888",
      sharedSecret: "shared-secret",
      fetch: async () =>
        Response.json({ success: false, code: 1, msg: "expired pct_private", data: null }),
    });

    const error = await client.exchange("pct_private").catch((caught: unknown) => caught);
    expect(String(error)).toContain("dataops_ticket_rejected");
    expect(String(error)).not.toContain("pct_private");
    expect(String(error)).not.toContain("shared-secret");
  });

  it("aborts a stalled exchange at the configured timeout", async () => {
    const client = createDataOpsSsoClient({
      baseUrl: "http://dataops.internal:8888",
      sharedSecret: "shared-secret",
      timeoutMs: 5,
      fetch: async (_url, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () =>
              reject(
                init.signal?.reason instanceof Error
                  ? init.signal.reason
                  : new Error("DataOps exchange aborted"),
              ),
            { once: true },
          );
        }),
    });

    await expect(client.exchange("pct_once")).rejects.toThrow("dataops_timeout");
  });
});
