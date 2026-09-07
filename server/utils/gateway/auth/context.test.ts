import { createEvent } from "h3";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "./users";
import { userStore } from "./users";
import {
  authenticateEvent,
  optionalAuthenticatedUser,
  requireAdminUser,
  requireAuthenticatedUser,
  requireDataOpsAdvancedSettingsAccess,
} from "./context";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authentication context", () => {
  it("awaits bearer authentication before installing request context", async () => {
    const user = authenticatedUser({ id: 4, username: "async-user" });
    const authenticate = vi.spyOn(userStore, "authenticateToken").mockResolvedValue(user);
    const event = eventFor(null, "Bearer async-token");

    await expect(authenticateEvent(event)).resolves.toEqual(user);

    expect(authenticate).toHaveBeenCalledWith("async-token");
    expect(event.context.auth).toEqual({ user, token: "async-token" });
  });

  it("fails closed with database_unavailable when token storage rejects", async () => {
    vi.spyOn(userStore, "authenticateToken").mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    );
    const event = eventFor(null, "Bearer stored-token");

    await expect(authenticateEvent(event)).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: "database_unavailable",
      data: { code: "database_unavailable" },
    });
    expect(event.context.auth).toBeUndefined();
  });

  it("returns no optional user for a missing bearer token without querying storage", async () => {
    const authenticate = vi.spyOn(userStore, "authenticateToken");

    await expect(optionalAuthenticatedUser(eventFor(null))).resolves.toBeNull();

    expect(authenticate).not.toHaveBeenCalled();
  });

  it("keeps required-user guards synchronous and context-only", () => {
    const authenticate = vi.spyOn(userStore, "authenticateToken");

    expect(() => requireAuthenticatedUser(eventFor(null))).toThrow(
      expect.objectContaining({ statusCode: 401 }),
    );
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("returns the authenticated administrator and rejects ordinary users", () => {
    const adminEvent = eventFor(authenticatedUser({ id: 1, username: "admin", role: "admin" }));
    const userEvent = eventFor(authenticatedUser({ id: 2, username: "user" }));

    expect(requireAdminUser(adminEvent)).toMatchObject({ id: 1, role: "admin" });
    expect(() => requireAdminUser(userEvent)).toThrow(expect.objectContaining({ statusCode: 403 }));
  });

  it("restricts advanced settings only for ordinary DataOps sessions", () => {
    const dataOps = {
      provider: "dataops" as const,
      externalSubject: "dataops:1:2",
      tenantId: 1,
      dataOpsUserId: 2,
      projectId: 4,
      authzVersion: 1,
    };
    const ordinaryDataOps = eventFor(authenticatedUser({ id: 2, username: "user", dataOps }));
    const adminDataOps = eventFor(
      authenticatedUser({ id: 1, username: "admin", role: "admin", dataOps }),
    );
    const standalone = eventFor(authenticatedUser({ id: 3, username: "standalone" }));

    expect(() => requireDataOpsAdvancedSettingsAccess(ordinaryDataOps)).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    );
    expect(requireDataOpsAdvancedSettingsAccess(adminDataOps)).toMatchObject({
      id: 1,
      role: "admin",
    });
    expect(requireDataOpsAdvancedSettingsAccess(standalone)).toMatchObject({
      id: 3,
      role: "user",
    });
  });
});

function authenticatedUser(
  overrides: Partial<AuthenticatedUser> & Pick<AuthenticatedUser, "id" | "username">,
): AuthenticatedUser {
  return { role: "user", ...overrides };
}

function eventFor(user: AuthenticatedUser | null, authorization?: string) {
  const request = new IncomingMessage(new Socket());
  if (authorization !== undefined) request.headers.authorization = authorization;
  const response = new ServerResponse(request);
  const event = createEvent(request, response);
  if (user !== null) event.context.auth = { user, token: "token" };
  return event;
}
