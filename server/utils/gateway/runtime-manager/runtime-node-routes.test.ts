import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { createEvent } from "h3";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/users";
import { createRuntimeNodeForEvent } from "../../../api/admin/runtime-nodes/index.post";
import { listRuntimeNodesForEvent } from "../../../api/admin/runtime-nodes/index.get";
import { patchRuntimeNodeForEvent } from "../../../api/admin/runtime-nodes/[nodeId].patch";
import { probeRuntimeNodeForEvent } from "../../../api/admin/runtime-nodes/[nodeId]/probe.post";
import {
  runtimeNodeAdminCreateInputSchema,
  runtimeNodeAdminPatchInputSchema,
  runtimeNodeAdminViewSchema,
  type RuntimeNodeAdminCreateInput,
  type RuntimeNodeAdminPatchInput,
  type RuntimeNodeAdminView,
} from "./runtime-node-admin-types";
import { validateRuntimeNodeBaseUrlPolicy } from "./runtime-node-administration";

interface RuntimeNodeServiceDouble {
  listNodes(): Promise<RuntimeNodeAdminView[]>;
  createNode(input: RuntimeNodeAdminCreateInput): Promise<RuntimeNodeAdminView>;
  patchNode(nodeId: string, input: RuntimeNodeAdminPatchInput): Promise<RuntimeNodeAdminView>;
  probeNode(nodeId: string): Promise<RuntimeNodeAdminView>;
}

describe("runtime node admin routes", () => {
  it("requires HTTPS unless isolated HTTP is explicitly enabled", () => {
    expect(() => validateRuntimeNodeBaseUrlPolicy("https://runtime.internal", false)).not.toThrow();
    expect(() => validateRuntimeNodeBaseUrlPolicy("http://10.1.250.8:8787", false)).toThrow(
      "runtime_node_invalid_configuration",
    );
    expect(() => validateRuntimeNodeBaseUrlPolicy("http://10.1.250.8:8787", true)).not.toThrow();
  });

  it("uses the nested web contract for capacity, state, and health", () => {
    expect(
      runtimeNodeAdminCreateInputSchema.parse({
        id: "node__primary",
        name: "Primary Node",
        baseUrl: "https://runtime-a.internal",
        sharedSecret: "plaintext-secret",
        state: "active",
        capacity: runtimeNodeView().capacity,
      }),
    ).toMatchObject({ state: "active", capacity: runtimeNodeView().capacity });
    expect(
      runtimeNodeAdminPatchInputSchema.parse({
        state: "draining",
        capacity: runtimeNodeView().capacity,
      }),
    ).toMatchObject({ state: "draining", capacity: runtimeNodeView().capacity });
    expect(runtimeNodeAdminViewSchema.parse(runtimeNodeView())).toEqual(runtimeNodeView());
  });

  it("requires an administrator for list, create, patch, and probe", async () => {
    const service = runtimeNodeService();
    const event = eventFor({ id: 7, username: "user", role: "user" });
    event.context.params = { nodeId: "node__primary" };
    event.context.body = { id: "node__primary" };

    expect(() => listRuntimeNodesForEvent(event, service)).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    );
    await expect(createRuntimeNodeForEvent(event, service)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(patchRuntimeNodeForEvent(event, service)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(probeRuntimeNodeForEvent(event, service)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("lists runtime nodes without exposing transport secrets or base URLs", async () => {
    const service = runtimeNodeService({
      listNodes: async () => [runtimeNodeView()],
    });
    const event = eventFor({ id: 1, username: "admin", role: "admin" });

    const result = await listRuntimeNodesForEvent(event, service);

    expect(result).toEqual([runtimeNodeView()]);
    expect(JSON.stringify(result)).not.toContain("https://runtime-a.internal");
    expect(JSON.stringify(result)).not.toContain("encryptedSharedSecret");
    expect(JSON.stringify(result)).not.toContain("sharedSecret");
  });

  it("creates a runtime node from a plaintext secret only after a matching probe", async () => {
    const service = runtimeNodeService({
      createNode: async (input) => ({
        ...runtimeNodeView({ id: input.id, name: input.name, state: input.state }),
      }),
    });
    const event = eventFor({ id: 1, username: "admin", role: "admin" }, "POST");
    event.context.body = {
      id: "node__primary",
      name: "Primary Node",
      baseUrl: "https://runtime-a.internal",
      sharedSecret: "plaintext-secret",
      state: "active",
      capacity: {
        cpuMillis: 32000,
        memoryBytes: 64 * 1024 * 1024 * 1024,
        maxRuntimes: 30,
        minimumFreeDiskBytes: 20 * 1024 * 1024 * 1024,
      },
    };

    await expect(createRuntimeNodeForEvent(event, service)).resolves.toEqual(
      runtimeNodeView({ id: "node__primary", name: "Primary Node" }),
    );
    expect(JSON.stringify(service.createNode.mock.calls[0]?.[0])).toContain("plaintext-secret");
    expect(JSON.stringify(service.createNode.mock.calls[0]?.[0])).not.toContain("encrypted");
  });

  it("patches capacity, scheduling state, and optional secret without echoing the secret", async () => {
    const service = runtimeNodeService({
      patchNode: async (_nodeId, input) => ({
        ...runtimeNodeView({
          name: input.name ?? "Primary Node",
          state: input.state ?? "active",
        }),
      }),
    });
    const event = eventFor({ id: 1, username: "admin", role: "admin" }, "POST");
    event.context.params = { nodeId: "node__primary" };
    event.context.body = {
      name: "Primary Node v2",
      capacity: {
        cpuMillis: 64000,
        memoryBytes: 128 * 1024 * 1024 * 1024,
        maxRuntimes: 40,
        minimumFreeDiskBytes: 40 * 1024 * 1024 * 1024,
      },
      state: "draining",
      sharedSecret: "rotated-secret",
    };

    await expect(patchRuntimeNodeForEvent(event, service)).resolves.toMatchObject({
      name: "Primary Node v2",
      state: "draining",
    });
    expect(JSON.stringify(service.patchNode.mock.calls[0]?.[1])).toContain("rotated-secret");
    expect(JSON.stringify(service.patchNode.mock.calls[0]?.[1])).not.toContain("encrypted");
    const updated = await patchRuntimeNodeForEvent(event, service);
    expect(JSON.stringify(updated)).not.toContain("rotated-secret");
  });

  it("probes runtime node health and returns last-seen scheduling data without secrets", async () => {
    const service = runtimeNodeService({
      probeNode: async () =>
        runtimeNodeView({
          health: {
            ...runtimeNodeHealth(),
            lastSeenAt: "2026-09-08T00:00:10.000Z",
          },
        }),
    });
    const event = eventFor({ id: 1, username: "admin", role: "admin" }, "POST");
    event.context.params = { nodeId: "node__primary" };

    const result = await probeRuntimeNodeForEvent(event, service);

    expect(result).toMatchObject({
      health: {
        lastSeenAt: "2026-09-08T00:00:10.000Z",
        managerVersion: "0.153.4",
        managedRuntimeCount: 2,
        runningRuntimeCount: 1,
      },
    });
    expect(JSON.stringify(result)).not.toContain("encryptedSharedSecret");
    expect(JSON.stringify(result)).not.toContain("sharedSecret");
  });
});

function eventFor(user: AuthenticatedUser, method = "GET") {
  const request = new IncomingMessage(new Socket());
  request.method = method;
  const response = new ServerResponse(request);
  const event = createEvent(request, response);
  event.context.auth = { user, token: "token" };
  return event;
}

function runtimeNodeService(
  overrides: Partial<RuntimeNodeServiceDouble> = {},
): RuntimeNodeServiceDouble & {
  listNodes: ReturnType<typeof vi.fn<RuntimeNodeServiceDouble["listNodes"]>>;
  createNode: ReturnType<typeof vi.fn<RuntimeNodeServiceDouble["createNode"]>>;
  patchNode: ReturnType<typeof vi.fn<RuntimeNodeServiceDouble["patchNode"]>>;
  probeNode: ReturnType<typeof vi.fn<RuntimeNodeServiceDouble["probeNode"]>>;
} {
  return {
    listNodes: vi.fn(overrides.listNodes ?? (async () => [runtimeNodeView()])),
    createNode: vi.fn(overrides.createNode ?? (async () => runtimeNodeView())),
    patchNode: vi.fn(overrides.patchNode ?? (async () => runtimeNodeView())),
    probeNode: vi.fn(overrides.probeNode ?? (async () => runtimeNodeView())),
  };
}

function runtimeNodeView(overrides: Partial<RuntimeNodeAdminView> = {}): RuntimeNodeAdminView {
  return {
    id: "node__primary",
    name: "Primary Node",
    state: "active",
    configRevision: 1,
    capacity: {
      cpuMillis: 32000,
      memoryBytes: 64 * 1024 * 1024 * 1024,
      maxRuntimes: 30,
      minimumFreeDiskBytes: 20 * 1024 * 1024 * 1024,
    },
    reservation: {
      cpuMillis: 5000,
      memoryBytes: 10 * 1024 * 1024 * 1024,
      pids: 1024,
      runtimes: 2,
    },
    health: runtimeNodeHealth(),
    ...overrides,
  };
}

function runtimeNodeHealth() {
  return {
    availableDiskBytes: 100 * 1024 * 1024 * 1024,
    totalDiskBytes: 200 * 1024 * 1024 * 1024,
    dockerAvailable: true,
    dataRootWritable: true,
    managerVersion: "0.153.4",
    managedRuntimeCount: 2,
    runningRuntimeCount: 1,
    lastSeenAt: "2026-09-08T00:00:00.000Z",
    lastError: null,
  };
}
