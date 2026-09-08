export type CapabilityKind = "skill" | "plugin" | "app" | "mcp" | "search";

export const DEFAULT_WEB_SEARCH_CAPABILITY_ID = "org__web_search";
export const DEFAULT_BROWSER_CAPABILITY_ID = "org__browser";
export const DEFAULT_INFINITY_MCP_CAPABILITY_ID = "org__infinity";

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
  bearerTokenEnvVar?: string;
  httpHeaders?: Record<string, string>;
  envHttpHeaders?: Record<string, string>;
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
      version: string;
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

export type CapabilitySyncStatus = "pending" | "running" | "succeeded" | "failed";
export type CapabilitySyncReason =
  | "runtimeStart"
  | "runtimeRestart"
  | "runtimeUpgrade"
  | "assignmentChanged"
  | "credentialRotated"
  | "administratorRetry";

export interface CapabilitySyncRecord {
  id: number;
  userId: number;
  projectId: number | null;
  desiredHash: string;
  actualHash: string | null;
  status: CapabilitySyncStatus;
  results: CapabilityChangeResult[];
  safeError: string | null;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilitySyncResult {
  userId: number;
  projectId: number | null;
  reason: CapabilitySyncReason;
  desiredHash: string;
  actualHash: string;
  status: "succeeded" | "failed";
  results: CapabilityChangeResult[];
  remainingChanges: CapabilityChange[];
  skipped: boolean;
}

export type CapabilityDeploymentStatus = "unknown" | "syncing" | "ready" | "failed";
export type CapabilityCredentialStatus = "notRequired" | "missing" | "configured" | "expired";

export interface CapabilityDeploymentDescriptor {
  userId: number;
  projectId: number | null;
  status: CapabilityDeploymentStatus;
  safeError: string | null;
  updatedAt: string;
}

export interface AdminCapabilityCatalogItem extends CapabilityDefinition {
  assignments: CapabilityAssignment[];
  credentials: import("./credentials").CredentialDescriptor[];
  deployments: CapabilityDeploymentDescriptor[];
}

export interface CapabilityAdminUser {
  id: number;
  username: string;
  role: "admin" | "user";
}

export interface AdminCapabilityCatalog {
  capabilities: AdminCapabilityCatalogItem[];
  users: CapabilityAdminUser[];
}

export interface UserCapabilityCatalogItem extends CapabilityDefinition {
  credentials: import("./credentials").CredentialDescriptor[];
  credentialStatus: CapabilityCredentialStatus;
  deploymentStatus: CapabilityDeploymentStatus;
  safeError: string | null;
}

export interface UserCapabilityCatalog {
  userId: number;
  capabilities: UserCapabilityCatalogItem[];
  projectId: number | null;
}
