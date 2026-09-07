export type CapabilityKind = "skill" | "plugin" | "app" | "mcp" | "search";

export interface CapabilitySource {
  type: "builtin" | "git" | "internal" | "upload";
  locator: string;
}

export interface SkillCapabilityConfig {
  entryPath: string;
}

export interface PluginCapabilityConfig {
  marketplaceName: string;
  marketplaceUrl: string;
  pluginName: string;
}

export interface AppCapabilityConfig {
  appId: string;
}

export interface StdioMcpCapabilityConfig {
  transport: "stdio";
  command: string;
  args: string[];
}

export interface HttpMcpCapabilityConfig {
  transport: "streamable_http";
  url: string;
}

export type McpCapabilityConfig = StdioMcpCapabilityConfig | HttpMcpCapabilityConfig;

export type CapabilityConfig =
  | SkillCapabilityConfig
  | PluginCapabilityConfig
  | AppCapabilityConfig
  | McpCapabilityConfig;

export interface CapabilityDefinition {
  id: string;
  kind: CapabilityKind;
  displayName: string;
  description: string;
  version: string;
  source: CapabilitySource;
  config: CapabilityConfig;
  sensitiveFields: string[];
  enabled: boolean;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityCreateInput {
  id: string;
  kind: CapabilityKind;
  displayName: string;
  description: string;
  version: string;
  source: CapabilitySource;
  config: CapabilityConfig;
  sensitiveFields?: string[];
  enabled?: boolean;
  createdByUserId?: number | null;
}

export interface CapabilityUpdateInput {
  displayName?: string;
  description?: string;
  version?: string;
  source?: CapabilitySource;
  config?: CapabilityConfig;
  sensitiveFields?: string[];
  enabled?: boolean;
}

export interface CapabilityAssignment {
  id: number;
  capabilityId: string;
  userId: number;
  projectId: number | null;
  createdAt: string;
}

export interface CapabilityArtifact {
  capabilityId: string;
  version: string;
  sha256: string;
  storagePath: string;
  sizeBytes: number;
  createdAt: string;
}

export type CapabilityArtifactInput = Omit<CapabilityArtifact, "createdAt">;

export interface CapabilityAssignmentInput {
  capabilityId: string;
  userId: number;
  projectId: number | null;
}

export interface CapabilityContext {
  userId: number;
  projectId: number | null;
}

export interface CodexCapabilityContext {
  cwd: string;
  threadId: string | null;
}

export interface ActualSkillCapability {
  capabilityId: string;
  name: string;
  path: string;
  enabled: boolean;
}

export interface ActualPluginMarketplace {
  name: string;
  path: string | null;
}

export interface ActualPluginCapability {
  id: string;
  name: string;
  marketplaceName: string;
  installed: boolean;
  enabled: boolean;
  version: string | null;
}

export interface ActualAppCapability {
  id: string;
  enabled: boolean;
  callable: boolean;
}

export interface ActualMcpCapability {
  name: string;
  config: Record<string, unknown> | null;
  runtimeStatus:
    | "notStarted"
    | "starting"
    | "connected"
    | "authenticationRequired"
    | "failed"
    | "cancelled"
    | "disabled"
    | null;
  authStatus: "unknown" | "unsupported" | "notLoggedIn" | "bearerToken" | "oAuth";
}

export interface ActualCapabilityState {
  skills: ActualSkillCapability[];
  marketplaces: ActualPluginMarketplace[];
  plugins: ActualPluginCapability[];
  apps: ActualAppCapability[];
  mcpServers: ActualMcpCapability[];
}

export type CapabilityChange =
  | {
      operation: "installSkill";
      capabilityId: string;
      source: CapabilitySource;
      targetDirectory: string;
      targetPath: string;
    }
  | {
      operation: "removeSkill";
      capabilityId: string;
      targetDirectory: string;
    }
  | {
      operation: "setSkillEnabled";
      capabilityId: string;
      path: string;
      enabled: boolean;
    }
  | {
      operation: "installPlugin";
      capabilityId: string;
      marketplaceName: string;
      marketplaceUrl: string;
      marketplacePath: string | null;
      pluginName: string;
    }
  | {
      operation: "uninstallPlugin";
      capabilityId: string;
      pluginId: string;
    }
  | {
      operation: "upgradePlugin";
      capabilityId: string;
      marketplaceName: string;
    }
  | {
      operation: "setPluginEnabled";
      capabilityId: string;
      pluginId: string;
      enabled: boolean;
    }
  | {
      operation: "setAppEnabled";
      capabilityId: string;
      appId: string;
      enabled: boolean;
    }
  | {
      operation: "configureMcp";
      capabilityId: string;
      config: Record<string, unknown>;
    }
  | {
      operation: "removeMcp";
      capabilityId: string;
    };

export interface CapabilityChangeResult {
  capabilityId: string;
  operation: CapabilityChange["operation"];
  status: "applied" | "unsupportedCapability" | "failed";
  safeMessage: string;
}
