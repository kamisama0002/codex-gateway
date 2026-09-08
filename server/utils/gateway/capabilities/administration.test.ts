import { describe, expect, it, vi } from "vitest";
import type { CapabilityCreateInput, CapabilityDefinition } from "~~/shared/types";
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

  it("rejects generic mutations for the protected Dinky MCP capability", async () => {
    const fixture = administrationFixture();
    await expect(fixture.service.updateCapability("org__dinky_mcp", {}, 1)).rejects.toMatchObject({
      message: "system_capability_read_only",
    });
    await expect(fixture.service.deleteCapability("org__dinky_mcp", 1)).rejects.toMatchObject({
      message: "system_capability_read_only",
    });
    await expect(
      fixture.service.setAssignment(
        { capabilityId: "org__dinky_mcp", userId: 7, projectId: null, assigned: true },
        1,
      ),
    ).rejects.toMatchObject({ message: "system_capability_read_only" });
    await expect(
      fixture.service.createCredential(
        { ...credentialInput(), capabilityId: "org__dinky_mcp" },
        1,
      ),
    ).rejects.toMatchObject({ message: "system_capability_read_only" });

    fixture.credentials.get.mockResolvedValue({
      ...credentialDescriptor(),
      capabilityId: "org__dinky_mcp",
    });
    await expect(
      fixture.service.rotateCredential("cred__business", { token: "rotated" }, 1),
    ).rejects.toMatchObject({ message: "system_capability_read_only" });
    await expect(fixture.service.revokeCredential("cred__business", 1)).rejects.toMatchObject({
      message: "system_capability_read_only",
    });
  });

  it("hides managed platform MCP capabilities from user and admin catalogs", async () => {
    const fixture = administrationFixture();
    const platformMcp = (id: string) => ({
      ...storedCapability(),
      id,
      source: { type: "internal" as const, locator: "managed-platform-mcp" },
    });
    fixture.capabilities.list.mockResolvedValue([
      storedCapability(),
      platformMcp("org__dinky_mcp"),
      platformMcp("org__infinity"),
    ]);
    fixture.capabilities.listDesiredForContext.mockResolvedValue([
      storedCapability(),
      platformMcp("org__dinky_mcp"),
      platformMcp("org__infinity"),
    ]);

    await expect(fixture.service.listAdminCatalog()).resolves.toMatchObject({
      capabilities: [{ id: "org__business" }],
    });
    await expect(fixture.service.listUserCatalog(7, 10)).resolves.toMatchObject({
      userId: 7,
      capabilities: [{ id: "org__business" }],
    });
  });

  it("creates a personal MCP owned and assigned only to the current user", async () => {
    const fixture = administrationFixture();
    fixture.capabilities.create.mockImplementation(async (input) => storedFromInput(input));

    await fixture.service.createPersonalMcp(capabilityDefinition(), 7);

    expect(fixture.capabilities.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "mcp",
        createdByUserId: 7,
        source: { type: "internal", locator: "personal-mcp:7" },
      }),
    );
    expect(fixture.capabilities.assign).toHaveBeenCalledWith({
      capabilityId: "org__business",
      userId: 7,
      projectId: null,
    });
  });

  it("removes a personal MCP if its automatic self-assignment fails", async () => {
    const fixture = administrationFixture();
    fixture.capabilities.assign.mockRejectedValue(new Error("assignment unavailable"));

    await expect(
      fixture.service.createPersonalMcp(capabilityDefinition(), 7),
    ).rejects.toThrow("assignment unavailable");
    expect(fixture.capabilities.delete).toHaveBeenCalledWith("org__business");
  });

  it("rejects personal MCP mutations owned by another user", async () => {
    const fixture = administrationFixture();
    fixture.capabilities.get.mockResolvedValue({
      ...storedCapability(),
      createdByUserId: 8,
    });

    await expect(
      fixture.service.updatePersonalMcp("org__business", { enabled: false }, 7),
    ).rejects.toMatchObject({ message: "personal_capability_forbidden", statusCode: 403 });
    await expect(fixture.service.deletePersonalMcp("org__business", 7)).rejects.toMatchObject({
      message: "personal_capability_forbidden",
      statusCode: 403,
    });
  });

  it("forces personal MCP credentials into the current user global scope", async () => {
    const fixture = administrationFixture();
    fixture.capabilities.get.mockResolvedValue({
      ...storedCapability(),
      createdByUserId: 7,
    });

    await fixture.service.createPersonalCredential(
      { ...credentialInput(), userId: 99, projectId: 10 },
      7,
    );

    expect(fixture.credentials.create).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: "org__business",
        userId: 7,
        projectId: null,
      }),
    );

    await fixture.service.revokePersonalCredential("cred__business", 7);
    expect(fixture.credentials.revoke).toHaveBeenCalledWith("cred__business");

    fixture.credentials.get.mockResolvedValue({ ...credentialDescriptor(), userId: 8 });
    await expect(
      fixture.service.revokePersonalCredential("cred__business", 7),
    ).rejects.toMatchObject({ message: "personal_credential_forbidden", statusCode: 403 });
  });
});

function administrationFixture() {
  const capabilities = {
    create: vi.fn(async (input: CapabilityCreateInput) => storedFromInput(input)),
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
  } satisfies CapabilityCreateInput;
}

function storedCapability(): CapabilityDefinition {
  return { ...capabilityDefinition(), createdAt: "now", updatedAt: "now" };
}

function storedFromInput(input: CapabilityCreateInput): CapabilityDefinition {
  return {
    ...input,
    sensitiveFields: input.sensitiveFields ?? [],
    enabled: input.enabled ?? true,
    createdByUserId: input.createdByUserId ?? null,
    createdAt: "now",
    updatedAt: "now",
  };
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
