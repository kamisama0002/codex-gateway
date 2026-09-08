import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createDataOpsPairingService } from "./dataops-pairing-service";

describe("DataOpsPairingService", () => {
  it("creates a one-time code while storing only its hash", async () => {
    const fixture = createFixture();
    const result = await fixture.service.createPairingCode(7);

    expect(result.pairingCode).toBeTruthy();
    expect(result.expiresAt).toBe("2026-09-08T00:10:00.000Z");
    expect(fixture.codes.create).toHaveBeenCalledWith({
      actorUserId: 7,
      codeHash: createHash("sha256").update(result.pairingCode).digest("hex"),
      expiresAt: "2026-09-08T00:10:00.000Z",
      now: "2026-09-08T00:00:00.000Z",
    });
    expect(JSON.stringify(fixture.codes.create.mock.calls)).not.toContain(result.pairingCode);
  });

  it("consumes the code and stages a pending integration", async () => {
    const fixture = createFixture();
    fixture.codes.consume.mockResolvedValue(true);
    fixture.integrations.stage.mockResolvedValue({
      pairingId: "pairing-fixed",
      revision: 1,
      status: "pending",
    });

    await expect(
      fixture.service.pair({
        pairingCode: "one-time-code",
        pairingId: "pairing-fixed",
        dataOpsBaseUrl: "https://dinky.example.test/",
        sharedSecret: "fixture-shared-secret-with-at-least-32-bytes",
        revision: 1,
      }),
    ).resolves.toEqual({ pairingId: "pairing-fixed", revision: 1, status: "pending" });

    expect(fixture.codes.consume).toHaveBeenCalledWith(
      createHash("sha256").update("one-time-code").digest("hex"),
      "pairing-fixed",
      "2026-09-08T00:00:00.000Z",
    );
    expect(fixture.integrations.stage).toHaveBeenCalledWith(
      expect.objectContaining({
        pairingId: "pairing-fixed",
        dataOpsBaseUrl: "https://dinky.example.test",
        revision: 1,
      }),
    );
  });

  it("rejects confirmation when the bearer secret does not match pending state", async () => {
    const fixture = createFixture();
    fixture.integrations.pending.mockResolvedValue({
      pairingId: "pairing-fixed",
      revision: 1,
      status: "pending",
      sharedSecret: "fixture-shared-secret-with-at-least-32-bytes",
    });

    await expect(
      fixture.service.confirm("pairing-fixed", 1, "wrong-secret-with-at-least-32-bytes"),
    ).rejects.toThrow("integration_secret_rejected");
    expect(fixture.integrations.confirm).not.toHaveBeenCalled();
  });

  it("rejects expired or reused codes without staging an integration", async () => {
    const fixture = createFixture();
    fixture.codes.consume.mockResolvedValue(false);

    await expect(
      fixture.service.pair({
        pairingCode: "expired-code",
        pairingId: "pairing-fixed",
        dataOpsBaseUrl: "https://dinky.example.test",
        sharedSecret: "fixture-shared-secret-with-at-least-32-bytes",
        revision: 1,
      }),
    ).rejects.toThrow("pairing_code_rejected");
    expect(fixture.integrations.stage).not.toHaveBeenCalled();
  });

  it("rejects invalid DataOps URLs before consuming a code", async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.pair({
        pairingCode: "one-time-code",
        pairingId: "pairing-fixed",
        dataOpsBaseUrl: "https://user:password@dinky.example.test",
        sharedSecret: "fixture-shared-secret-with-at-least-32-bytes",
        revision: 1,
      }),
    ).rejects.toThrow("dataops_base_url_invalid");
    expect(fixture.codes.consume).not.toHaveBeenCalled();
  });

  it("keeps confirmation idempotent after the pending binding becomes active", async () => {
    const fixture = createFixture();
    fixture.integrations.pending.mockResolvedValue(null);
    fixture.integrations.active.mockResolvedValue(binding({ status: "active" }));

    await expect(
      fixture.service.confirm("pairing-fixed", 1, "fixture-shared-secret-with-at-least-32-bytes"),
    ).resolves.toEqual({ pairingId: "pairing-fixed", revision: 1, status: "active" });
    expect(fixture.integrations.confirm).not.toHaveBeenCalled();
    expect(fixture.ensureMcp).toHaveBeenCalledWith(
      expect.objectContaining({ pairingId: "pairing-fixed" }),
    );
  });

  it("rejects pending bindings for authenticated protocol actions", async () => {
    const fixture = createFixture();
    fixture.integrations.acceptedForAuthentication.mockResolvedValue([]);

    await expect(
      fixture.service.probe("pairing-fixed", 1, "fixture-shared-secret-with-at-least-32-bytes"),
    ).rejects.toThrow("integration_secret_rejected");
  });

  it("finalizes the active binding while a grace binding exists", async () => {
    const fixture = createFixture();
    fixture.integrations.acceptedForAuthentication.mockResolvedValue([
      binding({ status: "grace", pairingId: "pairing-grace", revision: 1 }),
      binding({ status: "active", pairingId: "pairing-fixed", revision: 2 }),
    ]);
    fixture.integrations.active.mockResolvedValue(
      binding({ status: "active", pairingId: "pairing-fixed", revision: 2 }),
    );
    fixture.integrations.finalize.mockResolvedValue(binding({ status: "active", revision: 2 }));

    await expect(
      fixture.service.finalize("pairing-fixed", 2, "fixture-shared-secret-with-at-least-32-bytes"),
    ).resolves.toEqual({ pairingId: "pairing-fixed", revision: 2, status: "active" });
    expect(fixture.integrations.finalize).toHaveBeenCalledWith("pairing-fixed", 2);
    expect(fixture.publish).toHaveBeenCalledWith({ revision: 2, pairingId: "pairing-fixed" });
  });

  it("publishes after a successful confirmation without exposing a secret", async () => {
    const fixture = createFixture();
    fixture.integrations.pending.mockResolvedValue(binding({ status: "pending", revision: 3 }));
    fixture.integrations.confirm.mockResolvedValue(binding({ status: "active", revision: 3 }));

    await fixture.service.confirm(
      "pairing-fixed",
      3,
      "fixture-shared-secret-with-at-least-32-bytes",
    );
    expect(fixture.publish).toHaveBeenCalledWith({ revision: 3, pairingId: "pairing-fixed" });
    expect(JSON.stringify(fixture.publish.mock.calls)).not.toContain(
      "fixture-shared-secret-with-at-least-32-bytes",
    );
  });

  it("rejects an unexpired grace secret during finalization", async () => {
    const fixture = createFixture();
    fixture.integrations.acceptedForAuthentication.mockResolvedValue([
      binding({
        pairingId: "pairing-previous",
        revision: 1,
        status: "grace",
        sharedSecret: "previous-shared-secret-with-at-least-32-bytes",
      }),
      binding({ pairingId: "pairing-fixed", revision: 2, status: "active" }),
    ]);
    fixture.integrations.active.mockResolvedValue(
      binding({ pairingId: "pairing-fixed", revision: 2, status: "active" }),
    );
    fixture.integrations.finalize.mockResolvedValue(binding({ status: "active" }));

    await expect(
      fixture.service.finalize(
        "pairing-previous",
        1,
        "previous-shared-secret-with-at-least-32-bytes",
      ),
    ).rejects.toThrow("integration_secret_rejected");
    expect(fixture.integrations.finalize).not.toHaveBeenCalled();
  });

  it("returns a rate-limit error without revealing submitted secrets", async () => {
    const fixture = createFixture({ rateLimit: () => false });
    const sharedSecret = "fixture-shared-secret-with-at-least-32-bytes";

    const error = await fixture.service
      .pair({
        pairingCode: "one-time-code",
        pairingId: "pairing-fixed",
        dataOpsBaseUrl: "https://dinky.example.test",
        sharedSecret,
        revision: 1,
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ statusCode: 429, code: "dataops_pair_rate_limited" });
    expect(String(error)).not.toContain(sharedSecret);
    expect(fixture.codes.consume).not.toHaveBeenCalled();
  });

  it("reports a probe identity mismatch without exposing the shared secret", async () => {
    const fixture = createFixture({
      fetch: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ pairingId: "different-pairing", revision: 1, gateway: "ok" }),
          {
            status: 200,
          },
        ),
      ),
    });
    fixture.integrations.acceptedForAuthentication.mockResolvedValue([
      binding({ status: "grace" }),
    ]);

    const result = await fixture.service.probe(
      "pairing-fixed",
      1,
      "fixture-shared-secret-with-at-least-32-bytes",
    );

    expect(result).toEqual({
      pairingId: "pairing-fixed",
      revision: 1,
      gateway: "ok",
      dataOps: "dataops_probe_mismatch",
    });
    expect(JSON.stringify(result)).not.toContain("fixture-shared-secret-with-at-least-32-bytes");
  });
});

function createFixture(
  options: { rateLimit?: () => boolean; fetch?: typeof globalThis.fetch } = {},
) {
  const integrations = {
    active: vi.fn(),
    acceptedForAuthentication: vi.fn(),
    pending: vi.fn(),
    stage: vi.fn(),
    confirm: vi.fn(),
    finalize: vi.fn(),
  };
  const codes = {
    create: vi.fn(),
    consume: vi.fn(),
    revokeActive: vi.fn(),
    activeStatus: vi.fn(),
  };
  const publish = vi.fn();
  const ensureMcp = vi.fn();
  return {
    integrations,
    codes,
    publish,
    ensureMcp,
    service: createDataOpsPairingService({
      integrations,
      codes,
      now: () => new Date("2026-09-08T00:00:00.000Z"),
      randomBytes: () => Buffer.alloc(24, 7),
      fetch: options.fetch ?? vi.fn(),
      rateLimit: options.rateLimit,
      publish,
      ensureMcp,
    }),
  };
}

function binding(overrides: Record<string, unknown> = {}) {
  return {
    pairingId: "pairing-fixed",
    dataOpsBaseUrl: "https://dinky.example.test",
    sharedSecret: "fixture-shared-secret-with-at-least-32-bytes",
    status: "active",
    revision: 1,
    graceExpiresAt: null,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    ...overrides,
  };
}
