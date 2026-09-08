import { describe, expect, it, vi } from "vitest";
import { finalizeDataOpsPairingForEvent } from "./finalize.post";
import { eventWithJson } from "../../test-utils";

describe("POST /api/integrations/dataops/pair/:pairingId/finalize", () => {
  it("requires a bearer secret and returns an idempotent active result", async () => {
    const finalize = vi
      .fn()
      .mockResolvedValue({ pairingId: "pairing-fixed", revision: 1, status: "active" });

    await expect(
      finalizeDataOpsPairingForEvent(
        eventWithJson({ revision: 1 }, "Bearer new-shared-secret"),
        "pairing-fixed",
        { finalize },
      ),
    ).resolves.toEqual({ pairingId: "pairing-fixed", revision: 1, status: "active" });
    expect(finalize).toHaveBeenCalledWith("pairing-fixed", 1, "new-shared-secret");
  });
});
