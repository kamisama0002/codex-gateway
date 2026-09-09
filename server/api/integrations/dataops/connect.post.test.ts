import { describe, expect, it, vi } from "vitest";
import { connectDataOpsForEvent } from "./connect.post";
import { eventWithJson } from "./test-utils";

describe("POST /api/integrations/dataops/connect", () => {
  it("forwards the bearer service token and DataOps URL to the connector", async () => {
    const connect = vi
      .fn()
      .mockResolvedValue({ pairingId: "direct-pairing", revision: 2, status: "active" });

    await expect(
      connectDataOpsForEvent(
        eventWithJson(
          { dataOpsBaseUrl: "https://dataops.example.test/" },
          "Bearer service-token-with-at-least-32-characters",
        ),
        { connect },
      ),
    ).resolves.toEqual({ pairingId: "direct-pairing", revision: 2, status: "active" });
    expect(connect).toHaveBeenCalledWith(
      { dataOpsBaseUrl: "https://dataops.example.test/" },
      "service-token-with-at-least-32-characters",
    );
  });

  it("rejects requests without a bearer token before contacting the connector", async () => {
    const connect = vi.fn();

    await expect(
      connectDataOpsForEvent(eventWithJson({ dataOpsBaseUrl: "https://dataops.example.test" }), {
        connect,
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(connect).not.toHaveBeenCalled();
  });
});
