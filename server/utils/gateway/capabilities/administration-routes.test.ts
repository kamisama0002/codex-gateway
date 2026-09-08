import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { createEvent } from "h3";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/users";
import { listUserCapabilitiesForEvent } from "../../../api/capabilities/index.get";
import { listAdminCapabilitiesForEvent } from "../../../api/admin/capabilities/index.get";
import { deleteCapabilityForEvent } from "../../../api/admin/capabilities/[id].delete";
import { createPersonalMcpForEvent } from "../../../api/capabilities/mcp/index.post";
import { updatePersonalMcpForEvent } from "../../../api/capabilities/mcp/[id].patch";
import { deletePersonalMcpForEvent } from "../../../api/capabilities/mcp/[id].delete";
import { createPersonalMcpCredentialForEvent } from "../../../api/capabilities/mcp/[id]/credentials/index.post";
import { revokePersonalMcpCredentialForEvent } from "../../../api/capabilities/mcp/[id]/credentials/[credentialId].delete";

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
      listUserCatalog: vi.fn(async () => ({ userId: 7, capabilities: [], projectId: 10 })),
    };

    await expect(listUserCapabilitiesForEvent(event, service)).resolves.toEqual({
      capabilities: [],
      userId: 7,
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

  it("routes personal MCP mutations through the authenticated user identity", async () => {
    const createEvent = eventWithJsonFor(
      { id: 7, username: "operator", role: "user" },
      {
        id: "org__personal_crm",
        kind: "mcp",
        displayName: "CRM MCP",
        description: "Personal CRM tools",
        version: "1.0.0",
        source: { type: "internal", locator: "ignored-by-server" },
        config: { transport: "streamable_http", url: "https://mcp.example.test" },
        sensitiveFields: ["CRM_TOKEN"],
        enabled: true,
      },
    );
    const service = {
      createPersonalMcp: vi.fn(async () => ({ created: true })),
      updatePersonalMcp: vi.fn(async () => ({ updated: true })),
      deletePersonalMcp: vi.fn(async () => ({ deleted: true })),
      createPersonalCredential: vi.fn(async () => ({ credential: true })),
      revokePersonalCredential: vi.fn(async () => ({ revoked: true })),
    };

    await expect(createPersonalMcpForEvent(createEvent, service)).resolves.toEqual({
      created: true,
    });
    expect(service.createPersonalMcp).toHaveBeenCalledWith(
      expect.objectContaining({ id: "org__personal_crm", kind: "mcp" }),
      7,
    );

    const updateEvent = eventWithJsonFor(
      { id: 7, username: "operator", role: "user" },
      { enabled: false },
    );
    updateEvent.context.params = { id: "org__personal_crm" };
    await updatePersonalMcpForEvent(updateEvent, service);
    expect(service.updatePersonalMcp).toHaveBeenCalledWith(
      "org__personal_crm",
      expect.objectContaining({ enabled: false }),
      7,
    );

    const deleteEvent = eventFor({ id: 7, username: "operator", role: "user" });
    deleteEvent.context.params = { id: "org__personal_crm" };
    await deletePersonalMcpForEvent(deleteEvent, service);
    expect(service.deletePersonalMcp).toHaveBeenCalledWith("org__personal_crm", 7);

    const credentialEvent = eventWithJsonFor(
      { id: 7, username: "operator", role: "user" },
      {
        id: "cred__personal_crm",
        capabilityId: "org__different",
        userId: 99,
        projectId: 10,
        kind: "token",
        secret: { token: "private-token" },
        mappings: [{ field: "token", target: { type: "env", name: "CRM_TOKEN" } }],
        notBefore: null,
        expiresAt: null,
      },
    );
    credentialEvent.context.params = { id: "org__personal_crm" };
    await createPersonalMcpCredentialForEvent(credentialEvent, service);
    expect(service.createPersonalCredential).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityId: "org__personal_crm" }),
      7,
    );

    const revokeEvent = eventFor({ id: 7, username: "operator", role: "user" });
    revokeEvent.context.params = {
      id: "org__personal_crm",
      credentialId: "cred__personal_crm",
    };
    await revokePersonalMcpCredentialForEvent(revokeEvent, service);
    expect(service.revokePersonalCredential).toHaveBeenCalledWith("cred__personal_crm", 7);
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

function eventWithJsonFor(user: AuthenticatedUser, value: unknown) {
  const request = new IncomingMessage(new Socket());
  const body = JSON.stringify(value);
  request.method = "POST";
  request.headers["content-type"] = "application/json";
  request.headers["content-length"] = String(Buffer.byteLength(body));
  request.push(body);
  request.push(null);
  const event = createEvent(request, new ServerResponse(request));
  event.context.auth = { user, token: "token" };
  return event;
}
