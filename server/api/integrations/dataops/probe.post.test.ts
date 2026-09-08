import { describe, expect, it, vi } from "vitest";
import { probeDataOpsForEvent } from "./probe.post";
import { eventWithJson } from "./test-utils";

describe("POST /api/integrations/dataops/probe", () => {
  it("requires an accepted bearer secret and preserves probe mismatch codes", async () => {
    const probe = vi.fn().mockResolvedValue({
      pairingId: "pairing-fixed",
      revision: 1,
      gateway: "ok",
      dataOps: "dataops_probe_mismatch",
    });

    await expect(
      probeDataOpsForEvent(
        eventWithJson({ pairingId: "pairing-fixed", revision: 1 }, "Bearer shared-secret"),
        { probe },
      ),
    ).resolves.toEqual({
      pairingId: "pairing-fixed",
      revision: 1,
      gateway: "ok",
      dataOps: "dataops_probe_mismatch",
    });
    await expect(
      probeDataOpsForEvent(eventWithJson({ pairingId: "pairing-fixed", revision: 1 }), { probe }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
