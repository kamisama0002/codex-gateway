import { describe, expect, it } from "vitest";
import {
  MANAGED_RUNTIME_HOST_ID,
  MANAGED_RUNTIME_PROJECT_ID,
} from "~~/shared/runtime/managed-runtime";
import { parseGatewayConfig } from "./config";

describe("parseGatewayConfig", () => {
  it("defaults and normalizes pet settings for stored legacy configs", () => {
    const config = parseGatewayConfig({ version: 1 });
    expect(config.pet).toEqual({ enabled: true, petId: "codex", animations: true });
  });

  it("keeps explicit pet settings", () => {
    const config = parseGatewayConfig({
      version: 1,
      pet: { enabled: false, petId: "  dewey  ", animations: false },
    });
    expect(config.pet).toEqual({ enabled: false, petId: "dewey", animations: false });
  });

  it("rejects unknown pet ids", () => {
    expect(() =>
      parseGatewayConfig({
        version: 1,
        pet: { enabled: true, petId: "unknown-pet", animations: true },
      }),
    ).toThrow(/Invalid option/);
  });

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
