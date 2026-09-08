import { describe, expect, it } from "vitest";
import {
  clearExpiredPairingCode,
  clearPairingCode,
  platformIntegrationView,
  platformIntegrationAccess,
  remainingPairingCodeSeconds,
} from "./platform-integration-state";

describe("platform integration state", () => {
  it("keeps pairing codes once and clears them on expiry", () => {
    const view = {
      status: "unpaired" as const,
      pairingCode: "once",
      expiresAt: "2026-09-08T00:00:10.000Z",
    };
    expect(
      remainingPairingCodeSeconds(view.expiresAt, Date.parse("2026-09-08T00:00:00.000Z")),
    ).toBe(10);
    expect(clearExpiredPairingCode(view, Date.parse("2026-09-08T00:00:11.000Z"))).toMatchObject({
      pairingCode: null,
      expiresAt: null,
    });
    expect(clearPairingCode(view)).toMatchObject({ pairingCode: null, expiresAt: null });
  });

  it("limits management to local admins and hides ordinary users", () => {
    expect(platformIntegrationAccess({ role: "admin" })).toBe("manage");
    expect(platformIntegrationAccess({ role: "admin", dataOps: {} })).toBe("read");
    expect(platformIntegrationAccess({ role: "user" })).toBe("hidden");
  });

  it("maps the exact integration status API shapes without inventing a status field", () => {
    expect(
      platformIntegrationView({ pairingCode: null, active: null }, null, Date.now()).status,
    ).toBe("unpaired");
    expect(
      platformIntegrationView(
        { pairingCode: { expiresAt: "2026-09-08T00:00:10.000Z" }, active: null },
        null,
        Date.parse("2026-09-08T00:00:00.000Z"),
      ).status,
    ).toBe("pending");
    expect(
      platformIntegrationView(
        {
          pairingCode: null,
          active: { pairingId: "pairing-fixed", revision: 1, status: "active" },
        },
        null,
        Date.now(),
      ).status,
    ).toBe("active");
    expect(platformIntegrationView(null, "dataops_unavailable", Date.now()).status).toBe(
      "degraded",
    );
  });

  it("stays pending after generated plaintext is cleared when refreshed code metadata remains", () => {
    const refreshed = {
      pairingCode: { expiresAt: "2026-09-08T00:00:10.000Z" },
      active: null,
    };
    const localAfterClose = clearPairingCode({
      status: "pending" as const,
      pairingCode: "plaintext-once-code",
      expiresAt: refreshed.pairingCode.expiresAt,
    });

    expect(localAfterClose.pairingCode).toBeNull();
    expect(
      platformIntegrationView(refreshed, null, Date.parse("2026-09-08T00:00:00.000Z")).status,
    ).toBe("pending");
  });
});
