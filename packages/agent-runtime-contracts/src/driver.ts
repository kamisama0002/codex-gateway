import type { RuntimeStatus, RuntimeType } from "./schemas";

export interface RuntimeHandle {
  userId: number;
  runtimeType: RuntimeType;
  status: RuntimeStatus;
}

export interface RuntimeCapabilitySnapshot {
  runtimeType: RuntimeType;
  capabilities: Record<string, boolean>;
  checkedAt: string;
}

export interface PlatformConversation {
  id: string;
  userId: number;
  createdAt: string;
}

export interface PlatformConversationSnapshot {
  conversation: PlatformConversation;
  items: PlatformConversationItem[];
}

export interface PlatformConversationItem {
  id: string;
  kind: string;
  createdAt: string;
  data: Record<string, unknown>;
}

export interface PlatformTurn {
  id: string;
  conversationId: string;
  status: "running" | "completed" | "interrupted" | "failed";
  createdAt: string;
}

export interface StartConversationInput {
  userId: number;
  metadata?: Record<string, string>;
}

export interface StartTurnInput {
  userId: number;
  conversationId: string;
  input: PlatformConversationItem[];
}

export interface ReadConversationInput {
  userId: number;
  conversationId: string;
}

export interface InterruptTurnInput {
  userId: number;
  conversationId: string;
  turnId: string;
}

export interface ApprovalResponseInput {
  userId: number;
  conversationId: string;
  approvalId: string;
  approved: boolean;
}

export interface AgentRuntimeDriver {
  readonly runtimeType: RuntimeType;
  ensureReady(userId: number): Promise<RuntimeHandle>;
  getCapabilities(handle: RuntimeHandle): Promise<RuntimeCapabilitySnapshot>;
  startConversation(input: StartConversationInput): Promise<PlatformConversation>;
  readConversation(input: ReadConversationInput): Promise<PlatformConversationSnapshot>;
  startTurn(input: StartTurnInput): Promise<PlatformTurn>;
  interruptTurn(input: InterruptTurnInput): Promise<void>;
  respondToApproval(input: ApprovalResponseInput): Promise<void>;
}
