import { describe, expect, it, vi } from "vitest";
import { revokeDataOpsPairingCodesForEvent } from "./pairing-codes.delete";
import { eventForUser, localAdmin } from "../../../integrations/dataops/test-utils";

describe("DELETE /api/admin/integrations/dataops/pairing-codes", () => {
  it("revokes the active pairing code for a local administrator", async () => {
    const revokePairingCodes = vi.fn().mockResolvedValue({ revoked: 1 });

    await expect(
      revokeDataOpsPairingCodesForEvent(eventForUser(localAdmin), { revokePairingCodes }),
    ).resolves.toEqual({
      revoked: 1,
    });
    expect(revokePairingCodes).toHaveBeenCalledOnce();
  });
});
