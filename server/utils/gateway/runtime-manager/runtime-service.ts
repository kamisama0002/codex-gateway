import { createHash, createHmac } from "node:crypto";
import { Mutex } from "async-mutex";
import {
  serializeManagedRuntimeStatus,
  type ManagedRuntimeEndpoint,
  type ManagedRuntimeStatus,
  type RuntimeStatus,
  type UserAgentRuntimeRecord,
} from "@codex-gateway/agent-runtime-contracts";
import type { HostRecord } from "~~/shared/types";
import type { AuditEventInput } from "~~/shared/types/audit";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import { recordFromUnknown, stringFromUnknown } from "~~/shared/utils/records";
import { createManagedRuntimeHost } from "../infra/rpc/managed-rpc-transport";
import { CodexRpcClient } from "../infra/rpc/rpc";
import { SUPPORTED_CODEX_VERSION, parseCodexVersion } from "../infra/codex/codex-version";
import { runWithGatewayUser } from "../state/memory";
import { threadBroker } from "../runtime/broker";
import { auditStore } from "../audit/audit-store";
import { runtimeStore } from "./runtime-store";
import { providerStore } from "../providers/provider-store";
import { issueRuntimeModelToken } from "../providers/runtime-token";
import { transitionRuntime, type RuntimeEvent } from "./runtime-state";
import {
  RuntimeManagerClient,
  type ProvisionRuntimeRequest,
  type RuntimeLifecycleResult,
} from "./client";

interface RuntimeManagerPort {
  provision(input: ProvisionRuntimeRequest): Promise<RuntimeLifecycleResult>;
  inspect(runtimeId: string): Promise<RuntimeLifecycleResult>;
  start(runtimeId: string): Promise<RuntimeLifecycleResult>;
  stop(runtimeId: string): Promise<RuntimeLifecycleResult>;
  restart(runtimeId: string): Promise<RuntimeLifecycleResult>;
  remove(runtimeId: string): Promise<RuntimeLifecycleResult>;
}

interface RuntimeStorePort {
  getByUserId(userId: number): UserAgentRuntimeRecord | null;
  list(): UserAgentRuntimeRecord[];
  upsert(record: UserAgentRuntimeRecord): UserAgentRuntimeRecord;
  deleteForUser(userId: number): boolean;
}

interface AuditStorePort {
  record(input: AuditEventInput): unknown;
}

interface RuntimeCompatibilitySnapshot {
  runtimeVersion: string;
  schemaHash: string;
  capabilities: Record<string, boolean>;
}

interface ManagedRuntimeServiceOptions {
  manager: RuntimeManagerPort;
  store: RuntimeStorePort;
  audit: AuditStorePort;
  identitySecret: string;
  imageAlias: string;
  expectedRuntimeVersion: string;
  probe(host: HostRecord): Promise<RuntimeCompatibilitySnapshot>;
  closeConnections?(userId: number): void;
  now?: () => string;
}

const safeManagerErrorCodes = new Set([
  "internal_error",
  "invalid_request",
  "runtime_identity_conflict",
  "runtime_manager_invalid_response",
  "runtime_manager_request_failed",
  "runtime_manager_timeout",
  "runtime_manager_unavailable",
  "managed_rpc_handshake_timeout",
  "runtime_not_found",
  "unauthorized",
  "unknown_image_alias",
]);

export class ManagedRuntimeServiceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ManagedRuntimeServiceError";
  }
}

export class ManagedRuntimeService {
  private readonly locks = new Map<number, Mutex>();
  private readonly now: () => string;

  constructor(private readonly options: ManagedRuntimeServiceOptions) {
    if (options.identitySecret.length === 0) throw new Error("Runtime identity secret is required");
    if (options.imageAlias.length === 0) throw new Error("Runtime image alias is required");
    if (options.expectedRuntimeVersion.length === 0) {
      throw new Error("Expected runtime version is required");
    }
    this.now = options.now ?? (() => new Date().toISOString());
  }

  getStatus(userId: number): ManagedRuntimeStatus | null {
    const runtime = this.options.store.getByUserId(positiveUserId(userId));
    return runtime === null ? null : serializeManagedRuntimeStatus(runtime);
  }

  listStatuses(): ManagedRuntimeStatus[] {
    return this.options.store.list().map(serializeManagedRuntimeStatus);
  }

  start(userId: number, actorUserId = userId): Promise<ManagedRuntimeStatus> {
    const targetUserId = positiveUserId(userId);
    const actor = positiveUserId(actorUserId);
    return this.lockFor(targetUserId).runExclusive(() => this.startLocked(targetUserId, actor));
  }

  stop(userId: number, actorUserId = userId): Promise<ManagedRuntimeStatus> {
    const targetUserId = positiveUserId(userId);
    const actor = positiveUserId(actorUserId);
    return this.lockFor(targetUserId).runExclusive(async () => {
      const runtime = this.requiredRuntime(targetUserId);
      const identity = this.identity(targetUserId);
      let result: RuntimeLifecycleResult;
      try {
        this.options.closeConnections?.(targetUserId);
        result = await this.options.manager.stop(identity.runtimeId);
        this.assertRuntimeResult(identity.runtimeId, result, "stopped");
        requiredImageVersion(result);
      } catch (error) {
        const code = safeErrorCode(error);
        const degraded = this.persist(runtime, "degraded", { lastError: code });
        this.auditFailure("runtime.stop", actor, targetUserId, degraded, identity.runtimeId, code);
        throw new ManagedRuntimeServiceError(code);
      }
      const stopped = this.persist(runtime, "degraded", {
        containerId: result.containerId,
        imageVersion: requiredImageVersion(result),
        lastError: "runtime_stopped",
      });
      this.auditSuccess("runtime.stop", actor, targetUserId, stopped, identity.runtimeId);
      return serializeManagedRuntimeStatus(stopped);
    });
  }

  restart(userId: number, actorUserId = userId): Promise<ManagedRuntimeStatus> {
    const targetUserId = positiveUserId(userId);
    const actor = positiveUserId(actorUserId);
    return this.lockFor(targetUserId).runExclusive(async () => {
      let runtime = this.requiredRuntime(targetUserId);
      const identity = this.identity(targetUserId);
      runtime = this.persistTransition(runtime, "restart");
      let endpoint: ManagedRuntimeEndpoint;
      let restarted: RuntimeLifecycleResult;
      try {
        this.options.closeConnections?.(targetUserId);
        restarted = await this.options.manager.restart(identity.runtimeId);
        endpoint = this.runningEndpoint(identity.runtimeId, restarted);
        requiredImageVersion(restarted);
      } catch (error) {
        const code = safeErrorCode(error);
        const degraded = this.persistTransition(runtime, "restartFailed", { lastError: code });
        this.auditFailure(
          "runtime.restart",
          actor,
          targetUserId,
          degraded,
          identity.runtimeId,
          code,
        );
        throw new ManagedRuntimeServiceError(code);
      }
      runtime = this.persistTransition(runtime, "start", {
        containerId: restarted.containerId,
        imageVersion: requiredImageVersion(restarted),
        lastError: null,
      });
      this.auditSuccess("runtime.restart", actor, targetUserId, runtime, identity.runtimeId);
      return serializeManagedRuntimeStatus(
        await this.finishCompatibility(runtime, endpoint, actor, identity.runtimeId),
      );
    });
  }

  remove(userId: number, actorUserId = userId): Promise<null> {
    const targetUserId = positiveUserId(userId);
    const actor = positiveUserId(actorUserId);
    return this.lockFor(targetUserId).runExclusive(async () => {
      const runtime = this.options.store.getByUserId(targetUserId);
      const identity = this.identity(targetUserId);
      let result: RuntimeLifecycleResult;
      try {
        this.options.closeConnections?.(targetUserId);
        result = await this.options.manager.remove(identity.runtimeId);
        this.assertRuntimeResult(identity.runtimeId, result, "absent");
      } catch (error) {
        const code = safeErrorCode(error);
        const basis = runtime ?? this.createRuntime(targetUserId, "degraded");
        const degraded = this.persist(basis, "degraded", { lastError: code });
        this.auditFailure(
          "runtime.remove",
          actor,
          targetUserId,
          degraded,
          identity.runtimeId,
          code,
        );
        throw new ManagedRuntimeServiceError(code);
      }
      if (runtime !== null && runtime.status !== "absent") {
        this.persistTransition(runtime, "remove", {
          containerId: null,
          lastError: null,
        });
      }
      this.options.store.deleteForUser(targetUserId);
      this.auditSuccess(
        "runtime.remove",
        actor,
        targetUserId,
        runtime,
        identity.runtimeId,
        "absent",
      );
      return null;
    });
  }

  async resolveManagedHost(userId: number): Promise<HostRecord> {
    const targetUserId = positiveUserId(userId);
    const runtime = this.requiredRuntime(targetUserId);
    if (runtime.status !== "ready") throw new ManagedRuntimeServiceError("runtime_not_ready");
    const identity = this.identity(targetUserId);
    let result: RuntimeLifecycleResult;
    try {
      result = await this.options.manager.inspect(identity.runtimeId);
    } catch (error) {
      throw new ManagedRuntimeServiceError(safeErrorCode(error));
    }
    const endpoint = this.runningEndpoint(identity.runtimeId, result);
    return createManagedRuntimeHost(targetUserId, runtime, endpoint);
  }

  private async startLocked(userId: number, actorUserId: number): Promise<ManagedRuntimeStatus> {
    const identity = this.identity(userId);
    const existing = this.options.store.getByUserId(userId);
    if (existing?.status === "ready") {
      try {
        const inspected = await this.options.manager.inspect(identity.runtimeId);
        this.runningEndpoint(identity.runtimeId, inspected);
        return serializeManagedRuntimeStatus(existing);
      } catch {
        this.persist(existing, "degraded", { lastError: "runtime_not_ready" });
      }
    }

    let runtime = this.options.store.getByUserId(userId);
    if (runtime === null) {
      runtime = this.createRuntime(userId, "provisioning");
    } else if (
      runtime.status === "absent" ||
      runtime.status === "degraded" ||
      runtime.status === "incompatible"
    ) {
      runtime = this.persistTransition(runtime, "provision", { lastError: null });
    } else if (runtime.status !== "provisioning") {
      runtime = this.persist(runtime, "provisioning", { lastError: null });
    }

    let provisioned: RuntimeLifecycleResult;
    try {
      const provisionRequest: ProvisionRuntimeRequest = {
        runtimeId: identity.runtimeId,
        userHash: identity.userHash,
        runtimeType: "codex-app-server",
        imageAlias: this.options.imageAlias,
      };
      const providerConfig = providerConfigForUser(userId, identity.runtimeId);
      if (providerConfig !== null) provisionRequest.providerConfig = providerConfig;
      provisioned = await this.options.manager.provision(provisionRequest);
      this.assertRuntimeResult(identity.runtimeId, provisioned);
      runtime = this.persist(runtime, "provisioning", {
        containerId: provisioned.containerId,
        imageVersion: requiredImageVersion(provisioned),
        lastError: null,
      });
      this.auditSuccess("runtime.provision", actorUserId, userId, runtime, identity.runtimeId);
    } catch (error) {
      const code = safeErrorCode(error);
      const degraded = this.persistTransition(runtime, "provisionFailed", { lastError: code });
      this.auditFailure(
        "runtime.provision",
        actorUserId,
        userId,
        degraded,
        identity.runtimeId,
        code,
      );
      throw new ManagedRuntimeServiceError(code);
    }

    let endpoint: ManagedRuntimeEndpoint;
    let started: RuntimeLifecycleResult;
    try {
      started = await this.options.manager.start(identity.runtimeId);
      endpoint = this.runningEndpoint(identity.runtimeId, started);
      requiredImageVersion(started);
    } catch (error) {
      const code = safeErrorCode(error);
      const degraded = this.persist(runtime, "degraded", { lastError: code });
      this.auditFailure("runtime.start", actorUserId, userId, degraded, identity.runtimeId, code);
      throw new ManagedRuntimeServiceError(code);
    }
    runtime = this.persistTransition(runtime, "start", {
      containerId: started.containerId,
      imageVersion: requiredImageVersion(started),
      lastError: null,
    });
    this.auditSuccess("runtime.start", actorUserId, userId, runtime, identity.runtimeId);
    return serializeManagedRuntimeStatus(
      await this.finishCompatibility(runtime, endpoint, actorUserId, identity.runtimeId),
    );
  }

  private async finishCompatibility(
    runtime: UserAgentRuntimeRecord,
    endpoint: ManagedRuntimeEndpoint,
    actorUserId: number,
    runtimeId: string,
  ): Promise<UserAgentRuntimeRecord> {
    let snapshot: RuntimeCompatibilitySnapshot;
    try {
      snapshot = await this.options.probe(
        createManagedRuntimeHost(runtime.userId, runtime, endpoint),
      );
    } catch (error) {
      const code = safeErrorCode(error);
      const degraded = this.persist(runtime, "degraded", { lastError: code });
      this.auditFailure(
        "runtime.compatibility",
        actorUserId,
        runtime.userId,
        degraded,
        runtimeId,
        code,
      );
      throw new ManagedRuntimeServiceError(code);
    }
    if (snapshot.runtimeVersion !== this.options.expectedRuntimeVersion) {
      const code = "runtime_version_incompatible";
      const incompatible = this.persistTransition(runtime, "schemaMismatch", {
        runtimeVersion: snapshot.runtimeVersion,
        schemaHash: snapshot.schemaHash,
        lastError: code,
      });
      this.auditFailure(
        "runtime.compatibility",
        actorUserId,
        runtime.userId,
        incompatible,
        runtimeId,
        code,
      );
      throw new ManagedRuntimeServiceError(code);
    }
    const syncing = this.persistTransition(runtime, "schemaOk", {
      runtimeVersion: snapshot.runtimeVersion,
      schemaHash: snapshot.schemaHash,
      lastError: null,
    });
    return this.persistTransition(syncing, "capabilitiesOk");
  }

  private createRuntime(userId: number, status: RuntimeStatus): UserAgentRuntimeRecord {
    const timestamp = this.now();
    return this.options.store.upsert({
      userId,
      hostId: MANAGED_RUNTIME_HOST_ID,
      runtimeType: "codex-app-server",
      containerId: null,
      imageVersion: "pending",
      runtimeVersion: "pending",
      schemaHash: "pending",
      status,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  private persistTransition(
    runtime: UserAgentRuntimeRecord,
    event: RuntimeEvent,
    changes: Partial<UserAgentRuntimeRecord> = {},
  ) {
    return this.persist(runtime, transitionRuntime(runtime.status, event), changes);
  }

  private persist(
    runtime: UserAgentRuntimeRecord,
    status: RuntimeStatus,
    changes: Partial<UserAgentRuntimeRecord> = {},
  ) {
    return this.options.store.upsert({
      ...runtime,
      ...changes,
      userId: runtime.userId,
      hostId: MANAGED_RUNTIME_HOST_ID,
      runtimeType: "codex-app-server",
      status,
      updatedAt: this.now(),
    });
  }

  private requiredRuntime(userId: number): UserAgentRuntimeRecord {
    const runtime = this.options.store.getByUserId(userId);
    if (runtime === null) throw new ManagedRuntimeServiceError("runtime_not_found");
    return runtime;
  }

  private identity(userId: number) {
    const userHash = createHmac("sha256", this.options.identitySecret)
      .update(`codex-runtime-user:${userId}`)
      .digest("hex");
    return { userHash, runtimeId: `codex_${userHash.slice(0, 32)}` };
  }

  private runningEndpoint(runtimeId: string, result: RuntimeLifecycleResult) {
    this.assertRuntimeResult(runtimeId, result, "running");
    if (result.endpoint === null || result.endpoint.runtimeId !== runtimeId) {
      throw new ManagedRuntimeServiceError("runtime_manager_invalid_response");
    }
    return result.endpoint;
  }

  private assertRuntimeResult(
    runtimeId: string,
    result: RuntimeLifecycleResult,
    status?: RuntimeLifecycleResult["status"],
  ) {
    if (result.runtimeId !== runtimeId || (status !== undefined && result.status !== status)) {
      throw new ManagedRuntimeServiceError("runtime_manager_invalid_response");
    }
  }

  private auditSuccess(
    action: string,
    actorUserId: number,
    userId: number,
    runtime: UserAgentRuntimeRecord | null,
    runtimeId: string,
    status?: RuntimeStatus,
  ) {
    this.options.audit.record({
      actorUserId,
      userId,
      action,
      outcome: "success",
      metadata: auditMetadata(userId, runtime, runtimeId, status),
    });
  }

  private auditFailure(
    action: string,
    actorUserId: number,
    userId: number,
    runtime: UserAgentRuntimeRecord | null,
    runtimeId: string,
    errorCode: string,
  ) {
    this.options.audit.record({
      actorUserId,
      userId,
      action,
      outcome: "failure",
      errorCode,
      metadata: auditMetadata(userId, runtime, runtimeId),
    });
  }

  private lockFor(userId: number) {
    let lock = this.locks.get(userId);
    if (lock === undefined) {
      lock = new Mutex();
      this.locks.set(userId, lock);
    }
    return lock;
  }
}

let productionRuntimeService: ManagedRuntimeService | null = null;

export const runtimeService = {
  getStatus(userId: number) {
    return defaultRuntimeService().getStatus(userId);
  },
  listStatuses() {
    return defaultRuntimeService().listStatuses();
  },
  start(userId: number, actorUserId = userId) {
    return defaultRuntimeService().start(userId, actorUserId);
  },
  stop(userId: number, actorUserId = userId) {
    return defaultRuntimeService().stop(userId, actorUserId);
  },
  restart(userId: number, actorUserId = userId) {
    return defaultRuntimeService().restart(userId, actorUserId);
  },
  remove(userId: number, actorUserId = userId) {
    return defaultRuntimeService().remove(userId, actorUserId);
  },
  resolveManagedHost(userId: number) {
    return defaultRuntimeService().resolveManagedHost(userId);
  },
};

function defaultRuntimeService(): ManagedRuntimeService {
  if (productionRuntimeService !== null) return productionRuntimeService;
  const secret = requiredEnvironment("RUNTIME_MANAGER_SHARED_SECRET");
  productionRuntimeService = new ManagedRuntimeService({
    manager: new RuntimeManagerClient({
      baseUrl: requiredEnvironment("RUNTIME_MANAGER_BASE_URL"),
      secret,
    }),
    store: runtimeStore,
    audit: auditStore,
    identitySecret: secret,
    imageAlias: requiredEnvironment("RUNTIME_MANAGER_DEFAULT_IMAGE_ALIAS"),
    expectedRuntimeVersion: SUPPORTED_CODEX_VERSION,
    probe: probeManagedCodexRuntime,
    closeConnections: (userId) =>
      runWithGatewayUser(userId, () => threadBroker.closeHost(MANAGED_RUNTIME_HOST_ID)),
  });
  return productionRuntimeService;
}

async function probeManagedCodexRuntime(host: HostRecord): Promise<RuntimeCompatibilitySnapshot> {
  const client = new CodexRpcClient(host, {
    requireExistingAppServer: true,
    skipVersionCheck: true,
  });
  const userAgent = await client.probeRuntimeVersion();
  const parsed = userAgent === null ? null : parseCodexVersion(userAgent);
  if (parsed === null) throw new ManagedRuntimeServiceError("runtime_version_unavailable");
  return {
    runtimeVersion: parsed.version,
    schemaHash: createHash("sha256")
      .update(`codex-app-server:${SUPPORTED_CODEX_VERSION}`, "utf8")
      .digest("hex"),
    capabilities: { conversations: true, turns: true, approvals: true },
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function providerConfigForUser(userId: number, runtimeId: string) {
  const model = providerStore.listForUser(userId)[0];
  if (model === undefined) return null;
  const proxyBase = process.env.RUNTIME_PROVIDER_PROXY_BASE_URL ?? "http://gateway:3100/api/internal/providers";
  const baseUrl = `${proxyBase.replace(/\/$/, "")}/${encodeURIComponent(model.providerId)}/v1`;
  return {
    providerId: model.providerId,
    modelId: model.modelId,
    baseUrl,
    wireApi: "responses" as const,
    token: issueRuntimeModelToken({
      userId,
      runtimeId,
      providerId: model.providerId,
      modelId: model.modelId,
    }),
  };
}

function auditMetadata(
  userId: number,
  runtime: UserAgentRuntimeRecord | null,
  runtimeId: string,
  status?: RuntimeStatus,
) {
  return {
    userId,
    runtimeId,
    runtimeType: runtime?.runtimeType ?? "codex-app-server",
    imageVersion: runtime?.imageVersion ?? null,
    runtimeVersion: runtime?.runtimeVersion ?? null,
    schemaHash: runtime?.schemaHash ?? null,
    runtimeStatus: status ?? runtime?.status ?? "absent",
  };
}

function requiredImageVersion(result: RuntimeLifecycleResult): string {
  if (result.imageVersion === null) {
    throw new ManagedRuntimeServiceError("runtime_manager_invalid_response");
  }
  return result.imageVersion;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof ManagedRuntimeServiceError) return error.code;
  const code = stringFromUnknown(recordFromUnknown(error)?.code);
  return code !== null && safeManagerErrorCodes.has(code) ? code : "runtime_operation_failed";
}

function positiveUserId(userId: number): number {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new ManagedRuntimeServiceError("invalid_user_id");
  }
  return userId;
}
