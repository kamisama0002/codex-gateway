import { describe, expect, it, vi } from "vitest";
import { confirmDataOpsPairingForEvent } from "./confirm.post";
import { eventWithJson } from "../../test-utils";

describe("POST /api/integrations/dataops/pair/:pairingId/confirm", () => {
  it("requires a bearer secret and a strict revision body", async () => {
    const confirm = vi
      .fn()
      .mockResolvedValue({ pairingId: "pairing-fixed", revision: 1, status: "active" });

    await expect(
      confirmDataOpsPairingForEvent(
        eventWithJson({ revision: 1 }, "Bearer new-shared-secret"),
        "pairing-fixed",
        { confirm },
      ),
    ).resolves.toEqual({ pairingId: "pairing-fixed", revision: 1, status: "active" });
    await expect(
      confirmDataOpsPairingForEvent(eventWithJson({ revision: 1 }), "pairing-fixed", { confirm }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
