import type { HostRecord } from "~~/shared/types";
import {
  parseAppsInstalledResponse,
  parseAppsListResponse,
  parseCapabilityConfigReadResponse,
  parseCapabilityMcpServerStatusPage,
  parseConfigWriteResponse,
  parseEmptyCapabilityResponse,
  parseMarketplaceAddResponse,
  parseMarketplaceRemoveResponse,
  parseMarketplaceUpgradeResponse,
  parsePluginInstallResponse,
  parsePluginListResponse,
  parseSkillConfigWriteResponse,
  parseSkillsListResponse,
} from "~~/shared/runtime/app-server/capabilities";
import {
  parseFsCreateDirectoryResponse,
  parseFsRemoveResponse,
  parseFsWriteFileResponse,
} from "~~/shared/runtime/app-server/file-system";
import type { CodexRpcClient } from "../infra/rpc/rpc";

const CAPABILITY_RPC_TIMEOUT_MS = 120_000;

export interface AppServerCapabilityControllerRegistry {
  getHostClient(host: HostRecord): Promise<CodexRpcClient>;
}

export class AppServerCapabilityService {
  constructor(private readonly registry: AppServerCapabilityControllerRegistry) {}

  async listSkills(host: HostRecord, cwd: string, forceReload: boolean) {
    return await this.request(
      host,
      "skills/list",
      { cwds: [cwd], forceReload },
      parseSkillsListResponse,
    );
  }

  async listPlugins(host: HostRecord, cwd: string, forceRefetch: boolean) {
    return await this.request(
      host,
      "plugin/list",
      { cwds: [cwd], forceRefetch },
      parsePluginListResponse,
    );
  }

  async listApps(
    host: HostRecord,
    threadId: string | null,
    cursor: string | null,
    forceRefetch: boolean,
  ) {
    return await this.request(
      host,
      "app/list",
      { cursor, limit: 100, threadId, forceRefetch },
      parseAppsListResponse,
    );
  }

  async listInstalledApps(host: HostRecord, threadId: string | null, forceRefresh: boolean) {
    return await this.request(
      host,
      "app/installed",
      { threadId, forceRefresh },
      parseAppsInstalledResponse,
    );
  }

  async listMcpServers(host: HostRecord, threadId: string | null, cursor: string | null) {
    return await this.request(
      host,
      "mcpServerStatus/list",
      { cursor, limit: 100, detail: "toolsAndAuthOnly", threadId },
      parseCapabilityMcpServerStatusPage,
    );
  }

  async readConfig(host: HostRecord, cwd: string) {
    return await this.request(
      host,
      "config/read",
      { cwd, includeLayers: false },
      parseCapabilityConfigReadResponse,
    );
  }

  async createDirectory(host: HostRecord, path: string) {
    return await this.request(
      host,
      "fs/createDirectory",
      { path, recursive: true },
      parseFsCreateDirectoryResponse,
    );
  }

  async writeFile(host: HostRecord, path: string, content: Buffer) {
    return await this.request(
      host,
      "fs/writeFile",
      { path, dataBase64: content.toString("base64") },
      parseFsWriteFileResponse,
    );
  }

  async removeDirectory(host: HostRecord, path: string) {
    return await this.request(
      host,
      "fs/remove",
      { path, recursive: true, force: true },
      parseFsRemoveResponse,
    );
  }

  async setSkillEnabled(host: HostRecord, path: string, enabled: boolean) {
    return await this.request(
      host,
      "skills/config/write",
      { path, enabled },
      parseSkillConfigWriteResponse,
    );
  }

  async setExtraSkillRoots(host: HostRecord, extraRoots: string[]) {
    return await this.request(
      host,
      "skills/extraRoots/set",
      { extraRoots },
      parseEmptyCapabilityResponse,
    );
  }

  async addMarketplace(host: HostRecord, source: string) {
    return await this.request(host, "marketplace/add", { source }, parseMarketplaceAddResponse);
  }

  async removeMarketplace(host: HostRecord, marketplaceName: string) {
    return await this.request(
      host,
      "marketplace/remove",
      { marketplaceName },
      parseMarketplaceRemoveResponse,
    );
  }

  async upgradeMarketplace(host: HostRecord, marketplaceName: string) {
    return await this.request(
      host,
      "marketplace/upgrade",
      { marketplaceName },
      parseMarketplaceUpgradeResponse,
    );
  }

  async installPlugin(host: HostRecord, marketplacePath: string, pluginName: string) {
    return await this.request(
      host,
      "plugin/install",
      { marketplacePath, pluginName },
      parsePluginInstallResponse,
    );
  }

  async uninstallPlugin(host: HostRecord, pluginId: string) {
    return await this.request(host, "plugin/uninstall", { pluginId }, parseEmptyCapabilityResponse);
  }

  async writeConfigValue(host: HostRecord, keyPath: string, value: unknown) {
    return await this.request(
      host,
      "config/value/write",
      { keyPath, value, mergeStrategy: "replace" },
      parseConfigWriteResponse,
    );
  }

  async reloadMcpServers(host: HostRecord) {
    return await this.request(
      host,
      "config/mcpServer/reload",
      undefined,
      parseEmptyCapabilityResponse,
    );
  }

  private async request<T>(
    host: HostRecord,
    method: string,
    params: unknown,
    parse: (value: unknown) => T,
  ) {
    const client = await this.registry.getHostClient(host);
    return await client.request(method, params, CAPABILITY_RPC_TIMEOUT_MS, parse);
  }
}
