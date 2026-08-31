import { describe, expect, it } from "vitest";
import { MANAGED_RUNTIME_HOST_ID } from "../../storage/migrations";
import { parseGatewayConfig } from "./config";

describe("parseGatewayConfig", () => {
  it("rejects the managed runtime host ID from configured SSH hosts", () => {
    expect(() =>
      parseGatewayConfig({
        version: 1,
        hosts: [
          {
            id: MANAGED_RUNTIME_HOST_ID,
            name: "Reserved runtime",
            sshHost: "example.test",
            authMode: "agent",
          },
        ],
        projects: [],
        pinnedThreads: [],
        notifications: { bark: { enabled: false, serverUrl: "https://api.day.app", deviceKey: "", group: "Codex Gateway" } },
      }),
    ).toThrow(/reserved/i);
  });
});
