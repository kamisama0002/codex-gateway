import { describe, expect, it, vi } from "vitest";
import { deleteDataOpsMcpCredentialForEvent } from "./mcp-credentials.delete";
import { eventWithJson } from "./test-utils";

describe("DELETE /api/integrations/dataops/mcp-credentials", () => {
  it("requires the paired bearer secret and has no Gateway user override", async () => {
    const unbind = vi.fn().mockResolvedValue({ status: "unbound" });
    const payload = { pairingId: "pairing-fixed", revision: 3, tenantId: 7, dataOpsUserId: 42 };
    await expect(
      deleteDataOpsMcpCredentialForEvent(eventWithJson(payload, "Bearer paired-secret"), {
        unbind,
      }),
    ).resolves.toEqual({ status: "unbound" });
    expect(unbind).toHaveBeenCalledWith(payload, "paired-secret");
    await expect(
      deleteDataOpsMcpCredentialForEvent(eventWithJson(payload), { unbind }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
