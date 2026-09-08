import { describe, expect, it, vi } from "vitest";
import type { CapabilityDefinition, HostRecord } from "~~/shared/types";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import { CodexRpcError } from "../http/errors";
import {
  CodexCapabilityAdapter,
  type CodexCapabilityRuntime,
  emptyActualCapabilityState,
  planChanges,
} from "./codex-adapter";

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

describe("planChanges", () => {
  it("produces a deterministic plan for missing capabilities", () => {
    const desired = [
      definition("org__revenue", "skill", { entryPath: "SKILL.md" }),
      definition("org__crm", "plugin", {
        marketplaceName: "org__catalog",
        marketplaceUrl: "https://git.example.test/catalog.git",
        pluginName: "org__crm",
      }),
      definition("org__crm_app", "app", { appId: "org__crm_app" }),
      definition("org__business", "mcp", {
        transport: "streamable_http",
        url: "https://mcp.example.test",
      }),
    ];

    expect(planChanges(desired, emptyActualCapabilityState())).toEqual([
      {
        operation: "configureMcp",
        capabilityId: "org__business",
        config: { url: "https://mcp.example.test" },
      },
      {
        operation: "installPlugin",
        capabilityId: "org__crm",
        marketplaceName: "org__catalog",
        marketplaceUrl: "https://git.example.test/catalog.git",
        marketplacePath: null,
        pluginName: "org__crm",
      },
      {
        operation: "setAppEnabled",
        capabilityId: "org__crm_app",
        appId: "org__crm_app",
        enabled: true,
      },
      {
        operation: "installSkill",
        capabilityId: "org__revenue",
        source: { type: "internal", locator: "/data/capabilities/org__revenue/1" },
        version: "1",
        targetDirectory: "/codex-home/skills/org__revenue/1",
        targetPath: "/codex-home/skills/org__revenue/1/SKILL.md",
      },
    ]);
  });

  it("returns an empty plan when desired and actual state already match", () => {
    const desired = [
      definition("org__revenue", "skill", { entryPath: "SKILL.md" }),
      definition("org__crm", "plugin", {
        marketplaceName: "org__catalog",
        marketplaceUrl: "https://git.example.test/catalog.git",
        pluginName: "org__crm",
      }),
      definition("org__crm_app", "app", { appId: "org__crm_app" }),
      definition("org__business", "mcp", {
        transport: "streamable_http",
        url: "https://mcp.example.test",
      }),
    ];
    const actual = {
      skills: [
        {
          capabilityId: "org__revenue",
          name: "org__revenue",
          path: "/codex-home/skills/org__revenue/1/SKILL.md",
          enabled: true,
        },
      ],
      marketplaces: [
        {
          name: "org__catalog",
          path: "/codex-home/plugins/marketplaces/org__catalog/marketplace.json",
        },
      ],
      plugins: [
        {
          id: "org__crm@org__catalog",
          name: "org__crm",
          marketplaceName: "org__catalog",
          installed: true,
          enabled: true,
          version: "1",
        },
      ],
      apps: [{ id: "org__crm_app", enabled: true, callable: true }],
      mcpServers: [
        {
          name: "org__business",
          config: { url: "https://mcp.example.test" },
          runtimeStatus: "connected" as const,
          authStatus: "unsupported" as const,
        },
      ],
    };

    expect(planChanges(desired, actual)).toEqual([]);
    expect(planChanges([...desired].reverse(), actual)).toEqual([]);
  });

  it("renders and reconciles authenticated HTTP MCP configuration", () => {
    const desired = [
      definition("org__dinky_mcp", "mcp", {
        transport: "streamable_http",
        url: "https://dinky.example.test/api/infinity/mcp/transport",
        bearerTokenEnvVar: "INFINITY_USER_TOKEN",
        envHttpHeaders: { "X-INFINITY-TENANT-ID": "INFINITY_TENANT_ID" },
      }),
    ];
    const actual = {
      ...emptyActualCapabilityState(),
      mcpServers: [
        {
          name: "org__dinky_mcp",
          config: {
            url: "https://dinky.example.test/api/infinity/mcp/transport",
            bearer_token_env_var: "INFINITY_USER_TOKEN",
            env_http_headers: { "X-INFINITY-TENANT-ID": "INFINITY_TENANT_ID" },
          },
          runtimeStatus: "connected" as const,
          authStatus: "bearerToken" as const,
        },
      ],
    };

    expect(planChanges(desired, actual)).toEqual([]);
  });
});

describe("CodexCapabilityAdapter", () => {
  it("normalizes actual App Server state into sorted managed identifiers", async () => {
    const runtime = runtimeStub({
      listSkills: vi.fn().mockResolvedValue({
        data: [
          {
            cwd: "/workspace",
            skills: [
              {
                name: "Revenue",
                description: "Revenue",
                path: "/codex-home/skills/org__revenue/1/SKILL.md",
                scope: "user",
                enabled: true,
              },
            ],
            errors: [],
          },
        ],
      }),
      listPlugins: vi.fn().mockResolvedValue({
        marketplaces: [
          {
            name: "org__catalog",
            path: "/catalog.json",
            plugins: [
              {
                id: "org__crm@org__catalog",
                name: "org__crm",
                source: { type: "local", path: "/plugin" },
                installed: true,
                enabled: true,
                installPolicy: "AVAILABLE",
                authPolicy: "ON_USE",
                localVersion: "1",
              },
            ],
          },
        ],
        marketplaceLoadErrors: [],
        featuredPluginIds: [],
      }),
      listApps: vi.fn().mockResolvedValue({
        data: [{ id: "org__crm_app", name: "CRM", isEnabled: true, isAccessible: true }],
        nextCursor: null,
      }),
      listInstalledApps: vi.fn().mockResolvedValue({
        apps: [{ id: "org__crm_app", enabled: true, callable: true, runtimeName: "CRM" }],
      }),
      listMcpServers: vi.fn().mockResolvedValue({
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
      readConfig: vi.fn().mockResolvedValue({
        config: { mcp_servers: { org__business: { url: "https://mcp.example.test" } } },
        origins: {},
        layers: null,
      }),
    });
    const adapter = new CodexCapabilityAdapter(runtime, {
      readSkill: vi.fn(),
    });

    await expect(
      adapter.readActual(managedHost, { cwd: "/workspace", threadId: null }),
    ).resolves.toMatchObject({
      skills: [{ capabilityId: "org__revenue" }],
      plugins: [{ id: "org__crm@org__catalog", version: "1" }],
      apps: [{ id: "org__crm_app", callable: true }],
      mcpServers: [{ name: "org__business", config: { url: "https://mcp.example.test" } }],
    });
  });

  it("returns unsupportedCapability and never falls back to a shell command", async () => {
    const writeConfigValue = vi
      .fn()
      .mockRejectedValue(new CodexRpcError("config/value/write", -32601, "Method not found"));
    const reloadMcpServers = vi.fn();
    const runtime = runtimeStub({
      writeConfigValue,
      reloadMcpServers,
    });
    const readSkill = vi.fn();
    const adapter = new CodexCapabilityAdapter(runtime, { readSkill });

    await expect(
      adapter.applyChange(managedHost, {
        operation: "configureMcp",
        capabilityId: "org__business",
        config: { url: "https://mcp.example.test" },
      }),
    ).resolves.toEqual({
      capabilityId: "org__business",
      operation: "configureMcp",
      status: "unsupportedCapability",
      safeMessage: "The connected Codex App Server does not support this capability operation.",
    });
    expect(writeConfigValue).toHaveBeenCalledOnce();
    expect(reloadMcpServers).not.toHaveBeenCalled();
    expect(readSkill).not.toHaveBeenCalled();
  });
});

function definition(
  id: string,
  kind: CapabilityDefinition["kind"],
  config: CapabilityDefinition["config"],
): CapabilityDefinition {
  return {
    id,
    kind,
    displayName: id,
    description: id,
    version: "1",
    source: { type: "internal", locator: `/data/capabilities/${id}/1` },
    config,
    sensitiveFields: [],
    enabled: true,
    createdByUserId: null,
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
  };
}

function runtimeStub(overrides: Partial<CodexCapabilityRuntime> = {}) {
  const runtime = {
    listSkills: vi.fn().mockResolvedValue({ data: [] }),
    listPlugins: vi.fn().mockResolvedValue({
      marketplaces: [],
      marketplaceLoadErrors: [],
      featuredPluginIds: [],
    }),
    listApps: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    listInstalledApps: vi.fn().mockResolvedValue({ apps: [] }),
    listMcpServers: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    readConfig: vi.fn().mockResolvedValue({ config: {}, origins: {}, layers: null }),
    createDirectory: vi.fn(),
    writeFile: vi.fn(),
    removeDirectory: vi.fn(),
    setSkillEnabled: vi.fn(),
    addMarketplace: vi.fn(),
    installPlugin: vi.fn(),
    uninstallPlugin: vi.fn(),
    upgradeMarketplace: vi.fn(),
    writeConfigValue: vi.fn(),
    reloadMcpServers: vi.fn(),
  } satisfies CodexCapabilityRuntime;
  return Object.assign(runtime, overrides);
}
