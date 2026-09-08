import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { createEvent } from "h3";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/users";
import { startMcpOAuthForEvent } from "../../../api/capabilities/mcp/[id]/oauth/start.post";
import { completeMcpOAuthForEvent } from "../../../api/capabilities/mcp/oauth/callback.get";
import { revokeMcpOAuthForEvent } from "../../../api/capabilities/mcp/[id]/oauth/revoke.post";

describe("MCP OAuth routes", () => {
  it("starts OAuth only for the authenticated user and selected context", async () => {
    const event = eventFor(
      { id: 7, username: "operator", role: "user" },
      "/api/capabilities/mcp/org__business/oauth/start?projectId=10&threadId=thread-1",
    );
    event.context.params = { id: "org__business" };
    const start = vi.fn(async () => ({ authorizationUrl: "https://auth.example.test" }));

    await expect(startMcpOAuthForEvent(event, start)).resolves.toEqual({
      authorizationUrl: "https://auth.example.test",
    });
    expect(start).toHaveBeenCalledWith({
      userId: 7,
      projectId: 10,
      capabilityId: "org__business",
      threadId: "thread-1",
    });
  });

  it("completes callback state for the current user and rejects missing state", async () => {
    const event = eventFor(
      { id: 7, username: "operator", role: "user" },
      "/api/capabilities/mcp/oauth/callback?code=abc&state=state-value",
    );
    const complete = vi.fn(async () => ({ status: "completed" }));

    await expect(completeMcpOAuthForEvent(event, complete)).resolves.toEqual({
      status: "completed",
    });
    expect(complete).toHaveBeenCalledWith({
      userId: 7,
      state: "state-value",
      query: "code=abc&state=state-value",
    });
    await expect(
      completeMcpOAuthForEvent(
        eventFor(
          { id: 7, username: "operator", role: "user" },
          "/api/capabilities/mcp/oauth/callback?code=abc",
        ),
        complete,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("reports native revoke as unsupported instead of using a shell fallback", () => {
    const event = eventFor({ id: 7, username: "operator", role: "user" });
    expect(() => revokeMcpOAuthForEvent(event)).toThrow(
      expect.objectContaining({ statusCode: 501, data: { code: "unsupportedCapability" } }),
    );
  });
});

function eventFor(user: AuthenticatedUser, url = "/") {
  const request = new IncomingMessage(new Socket());
  request.url = url;
  const response = new ServerResponse(request);
  const event = createEvent(request, response);
  event.context.auth = { user, token: "token" };
  return event;
}
