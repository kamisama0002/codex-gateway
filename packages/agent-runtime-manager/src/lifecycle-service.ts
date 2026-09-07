import { createHash, randomBytes } from "node:crypto";

import type { ManagedRuntimeEndpoint, RuntimeType } from "@codex-gateway/agent-runtime-contracts";

import {
  runtimeResourceLabels,
  type DockerContainerCreateSpec,
  type DockerEngine,
  type DockerSecurityPolicy,
  type EngineContainerState,
} from "./docker-engine.js";
import {
  agentRuntimeStatsResultSchema,
  runtimeManagerPolicySchema,
  type AgentRuntimeStatsResult,
  type ExecRuntimeRequest,
  type ExecRuntimeResult,
  type ProvisionRuntimeRequest,
  type RuntimeActionRequest,
  type RuntimeLifecycleResult,
  type RuntimeResourceActionRequest,
  type RuntimeResourcePolicy,
  type UpgradeRuntimeRequest,
} from "./contracts.js";
import { parseDockerContainerStats } from "./container-stats.js";

export interface RuntimeManagerPolicy {
  images: Record<string, { image: string; imageVersion: string }>;
  internalPort: number;
  networkName: string;
  resourceLabels?: Record<string, string>;
  agentMemoryBytes?: number;
  agentNanoCpus?: number;
  agentPidsLimit?: number;
}

interface RuntimeLifecycleServiceOptions {
  randomToken?: () => string;
}

export class RuntimeLifecycleError extends Error {
  constructor(
    readonly code:
      | "runtime_not_found"
      | "runtime_identity_conflict"
      | "unknown_image_alias"
      | "runtime_policy_exceeds_platform_limit",
  ) {
    super(code);
    this.name = "RuntimeLifecycleError";
  }
}

const agentIsolation: Omit<DockerSecurityPolicy, "Memory" | "NanoCpus" | "PidsLimit"> = {
  User: "10001:10001",
  ReadonlyRootfs: true,
  CapDrop: ["ALL"],
  SecurityOpt: ["no-new-privileges:true"],
  Tmpfs: { "/tmp": "rw,nosuid,nodev,noexec,size=64m" },
  Privileged: false,
};

export class RuntimeLifecycleService {
  private readonly policy: ReturnType<typeof runtimeManagerPolicySchema.parse>;
  private readonly randomToken: () => string;

  constructor(
    private readonly engine: DockerEngine,
    policy: RuntimeManagerPolicy,
    options: RuntimeLifecycleServiceOptions = {},
  ) {
    this.policy = runtimeManagerPolicySchema.parse(policy);
    this.randomToken = options.randomToken ?? (() => randomBytes(32).toString("base64url"));
  }

  async provision(request: ProvisionRuntimeRequest): Promise<RuntimeLifecycleResult> {
    this.resolveImage(request.imageAlias);
    const resources = this.resources(request.resources);
    const existing = await this.engine.findManagedContainer(request.runtimeId);
    if (existing) {
      this.assertIdentity(existing, request.userHash, request.runtimeType);
      return toResult(await this.applyResourceLimits(existing.containerId, resources));
    }
    return toResult(await this.createContainer(request, resources));
  }

  async inspect(request: RuntimeActionRequest): Promise<RuntimeLifecycleResult> {
    const container = await this.engine.findManagedContainer(request.runtimeId);
    return container ? toResult(container) : absentResult(request.runtimeId);
  }

  async stats(request: RuntimeActionRequest): Promise<AgentRuntimeStatsResult> {
    const container = await this.engine.findManagedContainer(request.runtimeId);
    if (!container) return statsResult(request.runtimeId, "absent", null);
    if (!container.running) return statsResult(request.runtimeId, "stopped", null);
    const parsed = parseDockerContainerStats(
      await this.engine.sampleContainerStats(container.containerId),
    );
    return statsResult(request.runtimeId, "running", {
      ...parsed,
      cpuQuotaCpus: cpuQuotaCpus(container.nanoCpus, parsed.onlineCpus),
    });
  }

  async exec(request: ExecRuntimeRequest): Promise<ExecRuntimeResult> {
    const container = await this.engine.findManagedContainer(request.runtimeId);
    if (!container) throw new RuntimeLifecycleError("runtime_not_found");
    if (!container.running) throw new Error("Agent runtime is not running");
    return this.engine.execInContainer(container.containerId, request.command, {
      timeoutMs: request.timeoutMs,
      maxOutputBytes: request.maxOutputBytes,
    });
  }

  async start(request: RuntimeResourceActionRequest): Promise<RuntimeLifecycleResult> {
    const resources = this.resources(request.resources);
    const container = await this.requireContainer(request.runtimeId);
    return toResult(await this.startWithResources(container, resources));
  }

  async stop(request: RuntimeActionRequest): Promise<RuntimeLifecycleResult> {
    const container = await this.requireContainer(request.runtimeId);
    if (container.running) await this.engine.stopContainer(container.containerId);
    return toResult({ ...container, running: false });
  }

  async restart(request: RuntimeResourceActionRequest): Promise<RuntimeLifecycleResult> {
    const resources = this.resources(request.resources);
    const container = await this.requireContainer(request.runtimeId);
    return toResult(await this.startWithResources(container, resources));
  }

  async upgrade(request: UpgradeRuntimeRequest): Promise<RuntimeLifecycleResult> {
    const image = this.resolveImage(request.imageAlias);
    const resources = this.resources(request.resources);
    const existing = await this.requireContainer(request.runtimeId);
    if (
      existing.imageAlias === request.imageAlias &&
      existing.imageVersion === image.imageVersion
    ) {
      return toResult(await this.applyResourceLimits(existing.containerId, resources));
    }
    if (existing.running) await this.engine.stopContainer(existing.containerId);
    await this.engine.removeContainer(existing.containerId);
    return toResult(
      await this.createContainer(
        {
          imageAlias: request.imageAlias,
          runtimeId: existing.runtimeId,
          runtimeType: existing.runtimeType,
          userHash: existing.userHash,
        },
        resources,
      ),
    );
  }

  async remove(request: RuntimeActionRequest): Promise<RuntimeLifecycleResult> {
    const container = await this.engine.findManagedContainer(request.runtimeId);
    if (!container) return absentResult(request.runtimeId);
    if (container.running) await this.engine.stopContainer(container.containerId);
    await this.engine.removeContainer(container.containerId);
    return absentResult(request.runtimeId);
  }

  private async createContainer(
    request: ProvisionRuntimeRequest,
    resources: RuntimeResourcePolicy,
  ): Promise<EngineContainerState> {
    const image = this.resolveImage(request.imageAlias);
    const runtimeHash = createHash("sha256").update(request.runtimeId).digest("hex").slice(0, 12);
    const userHashPrefix = request.userHash.slice(0, 16);
    const labels = {
      ...this.policy.resourceLabels,
      [runtimeResourceLabels.imageVersion]: image.imageVersion,
      [runtimeResourceLabels.managed]: "true",
      [runtimeResourceLabels.runtimeId]: request.runtimeId,
      [runtimeResourceLabels.runtimeType]: request.runtimeType,
      [runtimeResourceLabels.userHash]: request.userHash,
    };
    const spec: DockerContainerCreateSpec = {
      containerName: `codex-runtime-${userHashPrefix}-${runtimeHash}`,
      image: image.image,
      imageAlias: request.imageAlias,
      imageVersion: image.imageVersion,
      internalPort: this.policy.internalPort,
      labels,
      mounts: [
        {
          containerPath: "/codex-home",
          kind: "codex-home",
          labels,
          volumeName: `codex-home-${userHashPrefix}-${runtimeHash}`,
        },
        {
          containerPath: "/workspace",
          kind: "workspace",
          labels,
          volumeName: `workspace-${userHashPrefix}-${runtimeHash}`,
        },
      ],
      networkName: this.policy.networkName,
      runtimeId: request.runtimeId,
      runtimeType: request.runtimeType,
      security: this.agentSecurityPolicy(resources),
      serviceToken: this.randomToken(),
      userHash: request.userHash,
      providerConfig: request.providerConfig,
    };
    return this.engine.createManagedContainer(spec);
  }

  private agentSecurityPolicy(resources: RuntimeResourcePolicy): DockerSecurityPolicy {
    return {
      ...agentIsolation,
      Memory: resources.memoryBytes,
      NanoCpus: resources.nanoCpus,
      PidsLimit: resources.pidsLimit,
    };
  }

  private async applyResourceLimits(
    containerId: string,
    resources: RuntimeResourcePolicy,
  ): Promise<EngineContainerState> {
    return this.engine.updateContainerResources(containerId, {
      Memory: resources.memoryBytes,
      NanoCpus: resources.nanoCpus,
      PidsLimit: resources.pidsLimit,
    });
  }

  private async startWithResources(
    container: EngineContainerState,
    resources: RuntimeResourcePolicy,
  ): Promise<EngineContainerState> {
    if (container.running) await this.engine.stopContainer(container.containerId);
    await this.applyResourceLimits(container.containerId, resources);
    await this.engine.startContainer(container.containerId);
    const running = await this.requireContainer(container.runtimeId);
    if (!running.running) throw new Error("Agent runtime did not start");
    return running;
  }

  private resources(requested?: RuntimeResourcePolicy): RuntimeResourcePolicy {
    const resources = requested ?? {
      memoryBytes: this.policy.agentMemoryBytes,
      nanoCpus: this.policy.agentNanoCpus,
      pidsLimit: this.policy.agentPidsLimit,
    };
    if (
      resources.memoryBytes > this.policy.agentMemoryBytes ||
      resources.nanoCpus > this.policy.agentNanoCpus ||
      resources.pidsLimit > this.policy.agentPidsLimit
    ) {
      throw new RuntimeLifecycleError("runtime_policy_exceeds_platform_limit");
    }
    return resources;
  }

  private resolveImage(imageAlias: string): { image: string; imageVersion: string } {
    const image = Object.hasOwn(this.policy.images, imageAlias)
      ? this.policy.images[imageAlias]
      : undefined;
    if (image === undefined) throw new RuntimeLifecycleError("unknown_image_alias");
    return image;
  }

  private async requireContainer(runtimeId: string): Promise<EngineContainerState> {
    const container = await this.engine.findManagedContainer(runtimeId);
    if (!container) throw new RuntimeLifecycleError("runtime_not_found");
    return container;
  }

  private assertIdentity(
    container: EngineContainerState,
    userHash: string,
    runtimeType: RuntimeType,
  ): void {
    if (container.userHash !== userHash || container.runtimeType !== runtimeType) {
      throw new RuntimeLifecycleError("runtime_identity_conflict");
    }
  }
}

function toResult(container: EngineContainerState): RuntimeLifecycleResult {
  const endpoint: ManagedRuntimeEndpoint = {
    runtimeId: container.runtimeId,
    serviceToken: container.serviceToken,
    websocketUrl: `ws://${container.containerName}:${container.internalPort}`,
  };
  return {
    containerId: container.containerId,
    endpoint,
    imageAlias: container.imageAlias,
    imageVersion: container.imageVersion,
    runtimeId: container.runtimeId,
    status: container.running ? "running" : "stopped",
    actualResources: {
      memoryBytes: container.memoryBytes,
      nanoCpus: container.nanoCpus,
      pidsLimit: container.pidsLimit,
    },
  };
}

function absentResult(runtimeId: string): RuntimeLifecycleResult {
  return {
    containerId: null,
    endpoint: null,
    imageAlias: null,
    imageVersion: null,
    runtimeId,
    status: "absent",
    actualResources: null,
  };
}

function statsResult(
  runtimeId: string,
  status: AgentRuntimeStatsResult["status"],
  stats: AgentRuntimeStatsResult["stats"],
): AgentRuntimeStatsResult {
  return agentRuntimeStatsResultSchema.parse({ runtimeId, status, stats });
}

function cpuQuotaCpus(nanoCpus: number, onlineCpus: number) {
  return nanoCpus > 0 ? nanoCpus / 1_000_000_000 : onlineCpus;
}
