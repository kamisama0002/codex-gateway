export type UpstreamWireApi = "responses" | "chat_completions";

export interface ModelReasoningEffort {
  reasoningEffort: string;
  description?: string | null;
}

export interface ModelCapabilities {
  tools: boolean;
  streamingTools: boolean;
  vision: boolean;
  reasoning: boolean;
  maxContextTokens: number | null;
  defaultReasoningEffort?: string | null;
  supportedReasoningEfforts?: ModelReasoningEffort[];
}

export interface ProviderModelInput {
  modelId: string;
  displayName: string;
  enabled?: boolean;
  capabilities: ModelCapabilities;
}

export interface ModelProviderDefinition {
  id: string;
  name: string;
  baseUrl: string;
  wireApi: UpstreamWireApi;
  encryptedApiKey: string;
  enabled: boolean;
  requestTimeoutMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicModelProviderDefinition {
  id: string;
  name: string;
  baseUrl: string;
  wireApi: UpstreamWireApi;
  enabled: boolean;
  hasApiKey: boolean;
  requestTimeoutMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderModelDefinition {
  providerId: string;
  modelId: string;
  displayName: string;
  enabled: boolean;
  capabilities: ModelCapabilities;
  createdAt: string;
  updatedAt: string;
}

export interface UserModelGrant {
  userId: number;
  providerId: string;
  modelId: string;
  createdAt: string;
}

export interface UserProviderModel extends ProviderModelDefinition {
  provider: PublicModelProviderDefinition;
}
