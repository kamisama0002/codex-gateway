import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { createEvent } from "h3";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/users";
import { listUserCapabilitiesForEvent } from "../../../api/capabilities/index.get";
import { listAdminCapabilitiesForEvent } from "../../../api/admin/capabilities/index.get";
import { deleteCapabilityForEvent } from "../../../api/admin/capabilities/[id].delete";

describe("capability administration routes", () => {
  it("derives user catalog scope from the authenticated user", async () => {
    const event = eventFor(
      {
        id: 7,
        username: "operator",
        role: "user",
        dataOps: {
          provider: "dataops",
          externalSubject: "dataops:1:7",
          tenantId: 1,
          dataOpsUserId: 7,
          projectId: 10,
          authzVersion: 1,
        },
      },
      "/api/capabilities?userId=99&projectId=88",
    );
    const service = {
      listUserCatalog: vi.fn(async () => ({ capabilities: [], projectId: 10 })),
    };

    await expect(listUserCapabilitiesForEvent(event, service)).resolves.toEqual({
      capabilities: [],
      projectId: 10,
    });
    expect(service.listUserCatalog).toHaveBeenCalledWith(7, 10);
  });

  it("prevents ordinary users from enumerating or deleting admin capabilities", async () => {
    const event = eventFor({ id: 7, username: "operator", role: "user" });
    event.context.params = { id: "org__business" };
    const service = {
      listAdminCatalog: vi.fn(),
      deleteCapability: vi.fn(),
    };

    await expect(listAdminCapabilitiesForEvent(event, service)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(deleteCapabilityForEvent(event, service)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(service.listAdminCatalog).not.toHaveBeenCalled();
    expect(service.deleteCapability).not.toHaveBeenCalled();
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
