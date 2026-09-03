import type { RuntimeType } from "@codex-gateway/agent-runtime-contracts";
import type { RuntimeProviderConfig } from "./contracts.js";
import { runtimeTypeSchema } from "@codex-gateway/agent-runtime-contracts";
import { PassThrough } from "node:stream";
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
  Tmpfs: Record<"/tmp", string>;
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
  providerConfig?: RuntimeProviderConfig;
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
  nanoCpus: number;
}

export interface DockerEngine {
  findManagedContainer(runtimeId: string): Promise<EngineContainerState | null>;
  createManagedContainer(spec: DockerContainerCreateSpec): Promise<EngineContainerState>;
  startContainer(containerId: string): Promise<void>;
  stopContainer(containerId: string): Promise<void>;
  restartContainer(containerId: string): Promise<void>;
  removeContainer(containerId: string): Promise<void>;
  sampleContainerStats(containerId: string): Promise<unknown>;
  execInContainer(
    containerId: string,
    command: string,
    options: { timeoutMs: number; maxOutputBytes: number },
  ): Promise<{ code: number | null; stdout: string; stderr: string }>;
  updateContainerResources(
    containerId: string,
    resources: { Memory: number; NanoCpus: number; PidsLimit: number },
  ): Promise<void>;
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
        "CODEX_HOME=/codex-home",
        "CODEX_WORKSPACE=/workspace",
        `CODEX_APP_SERVER_PORT=${spec.internalPort}`,
        `CODEX_REMOTE_TOKEN=${spec.serviceToken}`,
        `CODEX_RUNTIME_IMAGE_ALIAS=${spec.imageAlias}`,
        ...(spec.providerConfig === undefined
          ? []
          : [
              `CODEX_GATEWAY_PROVIDER_ID=${spec.providerConfig.providerId}`,
              `CODEX_GATEWAY_MODEL=${spec.providerConfig.modelId}`,
              `CODEX_GATEWAY_PROVIDER_BASE_URL=${spec.providerConfig.baseUrl}`,
              `CODEX_GATEWAY_PROVIDER_TOKEN=${spec.providerConfig.token}`,
            ]),
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
        Tmpfs: spec.security.Tmpfs,
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

  async sampleContainerStats(containerId: string): Promise<unknown> {
    return readDockerStats(
      await this.docker.getContainer(containerId).stats({ stream: false, "one-shot": false }),
    );
  }

  async execInContainer(
    containerId: string,
    command: string,
    options: { timeoutMs: number; maxOutputBytes: number },
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const exec = await this.docker.getContainer(containerId).exec({
      AttachStderr: true,
      AttachStdout: true,
      Cmd: ["/bin/sh", "-c", command],
      User: "10001:10001",
      WorkingDir: "/workspace",
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    return collectExecOutput(this.docker, stream, exec, options);
  }

  async removeContainer(containerId: string): Promise<void> {
    await this.docker.getContainer(containerId).remove({ force: false, v: false });
  }

  async updateContainerResources(
    containerId: string,
    resources: { Memory: number; NanoCpus: number; PidsLimit: number },
  ): Promise<void> {
    await this.docker.getContainer(containerId).update({
      Memory: resources.Memory,
      NanoCPUs: resources.NanoCpus,
      PidsLimit: resources.PidsLimit,
    });
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
      serviceToken: required(environment.get("CODEX_REMOTE_TOKEN")),
      userHash: required(labels[runtimeResourceLabels.userHash]),
      nanoCpus: Math.max(0, inspected.HostConfig.NanoCpus ?? 0),
    };
  }
}

async function readDockerStats(value: unknown): Promise<unknown> {
  if (value !== null && typeof value === "object" && "cpu_stats" in value) return value;
  if (!isAsyncIterable(value)) throw new Error("docker stats payload is invalid");
  const chunks: Buffer[] = [];
  for await (const chunk of value) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function collectExecOutput(
  docker: Docker,
  stream: NodeJS.ReadableStream,
  exec: { inspect(): Promise<{ ExitCode: number | null }> },
  options: { timeoutMs: number; maxOutputBytes: number },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  docker.modem.demuxStream(stream, stdout, stderr);
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let outputBytes = 0;
  let overflowed = false;
  let timedOut = false;
  const consume = (chunks: Buffer[], chunk: Buffer) => {
    outputBytes += chunk.length;
    if (outputBytes > options.maxOutputBytes) {
      overflowed = true;
      destroyStream(stream);
      return;
    }
    chunks.push(chunk);
  };
  stdout.on("data", (chunk: Buffer) => consume(stdoutChunks, chunk));
  stderr.on("data", (chunk: Buffer) => consume(stderrChunks, chunk));
  try {
    await Promise.race([
      finished(stream).catch((error: unknown) => {
        if (overflowed || timedOut) return;
        throw error;
      }),
      sleep(options.timeoutMs).then(() => {
        timedOut = true;
        destroyStream(stream);
      }),
    ]);
  } finally {
    stdout.destroy();
    stderr.destroy();
  }
  if (overflowed) {
    throw new Error(`Remote command output exceeded the ${options.maxOutputBytes} byte limit`);
  }
  if (timedOut) {
    throw new Error(`Remote command timed out after ${options.timeoutMs}ms`);
  }
  const inspected = await exec.inspect();
  return {
    code: inspected.ExitCode,
    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
    stderr: Buffer.concat(stderrChunks).toString("utf8"),
  };
}

function destroyStream(stream: NodeJS.ReadableStream) {
  if ("destroy" in stream && typeof stream.destroy === "function") stream.destroy();
}

function finished(stream: NodeJS.ReadableStream) {
  return new Promise<void>((resolve, reject) => {
    stream.once("end", resolve);
    stream.once("close", resolve);
    stream.once("error", reject);
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAsyncIterable(value: unknown): value is AsyncIterable<string | Uint8Array> {
  return (
    value !== null &&
    typeof value === "object" &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  );
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
