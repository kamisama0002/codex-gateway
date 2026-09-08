import { createHash } from "node:crypto";
import type { CapabilitySyncReason } from "~~/shared/types";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface McpOAuthStateRecord {
  stateHash: string;
  userId: number;
  projectId: number | null;
  capabilityId: string;
  runtimeId: string;
  callbackPath: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

export interface McpOAuthStateStore {
  create(record: McpOAuthStateRecord): Promise<void>;
  consume(stateHash: string, userId: number): Promise<McpOAuthStateRecord | null>;
}

interface McpOAuthServiceOptions {
  store: McpOAuthStateStore;
  startLogin(input: {
    capabilityId: string;
    threadId: string | null;
  }): Promise<{ authorizationUrl: string }>;
  forwardCallback(input: {
    userId: number;
    runtimeId: string;
    callbackPathAndQuery: string;
  }): Promise<void>;
  reconcile(input: {
    userId: number;
    projectId: number | null;
    reason: Extract<CapabilitySyncReason, "credentialRotated">;
  }): Promise<unknown>;
  now?: () => number;
}

export class McpOAuthService {
  private readonly now: () => number;

  constructor(private readonly options: McpOAuthServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  async start(input: {
    userId: number;
    projectId: number | null;
    capabilityId: string;
    runtimeId: string;
    threadId: string | null;
  }) {
    const response = await this.options.startLogin({
      capabilityId: input.capabilityId,
      threadId: input.threadId,
    });
    const authorizationUrl = new URL(response.authorizationUrl);
    if (authorizationUrl.protocol !== "https:" && authorizationUrl.protocol !== "http:") {
      throw new Error("OAuth authorization URL is invalid");
    }
    const state = authorizationUrl.searchParams.get("state");
    if (state === null || state.length < 8 || state.length > 4096) {
      throw new Error("OAuth authorization URL has no usable state");
    }
    const currentTime = this.now();
    await this.options.store.create({
      stateHash: stateHash(state),
      userId: input.userId,
      projectId: input.projectId,
      capabilityId: input.capabilityId,
      runtimeId: input.runtimeId,
      callbackPath: "/api/capabilities/mcp/oauth/callback",
      expiresAt: new Date(currentTime + OAUTH_STATE_TTL_MS).toISOString(),
      consumedAt: null,
      createdAt: new Date(currentTime).toISOString(),
    });
    return { authorizationUrl: authorizationUrl.toString() };
  }

  async complete(input: { userId: number; state: string; query: string }) {
    const record = await this.options.store.consume(stateHash(input.state), input.userId);
    if (record === null) throw new Error("OAuth state is invalid or expired");
    const query = new URLSearchParams(input.query);
    const suppliedState = query.get("state");
    if (suppliedState !== null && suppliedState !== input.state) {
      throw new Error("OAuth callback state does not match");
    }
    query.set("state", input.state);
    await this.options.forwardCallback({
      userId: record.userId,
      runtimeId: record.runtimeId,
      callbackPathAndQuery: `${record.callbackPath}?${query.toString()}`,
    });
    await this.options.reconcile({
      userId: record.userId,
      projectId: record.projectId,
      reason: "credentialRotated",
    });
    return {
      capabilityId: record.capabilityId,
      projectId: record.projectId,
      status: "completed" as const,
    };
  }
}

function stateHash(state: string) {
  return createHash("sha256").update(state).digest("hex");
}
