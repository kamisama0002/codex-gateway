import { describe, expect, it } from "vitest";
import { createDataOpsSsoClient } from "./dataops-client";

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
