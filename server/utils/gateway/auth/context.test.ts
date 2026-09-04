import { createEvent } from "h3";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "./users";
import { requireAdminUser, requireDataOpsAdvancedSettingsAccess } from "./context";

describe("requireAdminUser", () => {
  it("returns the authenticated administrator and rejects ordinary users", () => {
    const adminEvent = eventFor({ id: 1, username: "admin", role: "admin" });
    const userEvent = eventFor({ id: 2, username: "user", role: "user" });

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
    const ordinaryDataOps = eventFor({ id: 2, username: "user", role: "user", dataOps });
    const adminDataOps = eventFor({ id: 1, username: "admin", role: "admin", dataOps });
    const standalone = eventFor({ id: 3, username: "standalone", role: "user" });

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

function eventFor(user: AuthenticatedUser) {
  const request = new IncomingMessage(new Socket());
  const response = new ServerResponse(request);
  const event = createEvent(request, response);
  event.context.auth = { user, token: "token" };
  return event;
}
