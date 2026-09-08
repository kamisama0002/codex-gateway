import { describe, expect, it } from "vitest";
import {
  clearExpiredPairingCode,
  clearPairingCode,
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
});
