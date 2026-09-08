import { describe, expect, it, vi } from "vitest";
import { putDataOpsMcpCredentialForEvent } from "./mcp-credentials.put";
import { eventWithJson } from "./test-utils";

describe("PUT /api/integrations/dataops/mcp-credentials", () => {
  it("passes only the strict Dinky identity payload and paired bearer secret", async () => {
    const bind = vi.fn().mockResolvedValue({ status: "ready" });
    const payload = {
      pairingId: "pairing-fixed",
      revision: 3,
      tenantId: 7,
      dataOpsUserId: 42,
      token: "long-lived-dinky-token",
    };
    await expect(
      putDataOpsMcpCredentialForEvent(eventWithJson(payload, "Bearer paired-secret"), { bind }),
    ).resolves.toEqual({ status: "ready" });
    expect(bind).toHaveBeenCalledWith(payload, "paired-secret");
    await expect(
      putDataOpsMcpCredentialForEvent(
        eventWithJson({ ...payload, gatewayUserId: 99 }, "Bearer paired-secret"),
        { bind },
      ),
    ).rejects.toBeDefined();
  });
});
