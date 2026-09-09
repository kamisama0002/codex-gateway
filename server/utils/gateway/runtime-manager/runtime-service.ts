import { createHash, createHmac, randomBytes } from "node:crypto";
import { Mutex } from "async-mutex";
import pRetry, { type Options as RetryOptions } from "p-retry";
import {
  managedRuntimeStatusViewSchema,
  serializeManagedRuntimeStatus,
  type ManagedRuntimeStatus,
  type ManagedRuntimeStatusView,
  type RuntimeResourcePolicy,
  type RuntimeStatus,
  type UserAgentRuntimeRecord,
} from "@codex-gateway/agent-runtime-contracts";
import type { CapabilitySyncReason, HostRecord, ResolvedRuntimeSecret } from "~~/shared/types";
import type { AuditEventInput } from "~~/shared/types/audit";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import { recordFromUnknown, stringFromUnknown } from "~~/shared/utils/records";
import {
  createManagedRuntimeHost,
  type ManagedRuntimeRelayTarget,
} from "../infra/rpc/managed-rpc-transport";
import { CodexRpcClient } from "../infra/rpc/rpc";
import { SUPPORTED_CODEX_VERSION, parseCodexVersion } from "../infra/codex/codex-version";
import { runWithGatewayUser } from "../state/memory";
import { threadBroker } from "../runtime/broker";
import { auditStore } from "../audit/audit-store";
import { userStore } from "../auth/users";
import { runtimePolicyStore } from "./runtime-policy-store";
import type { AssignedRuntimePolicy } from "./runtime-policy";
import { runtimeStore } from "./runtime-store";
import { providerStore, type ProviderStore } from "../providers/provider-store";
import { issueRuntimeModelToken } from "../providers/runtime-token";
import { transitionRuntime, type RuntimeEvent } from "./runtime-state";
import { capabilityStore } from "../capabilities/store";
import { credentialStore } from "../credentials/store";
import { CredentialResolver } from "../credentials/resolver";
import { externalCredentialIssuerFromEnvironment } from "../credentials/external-issuer";
import { gatewayDatabase } from "../storage/database";
import {
  type AgentRuntimeStatsResult,
  type ForwardOAuthCallbackRequest,
  type ProvisionRuntimeRequest,
  type RuntimePlacementIdentity,
  type RuntimeLifecycleResult,
  type RuntimeBrowserStatus,
  type RuntimeBrowserRelayTarget,
  type SyncRuntimeSecretsRequest,
} from "./client";
import { runtimeAgentResourcesFromEnvironment } from "./runtime-node-bootstrap";
import { createRuntimePlacementStore } from "./runtime-placement-store";
import type { RuntimePlacementRecord } from "./runtime-node-types";
import { runtimeNodeClientRegistry } from "./runtime-node-client-registry";
import { runtimeIdleTimeoutMs } from "./runtime-idle-timeout";

interface RuntimeManagerPort {
  relayTarget(placement: RuntimePlacementIdentity): ManagedRuntimeRelayTarget;
  browserRelayTarget?(placement: RuntimePlacementIdentity): RuntimeBrowserRelayTarget;
  browserStatus?(placement: RuntimePlacementIdentity): Promise<RuntimeBrowserStatus>;
  provision(input: ProvisionRuntimeRequest): Promise<RuntimeLifecycleResult>;
  inspect(placement: RuntimePlacementIdentity): Promise<RuntimeLifecycleResult>;
  stats(placement: RuntimePlacementIdentity): Promise<AgentRuntimeStatsResult>;
  exec(
    input: RuntimePlacementIdentity & {
      command: string;
      timeoutMs: number;
      maxOutputBytes: number;
    },
  ): Promise<{ code: number | null; stdout: string; stderr: string }>;
  start(
    placement: RuntimePlacementIdentity,
    resources?: RuntimeResourcePolicy,
  ): Promise<RuntimeLifecycleResult>;
  stop(placement: RuntimePlacementIdentity): Promise<RuntimeLifecycleResult>;
  restart(
    placement: RuntimePlacementIdentity,
    resources?: RuntimeResourcePolicy,
  ): Promise<RuntimeLifecycleResult>;
  syncSecrets(input: SyncRuntimeSecretsRequest): Promise<RuntimeLifecycleResult>;
  remove(placement: RuntimePlacementIdentity): Promise<RuntimeLifecycleResult>;
  forwardOAuthCallback(input: ForwardOAuthCallbackRequest): Promise<void>;
}

interface RuntimeNodeClientRegistryPort {
  get(nodeId: string): Promise<RuntimeManagerPort>;
}

interface RuntimeStorePort {
  getByUserId(userId: number): Promise<UserAgentRuntimeRecord | null>;
  list(): Promise<UserAgentRuntimeRecord[]>;
  upsert(record: UserAgentRuntimeRecord): Promise<UserAgentRuntimeRecord>;
  deleteForUser(userId: number): Promise<boolean>;
}

interface AuditStorePort {
  record(input: AuditEventInput): Promise<unknown>;
}

interface RuntimePolicyStorePort {
  getByUserId(userId: number): Promise<AssignedRuntimePolicy | null>;
}

interface RuntimePlacementStorePort {
  getByUserId(userId: number): Promise<RuntimePlacementRecord | null>;
  ensurePlacement(input: {
    userId: number;
    runtimeId: string;
    workspaceKey: string;
    reservedCpuMillis: number;
    reservedMemoryBytes: number;
    reservedPids: number;
  }): Promise<RuntimePlacementRecord>;
}

interface RuntimeCompatibilitySnapshot {
  runtimeVersion: string;
  schemaHash: string;
  capabilities: Record<string, boolean>;
}

interface ManagedRuntimeServiceOptions {
  nodeClients: RuntimeNodeClientRegistryPort;
  store: RuntimeStorePort;
  placementStore: RuntimePlacementStorePort;
  audit: AuditStorePort;
  policyStore: RuntimePolicyStorePort;
  providerStore?: Pick<ProviderStore, "listForUser">;
  identitySecret: string;
  imageAlias: string;
  expectedRuntimeVersion: string;
  probe(host: HostRecord): Promise<RuntimeCompatibilitySnapshot>;
  probeRetryOptions?: RetryOptions;
  closeConnections?(userId: number): void;
  now?: () => string;
  workspaceKey?: () => string;
  defaultResources?: { cpuMillis: number; memoryBytes: number; pids: number };
  idleTimeoutMs?: number;
  usernameFor?(userId: number): Promise<string | null>;
  syncCapabilities?(
    host: HostRecord,
    input: { userId: number; projectId: number | null; reason: CapabilitySyncReason },
  ): Promise<{ status: "succeeded" | "failed" }>;
  runtimeSecretsFor?(userId: number, projectId: number | null): Promise<ResolvedRuntimeSecret[]>;
}

const defaultProbeRetryOptions: RetryOptions = {
  retries: 10,
  minTimeout: 250,
  maxTimeout: 2_000,
  factor: 1.5,
};

const safeManagerErrorCodes = new Set([
  "internal_error",
  "invalid_project_id",
  "invalid_request",
  "runtime_identity_conflict",
  "runtime_manager_invalid_response",
  "runtime_manager_request_failed",
  "runtime_manager_timeout",
  "runtime_manager_unavailable",
  "runtime_node_disabled",
  "runtime_node_invalid_configuration",
  "runtime_node_not_found",
  "runtime_node_registry_unavailable",
  "stale_placement_generation",
  "runtime_policy_exceeds_platform_limit",
  "managed_rpc_handshake_timeout",
  "runtime_not_found",
  "runtime_not_ready",
  "runtime_browser_unavailable",
  "unauthorized",
  "unknown_image_alias",
  "capability_sync_failed",
  "credential_sync_failed",
  "oauth_callback_failed",
]);

export class ManagedRuntimeServiceError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode = 502,
    message = code,
  ) {
    super(message);
    this.name = "ManagedRuntimeServiceError";
  }
}

export class ManagedRuntimeService {
  private readonly locks = new Map<number, Mutex>();
  private readonly now: () => string;
  private readonly workspaceKey: () => string;
  private readonly defaultResources: { cpuMillis: number; memoryBytes: number; pids: number };
  private readonly idleTimeoutMs: number;

  constructor(private readonly options: ManagedRuntimeServiceOptions) {
    if (options.identitySecret.length === 0) throw new Error("Runtime identity secret is required");
    if (options.imageAlias.length === 0) throw new Error("Runtime image alias is required");
    if (options.expectedRuntimeVersion.length === 0) {
      throw new Error("Expected runtime version is required");
    }
    this.now = options.now ?? (() => new Date().toISOString());
    this.workspaceKey = options.workspaceKey ?? (() => `ws__${randomBytes(16).toString("hex")}`);
    this.defaultResources = options.defaultResources ?? {
      cpuMillis: 4_000,
      memoryBytes: 8 * 1024 * 1024 * 1024,
      pids: 1_024,
    };
    this.idleTimeoutMs = options.idleTimeoutMs ?? runtimeIdleTimeoutMs();
  }

  async getStatus(userId: number): Promise<ManagedRuntimeStatus | null> {
    const runtime = await this.options.store.getByUserId(positiveUserId(userId));
    return runtime === null ? null : serializeManagedRuntimeStatus(runtime);
  }

  async getStatusView(userId: number): Promise<ManagedRuntimeStatusView> {
    const targetUserId = positiveUserId(userId);
    const [runtime, policy] = await Promise.all([
      this.options.store.getByUserId(targetUserId),
      this.options.policyStore.getByUserId(targetUserId),
    ]);
    return await this.statusView(runtime, policy);
  }

  async listStatusViews(): Promise<ManagedRuntimeStatusView[]> {
    const runtimes = await this.options.store.list();
    return await Promise.all(
      runtimes.map(
        async (runtime) =>
          await this.statusView(
            runtime,
            await this.options.policyStore.getByUserId(runtime.userId),
          ),
      ),
    );
  }

  async listStatuses(): Promise<Array<ManagedRuntimeStatus & { username: string }>> {
    const runtimes = await this.options.store.list();
    return await Promise.all(
      runtimes.map(async (runtime) => ({
        ...serializeManagedRuntimeStatus(runtime),
        username: (await this.options.usernameFor?.(runtime.userId)) ?? `user-${runtime.userId}`,
      })),
    );
  }

  async releaseIdleRuntimes(nowMs = Date.parse(this.now())): Promise<number[]> {
    if (!Number.isFinite(nowMs)) return [];
    const released: number[] = [];
    for (const runtime of await this.options.store.list()) {
      if (runtime.status !== "ready") continue;
      const policy = await this.options.policyStore.getByUserId(runtime.userId);
      const idleTimeoutMs =
        policy?.idleTimeoutMinutes === null || policy?.idleTimeoutMinutes === undefined
          ? this.idleTimeoutMs
          : policy.idleTimeoutMinutes * 60_000;
      if (idleTimeoutMs === 0) continue;
      const updatedAtMs = Date.parse(runtime.updatedAt);
      if (!Number.isFinite(updatedAtMs) || nowMs - updatedAtMs < idleTimeoutMs) continue;
      try {
        await this.stop(runtime.userId, runtime.userId);
        released.push(runtime.userId);
      } catch (error) {
        console.error("[gateway-runtime] idle runtime release failed", {
          userId: runtime.userId,
          code: safeErrorCode(error),
        });
      }
    }
    return released;
  }

  async sampleAgentStats(userId: number): Promise<AgentRuntimeStatsResult> {
    const placement = await this.requiredPlacement(positiveUserId(userId));
    return await (await this.managerForPlacement(placement)).stats(managerPlacement(placement));
  }

  async execAgentCommand(
    userId: number,
    command: string,
    options: { timeoutMs: number; maxOutputBytes: number },
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const placement = await this.requiredPlacement(positiveUserId(userId));
    return await (
      await this.managerForPlacement(placement)
    )
      .exec({
        ...managerPlacement(placement),
        command,
        timeoutMs: options.timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
      })
      .catch((error: unknown) => {
        throw new ManagedRuntimeServiceError(safeErrorCode(error));
      });
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
      const runtime = await this.requiredRuntime(targetUserId);
      const placement = await this.requiredPlacement(targetUserId);
      let result: RuntimeLifecycleResult;
      try {
        const manager = await this.managerForPlacement(placement);
        this.options.closeConnections?.(targetUserId);
        result = await manager.stop(managerPlacement(placement));
        this.assertRuntimeResult(placement.runtimeId, result, "stopped");
        requiredImageVersion(result);
      } catch (error) {
        const code = safeErrorCode(error);
        const degraded = await this.persist(runtime, "degraded", { lastError: code });
        await this.auditFailure(
          "runtime.stop",
          actor,
          targetUserId,
          degraded,
          placement.runtimeId,
          code,
        );
        throw new ManagedRuntimeServiceError(code);
      }
      const stopped = await this.persist(runtime, "degraded", {
        containerId: result.containerId,
        imageVersion: requiredImageVersion(result),
        lastError: "runtime_stopped",
      });
      await this.auditSuccess("runtime.stop", actor, targetUserId, stopped, placement.runtimeId);
      return serializeManagedRuntimeStatus(stopped);
    });
  }

  restart(userId: number, actorUserId = userId): Promise<ManagedRuntimeStatus> {
    const targetUserId = positiveUserId(userId);
    const actor = positiveUserId(actorUserId);
    return this.lockFor(targetUserId).runExclusive(async () => {
      const policy = await this.options.policyStore.getByUserId(targetUserId);
      const resources = policy === null ? undefined : managerResources(policy);
      let runtime = await this.requiredRuntime(targetUserId);
      const placement = await this.requiredPlacement(targetUserId);
      const identity = this.identity(targetUserId);
      runtime = await this.persistTransition(runtime, "restart");
      let endpoint: ManagedRuntimeRelayTarget;
      let restarted: RuntimeLifecycleResult;
      try {
        const manager = await this.managerForPlacement(placement);
        this.options.closeConnections?.(targetUserId);
        if (this.options.runtimeSecretsFor !== undefined) {
          const provisioned = await manager.provision(
            await this.provisionRequest(targetUserId, identity.userHash, placement, policy),
          );
          this.assertRuntimeResult(placement.runtimeId, provisioned);
          requiredImageVersion(provisioned);
        }
        restarted =
          resources === undefined
            ? await manager.restart(managerPlacement(placement))
            : await manager.restart(managerPlacement(placement), resources);
        endpoint = this.runningEndpoint(manager, managerPlacement(placement), restarted);
        requiredImageVersion(restarted);
      } catch (error) {
        const code = safeErrorCode(error);
        const degraded = await this.persistTransition(runtime, "restartFailed", {
          lastError: code,
        });
        await this.auditFailure(
          "runtime.restart",
          actor,
          targetUserId,
          degraded,
          placement.runtimeId,
          code,
        );
        throw new ManagedRuntimeServiceError(code);
      }
      runtime = await this.persistTransition(runtime, "start", {
        containerId: restarted.containerId,
        imageVersion: requiredImageVersion(restarted),
        lastError: null,
      });
      await this.auditSuccess("runtime.restart", actor, targetUserId, runtime, placement.runtimeId);
      return serializeManagedRuntimeStatus(
        await this.finishCompatibility(
          runtime,
          endpoint,
          actor,
          placement.runtimeId,
          "runtimeRestart",
        ),
      );
    });
  }

  syncSecrets(
    userId: number,
    projectId: number | null,
    actorUserId = userId,
  ): Promise<ManagedRuntimeStatus> {
    const targetUserId = positiveUserId(userId);
    const targetProjectId = nullableProjectId(projectId);
    const actor = positiveUserId(actorUserId);
    return this.lockFor(targetUserId).runExclusive(async () => {
      const runtime = await this.requiredRuntime(targetUserId);
      if (runtime.status !== "ready") throw new ManagedRuntimeServiceError("runtime_not_ready");
      const placement = await this.requiredPlacement(targetUserId);
      try {
        const manager = await this.managerForPlacement(placement);
        const runtimeSecrets =
          (await this.options.runtimeSecretsFor?.(targetUserId, targetProjectId)) ?? [];
        if (runtimeSecrets.some((secret) => secret.target.type === "env")) {
          this.options.closeConnections?.(targetUserId);
        }
        const result = await manager.syncSecrets({
          ...managerPlacement(placement),
          runtimeSecrets,
        });
        const endpoint = this.runningEndpoint(manager, managerPlacement(placement), result);
        const host = createManagedRuntimeHost(targetUserId, runtime, endpoint);
        await pRetry(() => this.options.probe(host), {
          ...defaultProbeRetryOptions,
          ...this.options.probeRetryOptions,
        });
        const sync = await this.options.syncCapabilities?.(host, {
          userId: targetUserId,
          projectId: targetProjectId,
          reason: "credentialRotated",
        });
        if (sync?.status === "failed") throw new Error("Capability sync did not converge");
        await this.auditSuccess(
          "runtime.credentials.sync",
          actor,
          targetUserId,
          runtime,
          placement.runtimeId,
        );
        return serializeManagedRuntimeStatus(runtime);
      } catch {
        const code = "credential_sync_failed";
        const degraded = await this.persistTransition(runtime, "runtimeFailed", {
          lastError: code,
        });
        await this.auditFailure(
          "runtime.credentials.sync",
          actor,
          targetUserId,
          degraded,
          placement.runtimeId,
          code,
        );
        throw new ManagedRuntimeServiceError(code);
      }
    });
  }

  remove(userId: number, actorUserId = userId): Promise<null> {
    const targetUserId = positiveUserId(userId);
    const actor = positiveUserId(actorUserId);
    return this.lockFor(targetUserId).runExclusive(async () => {
      const runtime = await this.options.store.getByUserId(targetUserId);
      const placement = await this.options.placementStore.getByUserId(targetUserId);
      if (placement === null) {
        await this.options.store.deleteForUser(targetUserId);
        return null;
      }
      let result: RuntimeLifecycleResult;
      try {
        const manager = await this.managerForPlacement(placement);
        this.options.closeConnections?.(targetUserId);
        result = await manager.remove(managerPlacement(placement));
        this.assertRuntimeResult(placement.runtimeId, result, "absent");
      } catch (error) {
        const code = safeErrorCode(error);
        const basis = runtime ?? (await this.createRuntime(targetUserId, "degraded"));
        const degraded = await this.persist(basis, "degraded", { lastError: code });
        await this.auditFailure(
          "runtime.remove",
          actor,
          targetUserId,
          degraded,
          placement.runtimeId,
          code,
        );
        throw new ManagedRuntimeServiceError(code);
      }
      if (runtime !== null && runtime.status !== "absent") {
        await this.persistTransition(runtime, "remove", {
          containerId: null,
          lastError: null,
        });
      }
      await this.options.store.deleteForUser(targetUserId);
      await this.auditSuccess(
        "runtime.remove",
        actor,
        targetUserId,
        runtime,
        placement.runtimeId,
        "absent",
      );
      return null;
    });
  }

  async resolveManagedHost(userId: number): Promise<HostRecord> {
    const targetUserId = positiveUserId(userId);
    const runtime = await this.requiredRuntime(targetUserId);
    if (runtime.status !== "ready") throw new ManagedRuntimeServiceError("runtime_not_ready");
    const placement = await this.requiredPlacement(targetUserId);
    let result: RuntimeLifecycleResult;
    try {
      const manager = await this.managerForPlacement(placement);
      result = await manager.inspect(managerPlacement(placement));
      const endpoint = this.runningEndpoint(manager, managerPlacement(placement), result);
      await this.touchActivity(runtime);
      return createManagedRuntimeHost(targetUserId, runtime, endpoint);
    } catch (error) {
      throw new ManagedRuntimeServiceError(safeErrorCode(error));
    }
  }

  async resolveBrowser(userId: number): Promise<{
    runtimeId: string;
    nodeId: string;
    placementGeneration: number;
    relayTarget: RuntimeBrowserRelayTarget;
  }> {
    const targetUserId = positiveUserId(userId);
    const runtime = await this.requiredRuntime(targetUserId);
    if (runtime.status !== "ready") throw new ManagedRuntimeServiceError("runtime_not_ready");
    const placement = await this.requiredPlacement(targetUserId);
    try {
      const manager = await this.managerForPlacement(placement);
      if (manager.browserStatus === undefined || manager.browserRelayTarget === undefined) {
        throw new ManagedRuntimeServiceError("runtime_browser_unavailable", 503);
      }
      const status = await manager.browserStatus(managerPlacement(placement));
      if (status.status !== "running" || status.browser !== "ready") {
        throw new ManagedRuntimeServiceError("runtime_browser_unavailable", 503);
      }
      return {
        runtimeId: placement.runtimeId,
        nodeId: placement.runtimeNodeId,
        placementGeneration: placement.placementGeneration,
        relayTarget: manager.browserRelayTarget(managerPlacement(placement)),
      };
    } catch (error) {
      if (error instanceof ManagedRuntimeServiceError) throw error;
      throw new ManagedRuntimeServiceError(safeErrorCode(error));
    }
  }

  runtimeIdForUser(userId: number) {
    return this.identity(positiveUserId(userId)).runtimeId;
  }

  forwardOAuthCallback(userId: number, pathAndQuery: string): Promise<void> {
    const targetUserId = positiveUserId(userId);
    return this.lockFor(targetUserId).runExclusive(async () => {
      await this.requiredRuntime(targetUserId);
      const placement = await this.requiredPlacement(targetUserId);
      try {
        await (
          await this.managerForPlacement(placement)
        ).forwardOAuthCallback({
          ...managerPlacement(placement),
          pathAndQuery,
        });
      } catch {
        throw new ManagedRuntimeServiceError("oauth_callback_failed");
      }
    });
  }

  private async startLocked(userId: number, actorUserId: number): Promise<ManagedRuntimeStatus> {
    const identity = this.identity(userId);
    const policy = await this.options.policyStore.getByUserId(userId);
    const resources = policy === null ? undefined : managerResources(policy);
    const existing = await this.options.store.getByUserId(userId);
    if (existing?.status === "ready") {
      try {
        const placement = await this.requiredPlacement(userId);
        const manager = await this.managerForPlacement(placement);
        const inspected = await manager.inspect(managerPlacement(placement));
        this.runningEndpoint(manager, managerPlacement(placement), inspected);
        return serializeManagedRuntimeStatus(existing);
      } catch {
        await this.persist(existing, "degraded", { lastError: "runtime_not_ready" });
      }
    }

    let runtime = await this.options.store.getByUserId(userId);
    if (runtime === null) {
      runtime = await this.createRuntime(userId, "provisioning");
    } else if (
      runtime.status === "absent" ||
      runtime.status === "degraded" ||
      runtime.status === "incompatible"
    ) {
      runtime = await this.persistTransition(runtime, "provision", { lastError: null });
    } else if (runtime.status !== "provisioning") {
      runtime = await this.persist(runtime, "provisioning", { lastError: null });
    }
    const placement = await this.ensurePlacement(userId, identity.runtimeId, policy);

    let provisioned: RuntimeLifecycleResult;
    let manager: RuntimeManagerPort;
    try {
      manager = await this.managerForPlacement(placement);
      provisioned = await manager.provision(
        await this.provisionRequest(userId, identity.userHash, placement, policy),
      );
      this.assertRuntimeResult(placement.runtimeId, provisioned);
      runtime = await this.persist(runtime, "provisioning", {
        containerId: provisioned.containerId,
        imageVersion: requiredImageVersion(provisioned),
        lastError: null,
      });
      await this.auditSuccess(
        "runtime.provision",
        actorUserId,
        userId,
        runtime,
        placement.runtimeId,
      );
    } catch (error) {
      const code = safeErrorCode(error);
      const degraded = await this.persistTransition(runtime, "provisionFailed", {
        lastError: code,
      });
      await this.auditFailure(
        "runtime.provision",
        actorUserId,
        userId,
        degraded,
        placement.runtimeId,
        code,
      );
      throw new ManagedRuntimeServiceError(code);
    }

    let endpoint: ManagedRuntimeRelayTarget;
    let started: RuntimeLifecycleResult;
    try {
      started =
        resources === undefined
          ? await manager.start(managerPlacement(placement))
          : await manager.start(managerPlacement(placement), resources);
      endpoint = this.runningEndpoint(manager, managerPlacement(placement), started);
      requiredImageVersion(started);
    } catch (error) {
      const code = safeErrorCode(error);
      const degraded = await this.persist(runtime, "degraded", { lastError: code });
      await this.auditFailure(
        "runtime.start",
        actorUserId,
        userId,
        degraded,
        placement.runtimeId,
        code,
      );
      throw new ManagedRuntimeServiceError(code);
    }
    runtime = await this.persistTransition(runtime, "start", {
      containerId: started.containerId,
      imageVersion: requiredImageVersion(started),
      lastError: null,
    });
    await this.auditSuccess("runtime.start", actorUserId, userId, runtime, placement.runtimeId);
    return serializeManagedRuntimeStatus(
      await this.finishCompatibility(
        runtime,
        endpoint,
        actorUserId,
        placement.runtimeId,
        "runtimeStart",
      ),
    );
  }

  private async finishCompatibility(
    runtime: UserAgentRuntimeRecord,
    endpoint: ManagedRuntimeRelayTarget,
    actorUserId: number,
    runtimeId: string,
    reason: "runtimeStart" | "runtimeRestart",
  ): Promise<UserAgentRuntimeRecord> {
    let snapshot: RuntimeCompatibilitySnapshot;
    try {
      const host = createManagedRuntimeHost(runtime.userId, runtime, endpoint);
      snapshot = await pRetry(() => this.options.probe(host), {
        ...defaultProbeRetryOptions,
        ...this.options.probeRetryOptions,
      });
    } catch (error) {
      const code = safeErrorCode(error);
      const degraded = await this.persist(runtime, "degraded", { lastError: code });
      await this.auditFailure(
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
      const incompatible = await this.persistTransition(runtime, "schemaMismatch", {
        runtimeVersion: snapshot.runtimeVersion,
        schemaHash: snapshot.schemaHash,
        lastError: code,
      });
      await this.auditFailure(
        "runtime.compatibility",
        actorUserId,
        runtime.userId,
        incompatible,
        runtimeId,
        code,
      );
      throw new ManagedRuntimeServiceError(code);
    }
    const syncing = await this.persistTransition(runtime, "schemaOk", {
      runtimeVersion: snapshot.runtimeVersion,
      schemaHash: snapshot.schemaHash,
      lastError: null,
    });
    if (this.options.syncCapabilities !== undefined) {
      const host = createManagedRuntimeHost(runtime.userId, syncing, endpoint);
      try {
        const result = await this.options.syncCapabilities(host, {
          userId: runtime.userId,
          projectId: null,
          reason,
        });
        if (result.status !== "succeeded") throw new Error("Capability sync did not converge");
      } catch {
        const code = "capability_sync_failed";
        const degraded = await this.persistTransition(syncing, "runtimeFailed", {
          lastError: code,
        });
        await this.auditFailure(
          "runtime.capabilities",
          actorUserId,
          runtime.userId,
          degraded,
          runtimeId,
          code,
        );
        throw new ManagedRuntimeServiceError(code);
      }
    }
    return await this.persistTransition(syncing, "capabilitiesOk");
  }

  private async createRuntime(
    userId: number,
    status: RuntimeStatus,
  ): Promise<UserAgentRuntimeRecord> {
    const timestamp = this.now();
    return await this.options.store.upsert({
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

  private async persistTransition(
    runtime: UserAgentRuntimeRecord,
    event: RuntimeEvent,
    changes: Partial<UserAgentRuntimeRecord> = {},
  ): Promise<UserAgentRuntimeRecord> {
    return await this.persist(runtime, transitionRuntime(runtime.status, event), changes);
  }

  private async persist(
    runtime: UserAgentRuntimeRecord,
    status: RuntimeStatus,
    changes: Partial<UserAgentRuntimeRecord> = {},
  ): Promise<UserAgentRuntimeRecord> {
    return await this.options.store.upsert({
      ...runtime,
      ...changes,
      userId: runtime.userId,
      hostId: MANAGED_RUNTIME_HOST_ID,
      runtimeType: "codex-app-server",
      status,
      updatedAt: this.now(),
    });
  }

  private async touchActivity(runtime: UserAgentRuntimeRecord) {
    return await this.options.store.upsert({ ...runtime, updatedAt: this.now() });
  }

  private async requiredRuntime(userId: number): Promise<UserAgentRuntimeRecord> {
    const runtime = await this.options.store.getByUserId(userId);
    if (runtime === null) throw new ManagedRuntimeServiceError("runtime_not_found");
    return runtime;
  }

  private async requiredPlacement(userId: number): Promise<RuntimePlacementRecord> {
    const placement = await this.options.placementStore.getByUserId(userId);
    if (placement === null) throw new ManagedRuntimeServiceError("runtime_not_found");
    return placement;
  }

  private async ensurePlacement(
    userId: number,
    runtimeId: string,
    policy: AssignedRuntimePolicy | null,
  ) {
    const resources =
      policy === null
        ? this.defaultResources
        : {
            cpuMillis: policy.cpuMillicores,
            memoryBytes: policy.memoryMiB * 1024 * 1024,
            pids: policy.pidsLimit,
          };
    return await this.options.placementStore.ensurePlacement({
      userId,
      runtimeId,
      workspaceKey: this.workspaceKey(),
      reservedCpuMillis: resources.cpuMillis,
      reservedMemoryBytes: resources.memoryBytes,
      reservedPids: resources.pids,
    });
  }

  private identity(userId: number) {
    const userHash = createHmac("sha256", this.options.identitySecret)
      .update(`codex-runtime-user:${userId}`)
      .digest("hex");
    return { userHash, runtimeId: `codex_${userHash.slice(0, 32)}` };
  }

  private async provisionRequest(
    userId: number,
    userHash: string,
    placement: RuntimePlacementRecord,
    policy: AssignedRuntimePolicy | null,
  ): Promise<ProvisionRuntimeRequest> {
    const request: ProvisionRuntimeRequest = {
      ...managerPlacement(placement),
      workspaceKey: placement.workspaceKey,
      userHash,
      runtimeType: "codex-app-server",
      imageAlias: policy?.imageAlias ?? this.options.imageAlias,
    };
    if (policy !== null) request.resources = managerResources(policy);
    const providerConfig = await providerConfigForUser(
      userId,
      placement.runtimeId,
      this.options.providerStore ?? providerStore,
    );
    if (providerConfig !== null) request.providerConfig = providerConfig;
    const runtimeSecrets = await this.options.runtimeSecretsFor?.(userId, null);
    if (runtimeSecrets !== undefined) request.runtimeSecrets = runtimeSecrets;
    return request;
  }

  private async statusView(
    runtime: UserAgentRuntimeRecord | null,
    policy: AssignedRuntimePolicy | null,
  ): Promise<ManagedRuntimeStatusView> {
    let actualResources: RuntimeResourcePolicy | null = null;
    let currentImageAlias: string | null = null;
    if (runtime !== null) {
      try {
        const placement = await this.requiredPlacement(runtime.userId);
        const manager = await this.managerForPlacement(placement);
        const inspected = await manager.inspect(managerPlacement(placement));
        this.assertRuntimeResult(placement.runtimeId, inspected);
        actualResources = inspected.actualResources;
        currentImageAlias = inspected.imageAlias;
      } catch {
        // The stored lifecycle status remains authoritative while inspection is unavailable.
      }
    }

    const assignedPolicy =
      policy === null
        ? null
        : {
            imageAlias: policy.imageAlias,
            memoryMiB: policy.memoryMiB,
            cpuCores: policy.cpuMillicores / 1000,
            pidsLimit: policy.pidsLimit,
            idleTimeoutMinutes: policy.idleTimeoutMinutes,
          };
    const expectedResources = policy === null ? null : managerResources(policy);
    return managedRuntimeStatusViewSchema.parse({
      runtime: runtime === null ? null : serializeManagedRuntimeStatus(runtime),
      assignedPolicy,
      actualResources,
      currentImageAlias,
      requiresRestart:
        expectedResources !== null && actualResources !== null
          ? !sameResources(expectedResources, actualResources)
          : false,
      requiresUpgrade:
        policy !== null && currentImageAlias !== null
          ? policy.imageAlias !== currentImageAlias
          : false,
    });
  }

  private runningEndpoint(
    manager: RuntimeManagerPort,
    placement: RuntimePlacementIdentity,
    result: RuntimeLifecycleResult,
  ): ManagedRuntimeRelayTarget {
    this.assertRuntimeResult(placement.runtimeId, result, "running");
    return manager.relayTarget(placement);
  }

  private async managerForPlacement(placement: RuntimePlacementRecord) {
    return await this.options.nodeClients.get(placement.runtimeNodeId);
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

  private async auditSuccess(
    action: string,
    actorUserId: number,
    userId: number,
    runtime: UserAgentRuntimeRecord | null,
    runtimeId: string,
    status?: RuntimeStatus,
  ): Promise<void> {
    await this.options.audit.record({
      actorUserId,
      userId,
      action,
      outcome: "success",
      metadata: auditMetadata(userId, runtime, runtimeId, status),
    });
  }

  private async auditFailure(
    action: string,
    actorUserId: number,
    userId: number,
    runtime: UserAgentRuntimeRecord | null,
    runtimeId: string,
    errorCode: string,
  ): Promise<void> {
    try {
      await this.options.audit.record({
        actorUserId,
        userId,
        action,
        outcome: "failure",
        errorCode,
        metadata: auditMetadata(userId, runtime, runtimeId),
      });
    } catch {
      console.error("[gateway-runtime] failed to record audit event", { action, errorCode });
    }
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
  getStatusView(userId: number) {
    return defaultRuntimeService().getStatusView(userId);
  },
  listStatusViews() {
    return defaultRuntimeService().listStatusViews();
  },
  listStatuses() {
    return defaultRuntimeService().listStatuses();
  },
  sampleAgentStats(userId: number) {
    return defaultRuntimeService().sampleAgentStats(userId);
  },
  execAgentCommand(
    userId: number,
    command: string,
    options: { timeoutMs: number; maxOutputBytes: number },
  ) {
    return defaultRuntimeService().execAgentCommand(userId, command, options);
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
  syncSecrets(userId: number, projectId: number | null, actorUserId = userId) {
    return defaultRuntimeService().syncSecrets(userId, projectId, actorUserId);
  },
  remove(userId: number, actorUserId = userId) {
    return defaultRuntimeService().remove(userId, actorUserId);
  },
  resolveManagedHost(userId: number) {
    return defaultRuntimeService().resolveManagedHost(userId);
  },
  releaseIdleRuntimes(nowMs?: number) {
    return defaultRuntimeService().releaseIdleRuntimes(nowMs);
  },
  resolveBrowser(userId: number) {
    return defaultRuntimeService().resolveBrowser(userId);
  },
  runtimeIdForUser(userId: number) {
    return defaultRuntimeService().runtimeIdForUser(userId);
  },
  forwardOAuthCallback(userId: number, pathAndQuery: string) {
    return defaultRuntimeService().forwardOAuthCallback(userId, pathAndQuery);
  },
};

function defaultRuntimeService(): ManagedRuntimeService {
  if (productionRuntimeService !== null) return productionRuntimeService;
  productionRuntimeService = new ManagedRuntimeService({
    nodeClients: runtimeNodeClientRegistry,
    store: runtimeStore,
    placementStore: createRuntimePlacementStore(gatewayDatabase()),
    audit: auditStore,
    policyStore: runtimePolicyStore,
    identitySecret: requiredEnvironment("RUNTIME_IDENTITY_SECRET"),
    defaultResources: runtimeAgentResourcesFromEnvironment(),
    imageAlias: requiredEnvironment("RUNTIME_MANAGER_DEFAULT_IMAGE_ALIAS"),
    expectedRuntimeVersion: SUPPORTED_CODEX_VERSION,
    idleTimeoutMs: runtimeIdleTimeoutMs(),
    probe: probeManagedCodexRuntime,
    closeConnections: (userId) =>
      runWithGatewayUser(userId, () => threadBroker.closeHost(MANAGED_RUNTIME_HOST_ID)),
    usernameFor: (userId) => userStore.findUsername(userId),
    runtimeSecretsFor: async (userId, projectId) => {
      const capabilities = await capabilityStore.listDesiredForContext({
        userId,
        projectId,
      });
      return await new CredentialResolver(
        credentialStore,
        Date.now,
        externalCredentialIssuerFromEnvironment(),
      ).resolveForRuntime(
        { userId, projectId },
        capabilities.map((capability) => capability.id),
      );
    },
    syncCapabilities: async (host, input) => {
      const { reconcileUserRuntimeWithHost } = await import("../capabilities/reconciler");
      return await reconcileUserRuntimeWithHost(host, input);
    },
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

async function providerConfigForUser(
  userId: number,
  runtimeId: string,
  store: Pick<ProviderStore, "listForUser">,
) {
  const model = (await store.listForUser(userId))[0];
  if (model === undefined) return null;
  const proxyBase =
    process.env.RUNTIME_PROVIDER_PROXY_BASE_URL ??
    "http://codex-gateway:3000/api/internal/providers";
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

function managerResources(policy: AssignedRuntimePolicy): RuntimeResourcePolicy {
  return {
    memoryBytes: policy.memoryMiB * 1024 * 1024,
    nanoCpus: policy.cpuMillicores * 1_000_000,
    pidsLimit: policy.pidsLimit,
  };
}

function sameResources(left: RuntimeResourcePolicy, right: RuntimeResourcePolicy): boolean {
  return (
    left.memoryBytes === right.memoryBytes &&
    left.nanoCpus === right.nanoCpus &&
    left.pidsLimit === right.pidsLimit
  );
}

function managerPlacement(placement: RuntimePlacementRecord): RuntimePlacementIdentity {
  return {
    runtimeId: placement.runtimeId,
    nodeId: placement.runtimeNodeId,
    placementGeneration: placement.placementGeneration,
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

function nullableProjectId(value: number | null) {
  if (value === null) return null;
  if (!Number.isInteger(value) || value <= 0) {
    throw new ManagedRuntimeServiceError("invalid_project_id", 400);
  }
  return value;
}
