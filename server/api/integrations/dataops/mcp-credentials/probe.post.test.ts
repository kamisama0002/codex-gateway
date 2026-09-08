import { describe, expect, it, vi } from "vitest";
import { probeDataOpsMcpCredentialForEvent } from "./probe.post";
import { eventWithJson } from "../test-utils";

describe("POST /api/integrations/dataops/mcp-credentials/probe", () => {
  it("returns only the public synchronization status", async () => {
    const probe = vi.fn().mockResolvedValue({
      status: "runtime_not_ready",
      pairingId: "pairing-fixed",
      revision: 3,
      errorCode: "runtime_not_ready",
    });
    const payload = { pairingId: "pairing-fixed", revision: 3, tenantId: 7, dataOpsUserId: 42 };
    const result = await probeDataOpsMcpCredentialForEvent(
      eventWithJson(payload, "Bearer paired-secret"),
      { probe },
    );
    expect(result).toEqual(expect.objectContaining({ status: "runtime_not_ready" }));
    expect(JSON.stringify(result)).not.toContain("paired-secret");
  });
});
