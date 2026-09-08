import { describe, expect, it, vi } from "vitest";
import { pairDataOpsForEvent } from "./pair.post";
import { eventWithJson } from "./test-utils";

describe("POST /api/integrations/dataops/pair", () => {
  it("accepts only the strict pairing DTO and never returns the shared secret", async () => {
    const pair = vi
      .fn()
      .mockResolvedValue({ pairingId: "pairing-fixed", revision: 1, status: "pending" });
    const sharedSecret = "fixture-shared-secret-with-at-least-32-bytes";

    await expect(
      pairDataOpsForEvent(
        eventWithJson({
          pairingCode: "once-code",
          pairingId: "pairing-fixed",
          dataOpsBaseUrl: "https://dinky.example.test",
          sharedSecret,
          revision: 1,
        }),
        { pair },
      ),
    ).resolves.toEqual({ pairingId: "pairing-fixed", revision: 1, status: "pending" });
    expect(pair).toHaveBeenCalledOnce();
    await expect(
      pairDataOpsForEvent(eventWithJson({ pairingCode: "once-code" }), { pair }),
    ).rejects.toBeTruthy();
  });
});
