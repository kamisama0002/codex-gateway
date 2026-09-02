export const MANAGED_RUNTIME_HOST_ID = 2_000_000_000;
export const MANAGED_RUNTIME_PROJECT_ID = 2_000_000_001;
export const MANAGED_WORKSPACE_PATH = "/workspace";

export function isManagedRuntimeHostId(hostId: number): boolean {
  return hostId === MANAGED_RUNTIME_HOST_ID;
}

export function isManagedRuntimeProjectId(projectId: number): boolean {
  return projectId === MANAGED_RUNTIME_PROJECT_ID;
}

export function isManagedRuntimeHost(host: {
  id?: number;
  connectionKind?: string | null;
}): boolean {
  return host.id === MANAGED_RUNTIME_HOST_ID || (host.connectionKind ?? "ssh") === "managed";
}
