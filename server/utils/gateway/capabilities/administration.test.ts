import { describe, expect, it, vi } from "vitest";
import { CapabilityAdministrationService } from "./administration";

describe("CapabilityAdministrationService", () => {
  it("returns an admin catalog without credential secret values", async () => {
    const fixture = administrationFixture();

    const catalog = await fixture.service.listAdminCatalog();

    expect(catalog.capabilities).toHaveLength(1);
    expect(catalog.capabilities[0]?.id).toBe("org__business");
    expect(catalog.capabilities[0]?.assignments[0]).toMatchObject({
      capabilityId: "org__business",
      userId: 7,
      projectId: 10,
    });
    expect(catalog.capabilities[0]?.credentials[0]).toMatchObject({
      id: "cred__business",
      capabilityId: "org__business",
    });
    expect(JSON.stringify(catalog)).not.toContain("plaintext-secret");
  });

  it("forces the actor identity and reconciles only the changed assignment scope", async () => {
    const fixture = administrationFixture();

    await fixture.service.createCapability({ ...capabilityDefinition(), createdByUserId: 999 }, 1);
    await fixture.service.setAssignment(
      { capabilityId: "org__business", userId: 7, projectId: 10, assigned: true },
      1,
    );

    expect(fixture.capabilities.create).toHaveBeenCalledWith(
      expect.objectContaining({ createdByUserId: 1 }),
    );
    expect(fixture.reconcile).toHaveBeenCalledWith({
      userId: 7,
      projectId: 10,
      reason: "assignmentChanged",
    });
    expect(fixture.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 1,
        userId: 7,
        action: "capability.assign",
        metadata: { capabilityId: "org__business", projectId: 10 },
      }),
    );
  });

  it("syncs runtime secrets after credential create, rotate, and revoke", async () => {
    const fixture = administrationFixture();

    await fixture.service.createCredential(credentialInput(), 1);
    await fixture.service.rotateCredential("cred__business", { token: "rotated" }, 1);
    await fixture.service.revokeCredential("cred__business", 1);

    expect(fixture.syncSecrets).toHaveBeenNthCalledWith(1, 7, 10, 1);
    expect(fixture.syncSecrets).toHaveBeenNthCalledWith(2, 7, 10, 1);
    expect(fixture.syncSecrets).toHaveBeenNthCalledWith(3, 7, 10, 1);
  });
});

function administrationFixture() {
  const capabilities = {
    create: vi.fn(async () => storedCapability()),
    get: vi.fn(async () => storedCapability()),
    list: vi.fn(async () => [storedCapability()]),
    update: vi.fn(async () => storedCapability()),
    delete: vi.fn(async () => true),
    assign: vi.fn(
      async (input: { capabilityId: string; userId: number; projectId: number | null }) => ({
        id: 1,
        ...input,
        createdAt: "now",
      }),
    ),
    unassign: vi.fn(async () => true),
    listAssignments: vi.fn(async () => [
      { id: 1, capabilityId: "org__business", userId: 7, projectId: 10, createdAt: "now" },
    ]),
    listDesiredForContext: vi.fn(async () => [storedCapability()]),
  };
  const credential = credentialDescriptor();
  const credentials = {
    create: vi.fn(async () => credential),
    get: vi.fn(async () => credential),
    list: vi.fn(async () => [credential]),
    rotate: vi.fn(async () => ({ ...credential, version: 2 })),
    revoke: vi.fn(async () => ({ ...credential, revokedAt: "2026-09-07T00:00:00.000Z" })),
  };
  const syncs = {
    list: vi.fn(async () => [
      {
        id: 1,
        userId: 7,
        projectId: 10,
        desiredHash: "a".repeat(64),
        actualHash: "a".repeat(64),
        status: "succeeded" as const,
        results: [],
        safeError: null,
        attemptCount: 1,
        createdAt: "now",
        updatedAt: "now",
      },
    ]),
    get: vi.fn(async () => null),
  };
  const audit = { record: vi.fn(async () => ({})) };
  const reconcile = vi.fn(async () => ({ status: "succeeded" as const }));
  const syncSecrets = vi.fn(async () => ({ status: "ready" }));
  const service = new CapabilityAdministrationService({
    capabilities,
    credentials,
    syncs,
    audit,
    reconcile,
    syncSecrets,
    listUsers: vi.fn(async () => [{ id: 7, username: "operator", role: "user" as const }]),
  });
  return { service, capabilities, credentials, syncs, audit, reconcile, syncSecrets };
}

function capabilityDefinition() {
  return {
    id: "org__business",
    kind: "mcp" as const,
    displayName: "Business MCP",
    description: "Business operations",
    version: "1.0.0",
    source: { type: "internal" as const, locator: "business-mcp" },
    config: { transport: "streamable_http" as const, url: "https://mcp.example.test" },
    sensitiveFields: ["BUSINESS_TOKEN"],
    enabled: true,
    createdByUserId: null,
  };
}

function storedCapability() {
  return { ...capabilityDefinition(), createdAt: "now", updatedAt: "now" };
}

function credentialInput() {
  return {
    id: "cred__business",
    capabilityId: "org__business",
    userId: 7,
    projectId: 10,
    kind: "token" as const,
    secret: { token: "plaintext-secret" },
    mappings: [{ field: "token", target: { type: "env" as const, name: "BUSINESS_TOKEN" } }],
    notBefore: null,
    expiresAt: null,
  };
}

function credentialDescriptor() {
  const { secret: _secret, ...descriptor } = credentialInput();
  return {
    ...descriptor,
    revokedAt: null,
    version: 1,
    createdAt: "now",
    updatedAt: "now",
  };
}
