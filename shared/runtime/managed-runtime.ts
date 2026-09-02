export const MANAGED_RUNTIME_HOST_ID = 2_000_000_000;

export function isManagedRuntimeHost(host: {
  connectionKind?: string | null;
}): boolean {
  return (host.connectionKind ?? "ssh") === "managed";
}
