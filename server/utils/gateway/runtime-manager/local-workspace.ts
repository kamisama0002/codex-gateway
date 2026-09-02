import { createError } from "h3";
import type { HostRecord, ProjectRecord } from "~~/shared/types";
import {
  MANAGED_RUNTIME_HOST_ID,
  MANAGED_RUNTIME_PROJECT_ID,
  MANAGED_WORKSPACE_PATH,
  isManagedRuntimeHostId,
} from "~~/shared/runtime/managed-runtime";
import { requireRecord } from "../http/validation/common";
import { currentGatewayUserId } from "../state/memory";
import { hostStore } from "../state/hosts";

const LOCAL_HOST_TIMESTAMP = "2026-01-01T00:00:00.000Z";

export function publicLocalHost(): HostRecord {
  return {
    id: MANAGED_RUNTIME_HOST_ID,
    connectionKind: "managed",
    name: "Local",
    sshHost: "localhost",
    username: null,
    port: null,
    authMode: "agent",
    privateKeyPath: null,
    privateKey: null,
    password: null,
    proxyUrl: null,
    hasPassword: false,
    createdAt: LOCAL_HOST_TIMESTAMP,
    updatedAt: LOCAL_HOST_TIMESTAMP,
  };
}

export function publicLocalProject(): ProjectRecord {
  return {
    id: MANAGED_RUNTIME_PROJECT_ID,
    hostId: MANAGED_RUNTIME_HOST_ID,
    name: "workspace",
    remotePath: MANAGED_WORKSPACE_PATH,
    createdAt: LOCAL_HOST_TIMESTAMP,
    updatedAt: LOCAL_HOST_TIMESTAMP,
  };
}

export function overlayPublicHosts(hosts: HostRecord[]): HostRecord[] {
  return [
    publicLocalHost(),
    ...hosts.filter((host) => !isManagedRuntimeHostId(host.id)),
  ];
}

export function overlayPublicProjects(projects: ProjectRecord[]): ProjectRecord[] {
  const rest = projects.filter((project) => project.id !== MANAGED_RUNTIME_PROJECT_ID);
  const hasWorkspace = rest.some(
    (project) =>
      project.hostId === MANAGED_RUNTIME_HOST_ID && project.remotePath === MANAGED_WORKSPACE_PATH,
  );
  return hasWorkspace ? rest : [publicLocalProject(), ...rest];
}

export function workspaceHostIds(configuredHostIds: Iterable<number>): Set<number> {
  return new Set([...configuredHostIds, MANAGED_RUNTIME_HOST_ID]);
}

export async function requireWorkspaceHost(hostId: number): Promise<HostRecord> {
  if (!isManagedRuntimeHostId(hostId)) {
    return requireRecord(hostStore.getWithSecret(hostId), "Host not found");
  }
  const userId = currentGatewayUserId();
  if (userId === null) {
    throw createError({ statusCode: 404, statusMessage: "Host not found" });
  }
  const { runtimeService } = await import("./runtime-service");
  await runtimeService.start(userId);
  return runtimeService.resolveManagedHost(userId);
}
