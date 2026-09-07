import { describe, expect, it, vi } from "vitest";
import type { HostRecord } from "~~/shared/types";
import {
  parseAppsInstalledResponse,
  parseAppsListResponse,
  parseCapabilityConfigReadResponse,
  parseCapabilityMcpServerStatusPage,
  parsePluginListResponse,
  parseSkillsListResponse,
} from "~~/shared/runtime/app-server/capabilities";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import { CodexRpcClient } from "../infra/rpc/rpc";
import {
  AppServerCapabilityService,
  type AppServerCapabilityControllerRegistry,
} from "./app-server-capabilities";

const managedHost = {
  id: MANAGED_RUNTIME_HOST_ID,
  connectionKind: "managed",
  name: "Local",
  sshHost: "localhost",
  username: null,
  port: null,
  authMode: "agent",
  privateKeyPath: null,
  privateKey: null,
  password: null,
  proxyUrl: null,
  hasPassword: false,
  createdAt: "",
  updatedAt: "",
} satisfies HostRecord;

describe("Codex 0.153.4 capability protocol parsers", () => {
  it("parses the exact capability response shapes", () => {
    expect(
      parseSkillsListResponse({
        data: [
          {
            cwd: "/workspace",
            skills: [
              {
                name: "org__revenue",
                description: "Analyze revenue",
                path: "/codex-home/skills/org__revenue/1/SKILL.md",
                scope: "user",
                enabled: true,
              },
            ],
            errors: [],
          },
        ],
      }),
    ).toMatchObject({ data: [{ skills: [{ name: "org__revenue" }] }] });
    expect(
      parsePluginListResponse({
        marketplaces: [
          {
            name: "org__catalog",
            path: "/codex-home/plugins/marketplaces/org__catalog/marketplace.json",
            plugins: [
              {
                id: "org__crm@org__catalog",
                name: "org__crm",
                source: { type: "local", path: "/codex-home/plugins/org__crm" },
                installed: true,
                enabled: true,
                installPolicy: "AVAILABLE",
                authPolicy: "ON_USE",
              },
            ],
          },
        ],
        marketplaceLoadErrors: [],
        featuredPluginIds: [],
      }),
    ).toMatchObject({ marketplaces: [{ plugins: [{ installed: true }] }] });
    expect(
      parseAppsListResponse({
        data: [{ id: "org__crm_app", name: "CRM", isAccessible: true, isEnabled: true }],
        nextCursor: null,
      }),
    ).toMatchObject({ data: [{ id: "org__crm_app" }] });
    expect(
      parseAppsInstalledResponse({
        apps: [{ id: "org__crm_app", runtimeName: "CRM", enabled: true, callable: true }],
      }),
    ).toMatchObject({ apps: [{ callable: true }] });
    expect(
      parseCapabilityMcpServerStatusPage({
        data: [
          {
            name: "org__business",
            runtimeStatus: "connected",
            pluginId: null,
            serverInfo: null,
            tools: {},
            resources: [],
            resourceTemplates: [],
            authStatus: "unsupported",
          },
        ],
        nextCursor: null,
      }),
    ).toMatchObject({ data: [{ name: "org__business" }] });
    expect(
      parseCapabilityConfigReadResponse({
        config: { mcp_servers: { org__business: { url: "https://mcp.example.test" } } },
        origins: {},
        layers: null,
      }),
    ).toEqual({
      config: { mcp_servers: { org__business: { url: "https://mcp.example.test" } } },
      origins: {},
      layers: null,
    });
  });

  it("rejects unknown fields instead of accepting a drifted protocol", () => {
    expect(() => parseSkillsListResponse({ data: [], unexpected: true })).toThrow();
    expect(() =>
      parseAppsInstalledResponse({
        apps: [{ id: "org__crm_app", enabled: true, callable: true, unexpected: true }],
      }),
    ).toThrow();
  });
});

describe("AppServerCapabilityService RPC mapping", () => {
  it("maps reads to the exact App Server methods and parameters", async () => {
    const { service, request } = serviceWithResponses({
      "skills/list": { data: [] },
      "plugin/list": { marketplaces: [], marketplaceLoadErrors: [], featuredPluginIds: [] },
      "app/list": { data: [], nextCursor: null },
      "app/installed": { apps: [] },
      "mcpServerStatus/list": { data: [], nextCursor: null },
      "config/read": { config: {}, origins: {}, layers: null },
    });

    await service.listSkills(managedHost, "/workspace", true);
    await service.listPlugins(managedHost, "/workspace", false);
    await service.listApps(managedHost, null, null, false);
    await service.listInstalledApps(managedHost, null, false);
    await service.listMcpServers(managedHost, null, null);
    await service.readConfig(managedHost, "/workspace");

    expect(request.mock.calls.map(([method, params]) => [method, params])).toEqual([
      ["skills/list", { cwds: ["/workspace"], forceReload: true }],
      ["plugin/list", { cwds: ["/workspace"], forceRefetch: false }],
      ["app/list", { cursor: null, limit: 100, threadId: null, forceRefetch: false }],
      ["app/installed", { threadId: null, forceRefresh: false }],
      [
        "mcpServerStatus/list",
        { cursor: null, limit: 100, detail: "toolsAndAuthOnly", threadId: null },
      ],
      ["config/read", { cwd: "/workspace", includeLayers: false }],
    ]);
  });

  it("maps mutations without invoking a shell command", async () => {
    const { service, request } = serviceWithResponses({
      "fs/createDirectory": {},
      "fs/writeFile": {},
      "fs/remove": {},
      "skills/config/write": { effectiveEnabled: true },
      "skills/extraRoots/set": {},
      "marketplace/add": {
        marketplaceName: "org__catalog",
        installedRoot: "/codex-home/plugins/marketplaces/org__catalog",
        alreadyAdded: false,
      },
      "plugin/install": { authPolicy: "ON_USE", appsNeedingAuth: [] },
      "plugin/uninstall": {},
      "marketplace/upgrade": {
        selectedMarketplaces: ["org__catalog"],
        upgradedRoots: ["/codex-home/plugins/marketplaces/org__catalog"],
        errors: [],
      },
      "marketplace/remove": {
        marketplaceName: "org__old_catalog",
        installedRoot: "/codex-home/plugins/marketplaces/org__old_catalog",
      },
      "config/value/write": {
        filePath: "/codex-home/config.toml",
        status: "ok",
        version: "2",
        overriddenMetadata: null,
      },
      "config/mcpServer/reload": {},
    });
    const skillPath = "/codex-home/skills/org__revenue/1/SKILL.md";

    await service.createDirectory(managedHost, "/codex-home/skills/org__revenue/1");
    await service.writeFile(managedHost, skillPath, Buffer.from("skill"));
    await service.removeDirectory(managedHost, "/codex-home/skills/org__old/1");
    await service.setSkillEnabled(managedHost, skillPath, true);
    await service.setExtraSkillRoots(managedHost, ["/codex-home/skills"]);
    await service.addMarketplace(managedHost, "https://git.example.test/catalog.git");
    await service.installPlugin(
      managedHost,
      "/codex-home/plugins/marketplaces/org__catalog/marketplace.json",
      "org__crm",
    );
    await service.uninstallPlugin(managedHost, "org__crm@org__catalog");
    await service.upgradeMarketplace(managedHost, "org__catalog");
    await service.removeMarketplace(managedHost, "org__old_catalog");
    await service.writeConfigValue(managedHost, 'apps."org__crm_app".enabled', true);
    await service.reloadMcpServers(managedHost);

    expect(request.mock.calls.map(([method, params]) => [method, params])).toEqual([
      ["fs/createDirectory", { path: "/codex-home/skills/org__revenue/1", recursive: true }],
      ["fs/writeFile", { path: skillPath, dataBase64: Buffer.from("skill").toString("base64") }],
      ["fs/remove", { path: "/codex-home/skills/org__old/1", recursive: true, force: true }],
      ["skills/config/write", { path: skillPath, enabled: true }],
      ["skills/extraRoots/set", { extraRoots: ["/codex-home/skills"] }],
      ["marketplace/add", { source: "https://git.example.test/catalog.git" }],
      [
        "plugin/install",
        {
          marketplacePath: "/codex-home/plugins/marketplaces/org__catalog/marketplace.json",
          pluginName: "org__crm",
        },
      ],
      ["plugin/uninstall", { pluginId: "org__crm@org__catalog" }],
      ["marketplace/upgrade", { marketplaceName: "org__catalog" }],
      ["marketplace/remove", { marketplaceName: "org__old_catalog" }],
      [
        "config/value/write",
        { keyPath: 'apps."org__crm_app".enabled', value: true, mergeStrategy: "replace" },
      ],
      ["config/mcpServer/reload", undefined],
    ]);
  });
});

function serviceWithResponses(responses: Record<string, unknown>) {
  const client = new CodexRpcClient(managedHost, { skipVersionCheck: true });
  const request = vi.spyOn(client, "request").mockImplementation(async (method: string) => {
    if (!Object.hasOwn(responses, method)) throw new Error(`Unexpected method ${method}`);
    return responses[method];
  });
  const registry = {
    getHostClient: async () => client,
  } satisfies AppServerCapabilityControllerRegistry;
  return { service: new AppServerCapabilityService(registry), request };
}
