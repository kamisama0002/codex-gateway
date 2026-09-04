import { createEvent } from "h3";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { loginWithDataOpsForEvent } from "./dataops.post";
import { DataOpsSsoError } from "../../utils/gateway/auth/dataops-client";

describe("POST /api/auth/dataops", () => {
  it("exchanges the submitted ticket and returns the standard auth session", async () => {
    const event = eventWithJson({ ticket: "pct_once" });
    const claims = {
      audience: "codex-gateway" as const,
      tenantId: 1,
      userId: 9,
      username: "operator",
      externalSubject: "dataops:1:9",
      contextType: "PROJECT" as const,
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
    const session = {
      token: "gateway-token",
      expiresAt: "2026-10-04T00:00:00.000Z",
      user: { id: 2, username: "dataops-1-9", role: "user" as const },
    };

    await expect(
      loginWithDataOpsForEvent(
        event,
        { exchange: async (ticket: string) => (expect(ticket).toBe("pct_once"), claims) },
        { loginDataOps: () => session },
      ),
    ).resolves.toEqual(session);
  });

  it("rejects a missing ticket before contacting DataOps", async () => {
    const event = eventWithJson({});
    let exchanged = false;

    const error = await loginWithDataOpsForEvent(
      event,
      {
        exchange: async () => {
          exchanged = true;
          throw new Error("must not exchange");
        },
      },
      {
        loginDataOps: () => {
          throw new Error("must not login");
        },
      },
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ statusCode: 400 });
    expect(exchanged).toBe(false);
  });

  it.each([
    ["dataops_ticket_rejected", 401],
    ["dataops_timeout", 504],
    ["dataops_unavailable", 502],
    ["dataops_invalid_response", 502],
  ])("maps %s to HTTP %i", async (code, statusCode) => {
    const event = eventWithJson({ ticket: "pct_private" });
    const error = await loginWithDataOpsForEvent(
      event,
      { exchange: async () => Promise.reject(new DataOpsSsoError(code)) },
      {
        loginDataOps: () => {
          throw new Error("must not login");
        },
      },
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ statusCode, statusMessage: code });
    expect(String(error)).not.toContain("pct_private");
  });
});

function eventWithJson(value: unknown) {
  const request = new IncomingMessage(new Socket());
  const body = JSON.stringify(value);
  request.method = "POST";
  request.headers["content-type"] = "application/json";
  request.headers["content-length"] = String(Buffer.byteLength(body));
  request.push(body);
  request.push(null);
  return createEvent(request, new ServerResponse(request));
}
