import { describe, expect, it, vi } from "vitest";
import { DataOpsSsoError } from "../auth/dataops-client";
import { createDataOpsIntegrationProvider } from "./dataops-integration-provider";

describe("DataOpsIntegrationProvider", () => {
  it("loads active bindings from MySQL without reading DataOps environment variables", async () => {
    const acceptedForAuthentication = vi.fn().mockResolvedValue([binding()]);
    const provider = createDataOpsIntegrationProvider({
      integrations: { acceptedForAuthentication },
      now: () => new Date("2026-09-08T00:00:00.000Z"),
      createClient: vi.fn().mockReturnValue({ exchange: vi.fn() }),
    });

    await expect(provider.current()).resolves.toMatchObject({ pairingId: "pairing-active", revision: 2 });
    expect(acceptedForAuthentication).toHaveBeenCalledWith("2026-09-08T00:00:00.000Z");
  });

  it("returns null while only pending bindings exist", async () => {
    const provider = createDataOpsIntegrationProvider({
      integrations: { acceptedForAuthentication: vi.fn().mockResolvedValue([]) },
      now: () => new Date("2026-09-08T00:00:00.000Z"),
    });

    await expect(provider.current()).resolves.toBeNull();
  });

  it("accepts an unexpired grace secret when the active secret is rejected", async () => {
    const active = { exchange: vi.fn().mockRejectedValue(new DataOpsSsoError("dataops_ticket_rejected")) };
    const grace = { exchange: vi.fn().mockResolvedValue({ subject: "accepted" }) };
    const createClient = vi.fn().mockReturnValueOnce(active).mockReturnValueOnce(grace);
    const provider = createDataOpsIntegrationProvider({
      integrations: { acceptedForAuthentication: vi.fn().mockResolvedValue([binding(), binding({ pairingId: "pairing-grace", revision: 1, status: "grace" })]) },
      now: () => new Date("2026-09-08T00:00:00.000Z"),
      createClient,
    });

    const current = await provider.current();
    await expect(current?.client.exchange("ticket")).resolves.toEqual({ subject: "accepted" });
    expect(active.exchange).toHaveBeenCalledWith("ticket");
    expect(grace.exchange).toHaveBeenCalledWith("ticket");
  });

  it("refreshes immediately after invalidation and self-heals after five seconds", async () => {
    let now = new Date("2026-09-08T00:00:00.000Z");
    const acceptedForAuthentication = vi.fn().mockResolvedValueOnce([binding({ revision: 1 })]).mockResolvedValueOnce([binding({ revision: 2 })]).mockResolvedValueOnce([binding({ revision: 3 })]);
    const provider = createDataOpsIntegrationProvider({ integrations: { acceptedForAuthentication }, now: () => now });

    await expect(provider.current()).resolves.toMatchObject({ revision: 1 });
    provider.invalidate(2);
    await expect(provider.current()).resolves.toMatchObject({ revision: 2 });
    now = new Date("2026-09-08T00:00:05.000Z");
    await expect(provider.current()).resolves.toMatchObject({ revision: 3 });
  });
});

function binding(overrides: Record<string, unknown> = {}) {
  return {
    pairingId: "pairing-active",
    dataOpsBaseUrl: "https://dinky.example.test",
    sharedSecret: "fixture-shared-secret-with-at-least-32-bytes",
    status: "active",
    revision: 2,
    graceExpiresAt: null,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    ...overrides,
  };
}
