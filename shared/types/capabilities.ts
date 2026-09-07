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
