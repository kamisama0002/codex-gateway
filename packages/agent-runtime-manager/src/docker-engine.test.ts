import { describe, expect, it, vi } from "vitest";

import {
  DockerodeEngine,
  runtimeResourceLabels,
  type DockerContainerCreateSpec,
} from "./docker-engine.js";

describe("DockerodeEngine", () => {
  it("connects the egress network after creating the container on its primary network", async () => {
    const createContainer = vi.fn(async (_options: unknown) => ({ id: "container-a" }));
    const connect = vi.fn(async () => undefined);
    const getNetwork = vi.fn(() => ({ connect }));
    const docker = {
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
    };

    const engine = new DockerodeEngine(docker as never);
    await engine.createManagedContainer(containerSpec());

    expect(createContainer).toHaveBeenCalledOnce();
    const createOptions = createContainer.mock.calls[0]![0] as {
      HostConfig: { NetworkMode: string };
      NetworkingConfig?: unknown;
    };
    expect(createOptions.HostConfig.NetworkMode).toBe("agent-runtime");
    expect(createOptions.NetworkingConfig).toBeUndefined();
    expect(getNetwork).toHaveBeenCalledWith("agent-egress");
    expect(connect).toHaveBeenCalledWith({ Container: "container-a" });
  });
});

const runtimeLabels = {
  [runtimeResourceLabels.imageVersion]: "0.153.4",
  [runtimeResourceLabels.managed]: "true",
  [runtimeResourceLabels.runtimeId]: "runtime-a",
  [runtimeResourceLabels.runtimeType]: "codex-app-server",
  [runtimeResourceLabels.userHash]: "ab".repeat(32),
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
