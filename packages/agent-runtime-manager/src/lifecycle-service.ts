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
  runtimeManagerPolicySchema,
  type ProvisionRuntimeRequest,
  type RuntimeActionRequest,
  type RuntimeLifecycleResult,
  type UpgradeRuntimeRequest,
} from "./contracts.js";

export interface RuntimeManagerPolicy {
  images: Record<string, { image: string; imageVersion: string }>;
  internalPort: number;
  networkName: string;
  resourceLabels?: Record<string, string>;
}

interface RuntimeLifecycleServiceOptions {
  randomToken?: () => string;
}

export class RuntimeLifecycleError extends Error {
  constructor(
    readonly code: "runtime_not_found" | "runtime_identity_conflict" | "unknown_image_alias",
  ) {
    super(code);
    this.name = "RuntimeLifecycleError";
  }
}

const securityPolicy: DockerSecurityPolicy = {
  User: "10001:10001",
  ReadonlyRootfs: true,
  CapDrop: ["ALL"],
  SecurityOpt: ["no-new-privileges:true"],
  Tmpfs: { "/tmp": "rw,nosuid,nodev,noexec,size=64m" },
  PidsLimit: 256,
  Memory: 2 * 1024 * 1024 * 1024,
  NanoCpus: 2_000_000_000,
  Privileged: false,
};

export class RuntimeLifecycleService {
  private readonly policy: RuntimeManagerPolicy;
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
    const existing = await this.engine.findManagedContainer(request.runtimeId);
    if (existing) {
      this.assertIdentity(existing, request.userHash, request.runtimeType);
      return toResult(existing);
    }
    return toResult(await this.createContainer(request));
  }

  async inspect(request: RuntimeActionRequest): Promise<RuntimeLifecycleResult> {
    const container = await this.engine.findManagedContainer(request.runtimeId);
    return container ? toResult(container) : absentResult(request.runtimeId);
  }

  async start(request: RuntimeActionRequest): Promise<RuntimeLifecycleResult> {
    const container = await this.requireContainer(request.runtimeId);
    if (!container.running) await this.engine.startContainer(container.containerId);
    return toResult({ ...container, running: true });
  }

  async stop(request: RuntimeActionRequest): Promise<RuntimeLifecycleResult> {
    const container = await this.requireContainer(request.runtimeId);
    if (container.running) await this.engine.stopContainer(container.containerId);
    return toResult({ ...container, running: false });
  }

  async restart(request: RuntimeActionRequest): Promise<RuntimeLifecycleResult> {
    const container = await this.requireContainer(request.runtimeId);
    await this.engine.restartContainer(container.containerId);
    return toResult({ ...container, running: true });
  }

  async upgrade(request: UpgradeRuntimeRequest): Promise<RuntimeLifecycleResult> {
    const image = this.resolveImage(request.imageAlias);
    const existing = await this.requireContainer(request.runtimeId);
    if (
      existing.imageAlias === request.imageAlias &&
      existing.imageVersion === image.imageVersion
    ) {
      return toResult(existing);
    }
    if (existing.running) await this.engine.stopContainer(existing.containerId);
    await this.engine.removeContainer(existing.containerId);
    return toResult(
      await this.createContainer({
        imageAlias: request.imageAlias,
        runtimeId: existing.runtimeId,
        runtimeType: existing.runtimeType,
        userHash: existing.userHash,
      }),
    );
  }

  async remove(request: RuntimeActionRequest): Promise<RuntimeLifecycleResult> {
    const container = await this.engine.findManagedContainer(request.runtimeId);
    if (!container) return absentResult(request.runtimeId);
    if (container.running) await this.engine.stopContainer(container.containerId);
    await this.engine.removeContainer(container.containerId);
    return absentResult(request.runtimeId);
  }

  private async createContainer(request: ProvisionRuntimeRequest): Promise<EngineContainerState> {
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
      security: securityPolicy,
      serviceToken: this.randomToken(),
      userHash: request.userHash,
    };
    return this.engine.createManagedContainer(spec);
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
  };
}
