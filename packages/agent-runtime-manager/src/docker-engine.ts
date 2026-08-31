import type { RuntimeType } from "@codex-gateway/agent-runtime-contracts";
import { runtimeTypeSchema } from "@codex-gateway/agent-runtime-contracts";
import Docker from "dockerode";

export const runtimeResourceLabels = {
  imageVersion: "com.codex-gateway.image-version",
  managed: "com.codex-gateway.managed",
  runtimeId: "com.codex-gateway.runtime-id",
  runtimeType: "com.codex-gateway.runtime-type",
  userHash: "com.codex-gateway.user-hash",
} as const;

export interface DockerSecurityPolicy {
  User: "10001:10001";
  ReadonlyRootfs: true;
  CapDrop: ["ALL"];
  SecurityOpt: ["no-new-privileges:true"];
  PidsLimit: number;
  Memory: number;
  NanoCpus: number;
  Privileged: false;
}

export interface DockerManagedVolumeSpec {
  kind: "codex-home" | "workspace";
  volumeName: string;
  containerPath: string;
  labels: Record<string, string>;
}

export interface DockerContainerCreateSpec {
  containerName: string;
  image: string;
  imageAlias: string;
  imageVersion: string;
  internalPort: number;
  labels: Record<string, string>;
  mounts: DockerManagedVolumeSpec[];
  networkName: string;
  runtimeId: string;
  runtimeType: RuntimeType;
  security: DockerSecurityPolicy;
  serviceToken: string;
  userHash: string;
}

export interface EngineContainerState {
  containerId: string;
  containerName: string;
  imageAlias: string;
  imageVersion: string;
  internalPort: number;
  running: boolean;
  runtimeId: string;
  runtimeType: RuntimeType;
  serviceToken: string;
  userHash: string;
}

export interface DockerEngine {
  findManagedContainer(runtimeId: string): Promise<EngineContainerState | null>;
  createManagedContainer(spec: DockerContainerCreateSpec): Promise<EngineContainerState>;
  startContainer(containerId: string): Promise<void>;
  stopContainer(containerId: string): Promise<void>;
  restartContainer(containerId: string): Promise<void>;
  removeContainer(containerId: string): Promise<void>;
}

export class DockerodeEngine implements DockerEngine {
  constructor(private readonly docker: Docker = new Docker()) {}

  async findManagedContainer(runtimeId: string): Promise<EngineContainerState | null> {
    const matches = await this.docker.listContainers({
      all: true,
      filters: {
        label: [
          `${runtimeResourceLabels.managed}=true`,
          `${runtimeResourceLabels.runtimeId}=${runtimeId}`,
        ],
      },
    });
    const match = matches[0];
    return match === undefined ? null : this.inspectContainer(match.Id);
  }

  async createManagedContainer(spec: DockerContainerCreateSpec): Promise<EngineContainerState> {
    for (const mount of spec.mounts) await this.ensureManagedVolume(mount);

    const exposedPort = `${spec.internalPort}/tcp`;
    const container = await this.docker.createContainer({
      name: spec.containerName,
      Image: spec.image,
      User: spec.security.User,
      Labels: spec.labels,
      Env: [
        "CODEX_HOME=/home/codex/.codex",
        "CODEX_WORKSPACE=/workspace",
        `CODEX_APP_SERVER_PORT=${spec.internalPort}`,
        `CODEX_APP_SERVER_TOKEN=${spec.serviceToken}`,
        `CODEX_RUNTIME_IMAGE_ALIAS=${spec.imageAlias}`,
      ],
      ExposedPorts: { [exposedPort]: {} },
      HostConfig: {
        Binds: spec.mounts.map((mount) => `${mount.volumeName}:${mount.containerPath}`),
        CapDrop: spec.security.CapDrop,
        Memory: spec.security.Memory,
        NanoCpus: spec.security.NanoCpus,
        NetworkMode: spec.networkName,
        PidsLimit: spec.security.PidsLimit,
        Privileged: spec.security.Privileged,
        ReadonlyRootfs: spec.security.ReadonlyRootfs,
        SecurityOpt: spec.security.SecurityOpt,
      },
      NetworkingConfig: { EndpointsConfig: { [spec.networkName]: {} } },
    });
    return this.inspectContainer(container.id);
  }

  async startContainer(containerId: string): Promise<void> {
    await this.docker.getContainer(containerId).start();
  }

  async stopContainer(containerId: string): Promise<void> {
    await this.docker.getContainer(containerId).stop({ t: 30 });
  }

  async restartContainer(containerId: string): Promise<void> {
    await this.docker.getContainer(containerId).restart({ t: 30 });
  }

  async removeContainer(containerId: string): Promise<void> {
    await this.docker.getContainer(containerId).remove({ force: false, v: false });
  }

  private async ensureManagedVolume(spec: DockerManagedVolumeSpec): Promise<void> {
    try {
      const existing = await this.docker.getVolume(spec.volumeName).inspect();
      // Docker volume labels are immutable. The image-version label records the version that
      // created the persistent data; identity labels must still match on every later upgrade.
      const identityLabels = [
        runtimeResourceLabels.managed,
        runtimeResourceLabels.runtimeId,
        runtimeResourceLabels.runtimeType,
        runtimeResourceLabels.userHash,
      ];
      for (const key of identityLabels) {
        const expectedValue = spec.labels[key];
        if (existing.Labels?.[key] !== expectedValue) {
          throw new Error("managed volume label mismatch");
        }
      }
      if (!existing.Labels?.[runtimeResourceLabels.imageVersion]) {
        throw new Error("managed volume image version label is missing");
      }
    } catch (error) {
      if (!isDockerStatus(error, 404)) throw error;
      await this.docker.createVolume({ Name: spec.volumeName, Labels: spec.labels });
    }
  }

  private async inspectContainer(containerId: string): Promise<EngineContainerState> {
    const inspected = await this.docker.getContainer(containerId).inspect();
    const labels = inspected.Config.Labels ?? {};
    const environment = new Map(
      (inspected.Config.Env ?? []).map((entry) => {
        const separator = entry.indexOf("=");
        return separator < 0
          ? [entry, ""]
          : [entry.slice(0, separator), entry.slice(separator + 1)];
      }),
    );
    const runtimeId = required(labels[runtimeResourceLabels.runtimeId]);
    const internalPort = Number(required(environment.get("CODEX_APP_SERVER_PORT")));
    if (!Number.isInteger(internalPort) || internalPort < 1 || internalPort > 65_535) {
      throw new Error("managed container port label is invalid");
    }
    return {
      containerId: inspected.Id,
      containerName: inspected.Name.replace(/^\//, ""),
      imageAlias: required(environment.get("CODEX_RUNTIME_IMAGE_ALIAS")),
      imageVersion: required(labels[runtimeResourceLabels.imageVersion]),
      internalPort,
      running: inspected.State.Running,
      runtimeId,
      runtimeType: runtimeTypeSchema.parse(required(labels[runtimeResourceLabels.runtimeType])),
      serviceToken: required(environment.get("CODEX_APP_SERVER_TOKEN")),
      userHash: required(labels[runtimeResourceLabels.userHash]),
    };
  }
}

function isDockerStatus(error: unknown, statusCode: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    error.statusCode === statusCode
  );
}

function required(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new Error("managed container metadata is missing");
  }
  return value;
}
