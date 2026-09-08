import { describe, expect, it, vi } from "vitest";
import { createDataOpsMcpCredentialService } from "./dataops-mcp-credential-service";

describe("DataOpsMcpCredentialService", () => {
  it("binds the mapped Gateway user and syncs only that user's runtime", async () => {
    const fixture = createFixture();

    const result = await fixture.service.bind(
      {
        pairingId: "pairing-fixed",
        revision: 3,
        tenantId: 7,
        dataOpsUserId: 42,
        token: "long-lived-dinky-token",
      },
      "paired-secret",
    );

    expect(result).toEqual({ status: "ready", pairingId: "pairing-fixed", revision: 3 });
    expect(fixture.authenticate).toHaveBeenCalledWith("pairing-fixed", 3, "paired-secret");
    expect(fixture.resolveUser).toHaveBeenCalledWith(7, 42);
    expect(fixture.capabilities.assign).toHaveBeenCalledWith({
      capabilityId: "org__dinky_mcp",
      userId: 9,
      projectId: null,
    });
    expect(fixture.credentials.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "cred__dinky_mcp_9",
        userId: 9,
        secret: { token: "long-lived-dinky-token", tenantId: "7" },
      }),
    );
    expect(fixture.runtime.syncSecrets).toHaveBeenCalledWith(9, null, 9);
    expect(JSON.stringify(result)).not.toContain("long-lived-dinky-token");
  });

  it("persists a binding when the runtime is absent and reports a recoverable status", async () => {
    const fixture = createFixture();
    fixture.runtime.getStatus.mockResolvedValue(null);

    await expect(
      fixture.service.bind(
        {
          pairingId: "pairing-fixed",
          revision: 3,
          tenantId: 7,
          dataOpsUserId: 42,
          token: "long-lived-dinky-token",
        },
        "paired-secret",
      ),
    ).resolves.toEqual({
      status: "runtime_not_ready",
      pairingId: "pairing-fixed",
      revision: 3,
      errorCode: "runtime_not_ready",
    });
    expect(fixture.credentials.upsert).toHaveBeenCalled();
    expect(fixture.runtime.syncSecrets).not.toHaveBeenCalled();
  });

  it("rejects an unknown DataOps identity before writing credentials", async () => {
    const fixture = createFixture();
    fixture.resolveUser.mockResolvedValue(null);

    await expect(
      fixture.service.bind(
        {
          pairingId: "pairing-fixed",
          revision: 3,
          tenantId: 7,
          dataOpsUserId: 42,
          token: "long-lived-dinky-token",
        },
        "paired-secret",
      ),
    ).rejects.toMatchObject({ code: "dataops_user_not_found", statusCode: 404 });
    expect(fixture.credentials.upsert).not.toHaveBeenCalled();
  });

  it("propagates pairing authentication failures without writing or leaking the token", async () => {
    const fixture = createFixture();
    fixture.authenticate.mockRejectedValue(
      Object.assign(new Error("integration_secret_rejected"), {
        code: "integration_secret_rejected",
        statusCode: 401,
      }),
    );
    const error = await fixture.service
      .bind(
        {
          pairingId: "pairing-fixed",
          revision: 99,
          tenantId: 7,
          dataOpsUserId: 42,
          token: "long-lived-dinky-token",
        },
        "wrong-secret",
      )
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "integration_secret_rejected", statusCode: 401 });
    expect(String(error)).not.toContain("long-lived-dinky-token");
    expect(fixture.credentials.upsert).not.toHaveBeenCalled();
  });

  it("keeps the encrypted binding and reports sync failure for a retry", async () => {
    const fixture = createFixture();
    fixture.runtime.syncSecrets.mockRejectedValue(new Error("manager unavailable"));

    await expect(
      fixture.service.bind(
        {
          pairingId: "pairing-fixed",
          revision: 3,
          tenantId: 7,
          dataOpsUserId: 42,
          token: "long-lived-dinky-token",
        },
        "paired-secret",
      ),
    ).resolves.toEqual({
      status: "sync_failed",
      pairingId: "pairing-fixed",
      revision: 3,
      errorCode: "sync_failed",
    });
    expect(fixture.credentials.upsert).toHaveBeenCalled();
  });

  it("revokes and unassigns deterministically, then probes unbound state", async () => {
    const fixture = createFixture();
    await expect(
      fixture.service.unbind(
        { pairingId: "pairing-fixed", revision: 3, tenantId: 7, dataOpsUserId: 42 },
        "paired-secret",
      ),
    ).resolves.toEqual({ status: "unbound", pairingId: "pairing-fixed", revision: 3 });
    expect(fixture.credentials.revoke).toHaveBeenCalledWith("cred__dinky_mcp_9");
    expect(fixture.capabilities.unassign).toHaveBeenCalled();

    fixture.credentials.get.mockResolvedValue(null);
    await expect(
      fixture.service.probe(
        { pairingId: "pairing-fixed", revision: 3, tenantId: 7, dataOpsUserId: 42 },
        "paired-secret",
      ),
    ).resolves.toEqual({ status: "unbound", pairingId: "pairing-fixed", revision: 3 });
  });
});

function createFixture() {
  const authenticate = vi.fn().mockResolvedValue(undefined);
  const resolveUser = vi.fn().mockResolvedValue(9);
  const credentials = {
    get: vi.fn().mockResolvedValue({
      id: "cred__dinky_mcp_9",
      revokedAt: null,
      version: 1,
    }),
    upsert: vi.fn().mockResolvedValue({ id: "cred__dinky_mcp_9", version: 2, revokedAt: null }),
    revoke: vi.fn().mockResolvedValue({ id: "cred__dinky_mcp_9", version: 2, revokedAt: "now" }),
  };
  const capabilities = { assign: vi.fn(), unassign: vi.fn() };
  const runtime = {
    getStatus: vi.fn().mockResolvedValue({ status: "ready" }),
    syncSecrets: vi.fn().mockResolvedValue({ status: "ready" }),
  };
  return {
    authenticate,
    resolveUser,
    credentials,
    capabilities,
    runtime,
    service: createDataOpsMcpCredentialService({
      authenticate,
      resolveUser,
      credentials,
      capabilities,
      runtime,
    }),
  };
}
