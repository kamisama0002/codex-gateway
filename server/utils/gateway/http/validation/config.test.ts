import { describe, expect, it } from "vitest";
import {
  MANAGED_RUNTIME_HOST_ID,
  MANAGED_RUNTIME_PROJECT_ID,
} from "~~/shared/runtime/managed-runtime";
import { parseGatewayConfig } from "./config";

describe("parseGatewayConfig", () => {
  it("strips the reserved local Agent host instead of storing it as SSH config", () => {
    const config = parseGatewayConfig({
      version: 1,
      hosts: [
        {
          id: MANAGED_RUNTIME_HOST_ID,
          name: "Reserved runtime",
          sshHost: "example.test",
          authMode: "agent",
        },
        {
          id: 1,
          name: "centos10",
          sshHost: "192.168.48.110",
          authMode: "password",
          password: "secret",
          proxyUrl: null,
        },
      ],
      projects: [
        {
          id: MANAGED_RUNTIME_PROJECT_ID,
          hostId: MANAGED_RUNTIME_HOST_ID,
          name: "workspace",
          remotePath: "/workspace",
        },
      ],
      pinnedThreads: [],
      notifications: {
        bark: {
          enabled: false,
          serverUrl: "https://api.day.app",
          deviceKey: "",
          group: "Codex Gateway",
        },
      },
    });
    expect(config.hosts).toEqual([
      expect.objectContaining({ id: 1, name: "centos10", sshHost: "192.168.48.110" }),
    ]);
    expect(config.projects).toEqual([]);
  });
});
