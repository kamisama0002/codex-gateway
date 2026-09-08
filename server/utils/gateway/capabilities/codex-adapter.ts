import { posix } from "node:path";
import { z } from "zod";
import type {
  ActualCapabilityState,
  ActualMcpCapability,
  CapabilityChange,
  CapabilityChangeResult,
  CapabilityDefinition,
  CodexCapabilityContext,
  HostRecord,
  McpCapabilityConfig,
  PluginCapabilityConfig,
} from "~~/shared/types";
import { CodexRpcError } from "../http/errors";
import type { AppServerCapabilityService } from "../runtime/app-server-capabilities";

const MANAGED_SKILL_ROOT = "/codex-home/skills";
const MANAGED_CAPABILITY_ID = /^org__[a-z0-9][a-z0-9_.-]*$/u;

export interface SkillArtifactReader {
  readSkill(change: Extract<CapabilityChange, { operation: "installSkill" }>): Promise<Buffer>;
}

export interface CodexCapabilityRuntime {
  listSkills: AppServerCapabilityService["listSkills"];
  listPlugins: AppServerCapabilityService["listPlugins"];
  listApps: AppServerCapabilityService["listApps"];
  listInstalledApps: AppServerCapabilityService["listInstalledApps"];
  listMcpServers: AppServerCapabilityService["listMcpServers"];
  readConfig: AppServerCapabilityService["readConfig"];
  createDirectory: AppServerCapabilityService["createDirectory"];
  writeFile: AppServerCapabilityService["writeFile"];
  removeDirectory: AppServerCapabilityService["removeDirectory"];
  setSkillEnabled: AppServerCapabilityService["setSkillEnabled"];
  addMarketplace: AppServerCapabilityService["addMarketplace"];
  installPlugin: AppServerCapabilityService["installPlugin"];
  uninstallPlugin: AppServerCapabilityService["uninstallPlugin"];
  upgradeMarketplace: AppServerCapabilityService["upgradeMarketplace"];
  writeConfigValue: AppServerCapabilityService["writeConfigValue"];
  reloadMcpServers: AppServerCapabilityService["reloadMcpServers"];
}

export class CodexCapabilityAdapter {
  constructor(
    private readonly runtime: CodexCapabilityRuntime,
    private readonly artifacts: SkillArtifactReader,
  ) {}

  async readActual(
    host: HostRecord,
    context: CodexCapabilityContext,
  ): Promise<ActualCapabilityState> {
    const [skillsResponse, pluginsResponse, installedAppsResponse, configResponse] =
      await Promise.all([
        this.runtime.listSkills(host, context.cwd, true),
        this.runtime.listPlugins(host, context.cwd, false),
        this.runtime.listInstalledApps(host, context.threadId, false),
        this.runtime.readConfig(host, context.cwd),
      ]);
    const appPages = await this.readAllApps(host, context.threadId);
    const mcpPages = await this.readAllMcpServers(host, context.threadId);

    const skills = skillsResponse.data
      .flatMap((entry) => entry.skills)
      .flatMap((skill) => {
        const capabilityId = managedSkillCapabilityId(skill.path);
        return capabilityId === null
          ? []
          : [{ capabilityId, name: skill.name, path: skill.path, enabled: skill.enabled }];
      })
      .sort((left, right) => left.path.localeCompare(right.path));

    const marketplaces = pluginsResponse.marketplaces
      .map((marketplace) => ({ name: marketplace.name, path: marketplace.path ?? null }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const plugins = pluginsResponse.marketplaces
      .flatMap((marketplace) =>
        marketplace.plugins.map((plugin) => ({
          id: plugin.id,
          name: plugin.name,
          marketplaceName: marketplace.name,
          installed: plugin.installed,
          enabled: plugin.enabled,
          version: plugin.localVersion ?? plugin.version ?? null,
        })),
      )
      .sort((left, right) => left.id.localeCompare(right.id));

    const appsById = new Map(
      appPages.flatMap((page) =>
        page.data.map(
          (app) =>
            [
              app.id,
              {
                id: app.id,
                enabled: app.isEnabled ?? true,
                callable: app.isAccessible ?? false,
              },
            ] as const,
        ),
      ),
    );
    for (const app of installedAppsResponse.apps) {
      appsById.set(app.id, { id: app.id, enabled: app.enabled, callable: app.callable });
    }

    const configuredMcp = recordFromUnknown(configResponse.config.mcp_servers);
    const mcpStatusByName = new Map(
      mcpPages.flatMap((page) => page.data.map((server) => [server.name, server] as const)),
    );
    const mcpNames = new Set([...Object.keys(configuredMcp), ...mcpStatusByName.keys()]);
    const mcpServers: ActualMcpCapability[] = [...mcpNames]
      .map((name) => {
        const status = mcpStatusByName.get(name);
        return {
          name,
          config: normalizeActualMcpConfig(configuredMcp[name]),
          runtimeStatus: status?.runtimeStatus ?? null,
          authStatus: status?.authStatus ?? "unknown",
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    return {
      skills,
      marketplaces,
      plugins,
      apps: [...appsById.values()].sort((left, right) => left.id.localeCompare(right.id)),
      mcpServers,
    };
  }

  async applyChange(host: HostRecord, change: CapabilityChange): Promise<CapabilityChangeResult> {
    try {
      await this.apply(host, change);
      return {
        capabilityId: change.capabilityId,
        operation: change.operation,
        status: "applied",
        safeMessage: "Capability change applied.",
      };
    } catch (error) {
      if (error instanceof CodexRpcError && error.rpcCode === -32601) {
        return {
          capabilityId: change.capabilityId,
          operation: change.operation,
          status: "unsupportedCapability",
          safeMessage: "The connected Codex App Server does not support this capability operation.",
        };
      }
      return {
        capabilityId: change.capabilityId,
        operation: change.operation,
        status: "failed",
        safeMessage: "The capability operation failed. Check the administrator runtime logs.",
      };
    }
  }

  private async readAllApps(host: HostRecord, threadId: string | null) {
    const pages: Awaited<ReturnType<AppServerCapabilityService["listApps"]>>[] = [];
    let cursor: string | null = null;
    do {
      const page = await this.runtime.listApps(host, threadId, cursor, false);
      pages.push(page);
      cursor = page.nextCursor ?? null;
    } while (cursor !== null);
    return pages;
  }

  private async readAllMcpServers(host: HostRecord, threadId: string | null) {
    const pages: Awaited<ReturnType<AppServerCapabilityService["listMcpServers"]>>[] = [];
    let cursor: string | null = null;
    do {
      const page = await this.runtime.listMcpServers(host, threadId, cursor);
      pages.push(page);
      cursor = page.nextCursor ?? null;
    } while (cursor !== null);
    return pages;
  }

  private async apply(host: HostRecord, change: CapabilityChange) {
    switch (change.operation) {
      case "installSkill": {
        assertManagedSkillPath(change.targetDirectory);
        assertManagedSkillPath(change.targetPath);
        const content = await this.artifacts.readSkill(change);
        await this.runtime.createDirectory(host, change.targetDirectory);
        await this.runtime.writeFile(host, change.targetPath, content);
        await this.runtime.setSkillEnabled(host, change.targetPath, true);
        return;
      }
      case "removeSkill":
        assertManagedSkillPath(change.targetDirectory);
        await this.runtime.removeDirectory(host, change.targetDirectory);
        return;
      case "setSkillEnabled":
        assertManagedSkillPath(change.path);
        await this.runtime.setSkillEnabled(host, change.path, change.enabled);
        return;
      case "installPlugin": {
        let marketplacePath = change.marketplacePath;
        if (marketplacePath === null) {
          await this.runtime.addMarketplace(host, change.marketplaceUrl);
          const refreshed = await this.runtime.listPlugins(host, "/workspace", true);
          marketplacePath =
            refreshed.marketplaces.find((item) => item.name === change.marketplaceName)?.path ??
            null;
        }
        if (marketplacePath === null) throw new Error("Marketplace manifest is unavailable");
        await this.runtime.installPlugin(host, marketplacePath, change.pluginName);
        return;
      }
      case "uninstallPlugin":
        await this.runtime.uninstallPlugin(host, change.pluginId);
        return;
      case "upgradePlugin":
        await this.runtime.upgradeMarketplace(host, change.marketplaceName);
        return;
      case "setPluginEnabled":
        await this.runtime.writeConfigValue(
          host,
          `plugins.${quotedKey(change.pluginId)}.enabled`,
          change.enabled,
        );
        return;
      case "setAppEnabled":
        await this.runtime.writeConfigValue(
          host,
          `apps.${quotedKey(change.appId)}.enabled`,
          change.enabled,
        );
        return;
      case "configureMcp":
        assertManagedCapabilityId(change.capabilityId);
        await this.runtime.writeConfigValue(
          host,
          `mcp_servers.${change.capabilityId}`,
          change.config,
        );
        await this.runtime.reloadMcpServers(host);
        return;
      case "removeMcp":
        assertManagedCapabilityId(change.capabilityId);
        await this.runtime.writeConfigValue(host, `mcp_servers.${change.capabilityId}`, null);
        await this.runtime.reloadMcpServers(host);
    }
  }
}

export function emptyActualCapabilityState(): ActualCapabilityState {
  return { skills: [], marketplaces: [], plugins: [], apps: [], mcpServers: [] };
}

export function planChanges(
  desired: CapabilityDefinition[],
  actual: ActualCapabilityState,
): CapabilityChange[] {
  const changes: CapabilityChange[] = [];
  const desiredSkillIds = new Set<string>();
  const desiredPluginIds = new Set<string>();
  const desiredAppIds = new Set<string>();
  const desiredMcpIds = new Set<string>();

  for (const definition of [...desired].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!definition.enabled) continue;
    switch (definition.kind) {
      case "skill": {
        desiredSkillIds.add(definition.id);
        const targetDirectory = `${MANAGED_SKILL_ROOT}/${definition.id}/${definition.version}`;
        const targetPath = `${targetDirectory}/${skillConfig(definition).entryPath}`;
        const matching = actual.skills.find(
          (skill) => skill.capabilityId === definition.id && skill.path === targetPath,
        );
        if (matching === undefined) {
          changes.push({
            operation: "installSkill",
            capabilityId: definition.id,
            source: definition.source,
            version: definition.version,
            targetDirectory,
            targetPath,
          });
        } else if (!matching.enabled) {
          changes.push({
            operation: "setSkillEnabled",
            capabilityId: definition.id,
            path: matching.path,
            enabled: true,
          });
        }
        for (const stale of actual.skills.filter(
          (skill) => skill.capabilityId === definition.id && skill.path !== targetPath,
        )) {
          changes.push({
            operation: "removeSkill",
            capabilityId: definition.id,
            targetDirectory: posix.dirname(stale.path),
          });
        }
        break;
      }
      case "plugin": {
        const config = pluginConfig(definition);
        const pluginId = `${config.pluginName}@${config.marketplaceName}`;
        desiredPluginIds.add(pluginId);
        const installed = actual.plugins.find((plugin) => plugin.id === pluginId);
        if (installed?.installed !== true) {
          changes.push({
            operation: "installPlugin",
            capabilityId: definition.id,
            marketplaceName: config.marketplaceName,
            marketplaceUrl: config.marketplaceUrl,
            marketplacePath:
              actual.marketplaces.find((item) => item.name === config.marketplaceName)?.path ??
              null,
            pluginName: config.pluginName,
          });
        } else if (!installed.enabled) {
          changes.push({
            operation: "setPluginEnabled",
            capabilityId: definition.id,
            pluginId,
            enabled: true,
          });
        } else if (installed.version !== null && installed.version !== definition.version) {
          changes.push({
            operation: "upgradePlugin",
            capabilityId: definition.id,
            marketplaceName: config.marketplaceName,
          });
        }
        break;
      }
      case "app": {
        const appId = appConfigId(definition);
        desiredAppIds.add(appId);
        if (actual.apps.find((app) => app.id === appId)?.enabled !== true) {
          changes.push({
            operation: "setAppEnabled",
            capabilityId: definition.id,
            appId,
            enabled: true,
          });
        }
        break;
      }
      case "mcp":
      case "search": {
        desiredMcpIds.add(definition.id);
        const expected = desiredMcpConfig(mcpConfig(definition));
        const configured = actual.mcpServers.find(
          (server) => server.name === definition.id,
        )?.config;
        if (!sameJson(configured, expected)) {
          changes.push({
            operation: "configureMcp",
            capabilityId: definition.id,
            config: expected,
          });
        }
        break;
      }
    }
  }

  for (const skill of actual.skills) {
    if (!desiredSkillIds.has(skill.capabilityId)) {
      changes.push({
        operation: "removeSkill",
        capabilityId: skill.capabilityId,
        targetDirectory: posix.dirname(skill.path),
      });
    }
  }
  for (const plugin of actual.plugins) {
    if (isManagedPlugin(plugin) && !desiredPluginIds.has(plugin.id) && plugin.installed) {
      changes.push({
        operation: "uninstallPlugin",
        capabilityId: plugin.name,
        pluginId: plugin.id,
      });
    }
  }
  for (const app of actual.apps) {
    if (MANAGED_CAPABILITY_ID.test(app.id) && !desiredAppIds.has(app.id) && app.enabled) {
      changes.push({
        operation: "setAppEnabled",
        capabilityId: app.id,
        appId: app.id,
        enabled: false,
      });
    }
  }
  for (const server of actual.mcpServers) {
    if (MANAGED_CAPABILITY_ID.test(server.name) && !desiredMcpIds.has(server.name)) {
      changes.push({ operation: "removeMcp", capabilityId: server.name });
    }
  }

  return changes.sort((left, right) =>
    left.capabilityId === right.capabilityId
      ? left.operation.localeCompare(right.operation)
      : left.capabilityId.localeCompare(right.capabilityId),
  );
}

function managedSkillCapabilityId(path: string) {
  const match = /^\/codex-home\/skills\/(org__[a-z0-9][a-z0-9_.-]*)\/[^/]+\/SKILL\.md$/u.exec(path);
  return match?.[1] ?? null;
}

function assertManagedSkillPath(path: string) {
  if (!path.startsWith(`${MANAGED_SKILL_ROOT}/org__`)) {
    throw new Error("Managed Skill path is outside the organization namespace");
  }
}

function assertManagedCapabilityId(id: string) {
  if (!MANAGED_CAPABILITY_ID.test(id)) throw new Error("Invalid managed capability ID");
}

function skillConfig(definition: CapabilityDefinition) {
  if (!("entryPath" in definition.config)) throw new Error("Skill capability config is invalid");
  return definition.config;
}

function pluginConfig(definition: CapabilityDefinition): PluginCapabilityConfig {
  if (!("pluginName" in definition.config)) throw new Error("Plugin capability config is invalid");
  return definition.config;
}

function appConfigId(definition: CapabilityDefinition) {
  if (!("appId" in definition.config)) throw new Error("App capability config is invalid");
  return definition.config.appId;
}

function mcpConfig(definition: CapabilityDefinition): McpCapabilityConfig {
  if (!("transport" in definition.config)) throw new Error("MCP capability config is invalid");
  return definition.config;
}

function desiredMcpConfig(config: McpCapabilityConfig): Record<string, unknown> {
  return config.transport === "stdio"
    ? { command: config.command, args: config.args }
    : {
        url: config.url,
        ...(config.bearerTokenEnvVar === undefined
          ? {}
          : { bearer_token_env_var: config.bearerTokenEnvVar }),
        ...(config.envHttpHeaders === undefined ? {} : { env_http_headers: config.envHttpHeaders }),
      };
}

function normalizeActualMcpConfig(value: unknown): Record<string, unknown> | null {
  const config = recordFromUnknown(value);
  if (typeof config.command === "string") {
    return {
      command: config.command,
      args: Array.isArray(config.args)
        ? config.args.filter((item) => typeof item === "string")
        : [],
    };
  }
  if (typeof config.url !== "string") return null;
  const bearerTokenEnvVar =
    typeof config.bearer_token_env_var === "string" ? config.bearer_token_env_var : undefined;
  const headers = recordFromUnknown(config.env_http_headers);
  const envHttpHeaders =
    Object.keys(headers).length === 0
      ? undefined
      : Object.fromEntries(
          Object.entries(headers).filter(([, value]) => typeof value === "string"),
        );
  return {
    url: config.url,
    ...(bearerTokenEnvVar === undefined ? {} : { bearer_token_env_var: bearerTokenEnvVar }),
    ...(envHttpHeaders === undefined ? {} : { env_http_headers: envHttpHeaders }),
  };
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  return parsed.success ? parsed.data : {};
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== "object" || value === null) return value;
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  if (!parsed.success) return value;
  return Object.fromEntries(
    Object.entries(parsed.data)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}

function quotedKey(value: string) {
  return JSON.stringify(value);
}

function isManagedPlugin(plugin: ActualCapabilityState["plugins"][number]) {
  return (
    MANAGED_CAPABILITY_ID.test(plugin.name) || MANAGED_CAPABILITY_ID.test(plugin.marketplaceName)
  );
}
