import { describe, expect, it } from "vitest";
import { getDataOpsIntegrationStatusForEvent } from "./index.get";
import { dataOpsAdmin, eventForUser, localAdmin } from "../../../integrations/dataops/test-utils";

describe("GET /api/admin/integrations/dataops", () => {
  it("requires a standalone local administrator and returns redacted status", async () => {
    const service = {
      status: async () => ({
        pairingCode: {
          expiresAt: "2026-09-08T00:10:00.000Z",
          createdAt: "2026-09-08T00:00:00.000Z",
        },
        active: { pairingId: "pairing-fixed", revision: 1, status: "active" },
      }),
    };

    const status = await getDataOpsIntegrationStatusForEvent(eventForUser(localAdmin), service);
    expect(status.active).toEqual({ pairingId: "pairing-fixed", revision: 1, status: "active" });
    expect(Object.hasOwn(status.active ?? {}, "sharedSecret")).toBe(false);
    await expect(
      getDataOpsIntegrationStatusForEvent(eventForUser(dataOpsAdmin), service),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
