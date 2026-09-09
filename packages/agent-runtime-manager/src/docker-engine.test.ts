import { describe, expect, it, vi } from "vitest";
import Docker from "dockerode";
import { PassThrough } from "node:stream";

import {
  DockerodeEngine,
  DockerRuntimeIdentityError,
  runtimeResourceLabels,
  type DockerContainerCreateSpec,
} from "./docker-engine.js";

describe("DockerodeEngine", () => {
  it("recognizes a fully legacy managed container without inventing placement labels", async () => {
    const docker = Object.assign(new Docker(), {
      listContainers: vi.fn(async () => [{ Id: "legacy-container" }]),
      getContainer: vi.fn(() => ({
        inspect: vi.fn(async () => ({
          Id: "legacy-container",
          Name: "/codex-runtime-legacy",
          Config: {
            Env: [
              "CODEX_APP_SERVER_PORT=4500",
              "CODEX_REMOTE_TOKEN=legacy-token",
              "CODEX_RUNTIME_IMAGE_ALIAS=stable",
            ],
            Labels: {
              [runtimeResourceLabels.imageVersion]: "0.153.4",
              [runtimeResourceLabels.managed]: "true",
              [runtimeResourceLabels.runtimeId]: "runtime-legacy",
              [runtimeResourceLabels.runtimeType]: "codex-app-server",
              [runtimeResourceLabels.userHash]: "ab".repeat(32),
            },
          },
          HostConfig: { Memory: 1024, NanoCpus: 1_000_000_000, PidsLimit: 128 },
          State: { Running: true },
        })),
      })),
    });

    await expect(
      new DockerodeEngine(docker).findManagedContainer("runtime-legacy"),
    ).resolves.toMatchObject({
      nodeId: null,
      placementGeneration: null,
      workspaceKey: null,
      containerId: "legacy-container",
    });
  });

  it("fails closed when more than one managed container matches a runtime id", async () => {
    const docker = Object.assign(new Docker(), {
      listContainers: vi.fn(async () => [{ Id: "container-a" }, { Id: "container-b" }]),
    });
    const engine = new DockerodeEngine(docker);

    await expect(engine.findManagedContainer("runtime-a")).rejects.toBeInstanceOf(
      DockerRuntimeIdentityError,
    );
  });

  it("connects the egress network after creating the container on its primary network", async () => {
    const createContainer = vi.fn(async (_options: unknown) => ({ id: "container-a" }));
    const connect = vi.fn(async () => undefined);
    const getNetwork = vi.fn(() => ({ connect }));
    const docker = Object.assign(new Docker(), {
      createContainer,
      getNetwork,
      getContainer: vi.fn(() => ({
        inspect: vi.fn(async () => ({
          Id: "container-a",
          Name: "/codex-runtime-a",
          Config: {
            Env: [
              "CODEX_APP_SERVER_PORT=4555",
              "CODEX_REMOTE_TOKEN=service-token",
              "CODEX_RUNTIME_IMAGE_ALIAS=stable",
            ],
            Labels: runtimeLabels,
          },
          HostConfig: { Memory: 1024, NanoCpus: 2_000_000_000, PidsLimit: 128 },
          State: { Running: false },
        })),
      })),
    });

    const engine = new DockerodeEngine(docker);
    await engine.createManagedContainer(containerSpec());

    expect(createContainer).toHaveBeenCalledOnce();
    expect(createContainer.mock.calls[0]?.[0]).toMatchObject({
      HostConfig: { NetworkMode: "agent-runtime" },
    });
    expect(createContainer.mock.calls[0]?.[0]).not.toHaveProperty("NetworkingConfig");
    expect(getNetwork).toHaveBeenCalledWith("agent-egress");
    expect(connect).toHaveBeenCalledWith({ Container: "container-a" });
  });

  it("opens a non-root Docker Exec TTY in the requested workspace directory", async () => {
    const stream = new PassThrough();
    const resize = vi.fn(async () => undefined);
    const inspect = vi.fn(async () => ({ ExitCode: 0 }));
    const start = vi.fn(async () => stream);
    const exec = vi.fn(async () => ({ resize, inspect, start }));
    const docker = Object.assign(new Docker(), {
      getContainer: vi.fn(() => ({ exec })),
    });

    const terminal = await new DockerodeEngine(docker).openTerminal("container-a", {
      type: "open",
      cwd: "/workspace/project-a",
      cols: 120,
      rows: 40,
    });

    expect(exec).toHaveBeenCalledWith({
      AttachStderr: true,
      AttachStdin: true,
      AttachStdout: true,
      Cmd: [
        "/bin/sh",
        "-lc",
        "if command -v bash >/dev/null 2>&1; then exec bash -l; else exec /bin/sh -l; fi",
      ],
      Env: ["TERM=xterm-256color"],
      Tty: true,
      User: "10001:10001",
      WorkingDir: "/workspace/project-a",
    });
    expect(start).toHaveBeenCalledWith({ hijack: true, stdin: true, Tty: true });
    await terminal.resize(160, 48);
    expect(resize).toHaveBeenCalledWith({ h: 48, w: 160 });
    await expect(terminal.exitCode()).resolves.toBe(0);
    terminal.close();
    expect(stream.destroyed).toBe(true);
  });
});

const runtimeLabels = {
  [runtimeResourceLabels.imageVersion]: "0.153.4",
  [runtimeResourceLabels.managed]: "true",
  [runtimeResourceLabels.runtimeId]: "runtime-a",
  [runtimeResourceLabels.runtimeType]: "codex-app-server",
  [runtimeResourceLabels.userHash]: "ab".repeat(32),
  [runtimeResourceLabels.nodeId]: "node__default",
  [runtimeResourceLabels.placementGeneration]: "1",
  [runtimeResourceLabels.workspaceKey]: "ws__1234567890abcdef1234567890abcdef",
};

function containerSpec(): DockerContainerCreateSpec {
  return {
    containerName: "codex-runtime-a",
    image: "codex-agent-runtime:0.153.4",
    imageAlias: "stable",
    imageVersion: "0.153.4",
    internalPort: 4555,
    labels: runtimeLabels,
    mounts: [],
    networkNames: ["agent-runtime", "agent-egress"],
    runtimeId: "runtime-a",
    runtimeType: "codex-app-server",
    nodeId: "node__default",
    placementGeneration: 1,
    workspaceKey: "ws__1234567890abcdef1234567890abcdef",
    security: {
      User: "10001:10001",
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      Tmpfs: {
        "/dev/shm": "rw,nosuid,nodev,noexec,size=256m,uid=10001,gid=10001,mode=0700",
        "/run/codex-secrets": "rw,nosuid,nodev,noexec,size=16m,uid=10001,gid=10001,mode=0700",
        "/tmp": "rw,nosuid,nodev,noexec,size=1g,uid=10001,gid=10001,mode=0700",
      },
      PidsLimit: 128,
      Memory: 1024,
      NanoCpus: 2_000_000_000,
      Privileged: false,
    },
    serviceToken: "service-token",
    userHash: "ab".repeat(32),
  };
}
