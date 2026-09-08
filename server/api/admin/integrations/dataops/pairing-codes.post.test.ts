import { describe, expect, it, vi } from "vitest";
import { createDataOpsPairingCodeForEvent } from "./pairing-codes.post";
import { dataOpsAdmin, eventForUser, localAdmin } from "../../../integrations/dataops/test-utils";

describe("POST /api/admin/integrations/dataops/pairing-codes", () => {
  it("issues one code only to a standalone local administrator", async () => {
    const createPairingCode = vi.fn().mockResolvedValue({
      pairingCode: "private-once-code",
      expiresAt: "2026-09-08T00:10:00.000Z",
    });

    await expect(
      createDataOpsPairingCodeForEvent(eventForUser(localAdmin), { createPairingCode }),
    ).resolves.toEqual({
      pairingCode: "private-once-code",
      expiresAt: "2026-09-08T00:10:00.000Z",
    });
    expect(createPairingCode).toHaveBeenCalledWith(1);
    await expect(
      createDataOpsPairingCodeForEvent(eventForUser(dataOpsAdmin), { createPairingCode }),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
