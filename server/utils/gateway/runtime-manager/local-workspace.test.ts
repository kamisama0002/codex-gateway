import { describe, expect, it } from "vitest";
import {
  MANAGED_RUNTIME_HOST_ID,
  MANAGED_RUNTIME_PROJECT_ID,
  MANAGED_WORKSPACE_PATH,
  isManagedWorkspaceRootProject,
  workspaceFolderLabel,
} from "~~/shared/runtime/managed-runtime";
import {
  overlayPublicHosts,
  overlayPublicProjects,
  publicLocalHost,
  workspaceHostIds,
} from "./local-workspace";

describe("local workspace overlay", () => {
  it("puts the default local Agent host first and drops a reserved-id duplicate", () => {
    const ssh = {
      ...publicLocalHost(),
      id: 1,
      connectionKind: "ssh" as const,
      name: "centos10",
      sshHost: "192.168.48.110",
    };
    expect(overlayPublicHosts([ssh, publicLocalHost()]).map((host) => host.id)).toEqual([
      MANAGED_RUNTIME_HOST_ID,
      1,
    ]);
  });

  it("adds the default /workspace project unless one already exists on the local host", () => {
    expect(overlayPublicProjects([])[0]).toMatchObject({
      id: MANAGED_RUNTIME_PROJECT_ID,
      hostId: MANAGED_RUNTIME_HOST_ID,
      remotePath: MANAGED_WORKSPACE_PATH,
    });
    expect(
      overlayPublicProjects([
        {
          id: 3,
          hostId: MANAGED_RUNTIME_HOST_ID,
          name: "workspace",
          remotePath: MANAGED_WORKSPACE_PATH,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ]).map((project) => project.id),
    ).toEqual([3]);
  });

  it("keeps managed-host metadata when pruning configured SSH hosts", () => {
    expect([...workspaceHostIds([1])].sort((left, right) => left - right)).toEqual([
      1,
      MANAGED_RUNTIME_HOST_ID,
    ]);
  });

  it("keeps the default workspace when overlay is applied twice", () => {
    const once = overlayPublicProjects([]);
    expect(overlayPublicProjects(once)).toEqual(once);
    expect(overlayPublicHosts(overlayPublicHosts([]))).toEqual(overlayPublicHosts([]));
  });

  it("treats the overlay /workspace project as a hidden root folder", () => {
    expect(
      isManagedWorkspaceRootProject({
        hostId: MANAGED_RUNTIME_HOST_ID,
        remotePath: MANAGED_WORKSPACE_PATH,
      }),
    ).toBe(true);
    expect(
      isManagedWorkspaceRootProject({
        hostId: MANAGED_RUNTIME_HOST_ID,
        remotePath: "/workspace/codex",
      }),
    ).toBe(false);
    expect(
      workspaceFolderLabel({
        hostId: MANAGED_RUNTIME_HOST_ID,
        name: "workspace/codex",
        remotePath: "/workspace/codex",
      }),
    ).toBe("codex");
    expect(
      workspaceFolderLabel({
        hostId: 1,
        name: "workspace/codex",
        remotePath: "/workspace/codex",
      }),
    ).toBe("workspace/codex");
  });
});
