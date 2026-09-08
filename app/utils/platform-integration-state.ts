export type PlatformIntegrationStatus = "unpaired" | "pending" | "active" | "degraded";

export interface PlatformIntegrationView {
  status: PlatformIntegrationStatus;
  pairingCode: string | null;
  expiresAt: string | null;
}

export interface PlatformIntegrationApiResponse {
  pairingCode: { expiresAt: string; createdAt?: string } | null;
  active: { pairingId: string; revision: number; status: string } | null;
}

export function platformIntegrationView(
  response: PlatformIntegrationApiResponse | null,
  backendError: string | null,
  now: number,
): PlatformIntegrationView & { active: PlatformIntegrationApiResponse["active"] } {
  if (backendError !== null)
    return { status: "degraded", pairingCode: null, expiresAt: null, active: null };
  const expiresAt = response?.pairingCode?.expiresAt ?? null;
  const local = clearExpiredPairingCode({ status: "unpaired", pairingCode: null, expiresAt }, now);
  if (response?.active !== null && response?.active !== undefined) {
    return {
      status: "active",
      pairingCode: local.pairingCode,
      expiresAt: local.expiresAt,
      active: response.active,
    };
  }
  return {
    status: local.expiresAt === null ? "unpaired" : "pending",
    pairingCode: local.pairingCode,
    expiresAt: local.expiresAt,
    active: null,
  };
}

export function platformIntegrationAccess(
  user: { role: "admin" | "user"; dataOps?: unknown } | null,
) {
  if (user?.role !== "admin") return "hidden" as const;
  return user.dataOps === undefined ? ("manage" as const) : ("read" as const);
}

export function remainingPairingCodeSeconds(expiresAt: string | null, now: number) {
  if (expiresAt === null) return 0;
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}

export function clearExpiredPairingCode(
  view: PlatformIntegrationView,
  now: number,
): PlatformIntegrationView {
  return remainingPairingCodeSeconds(view.expiresAt, now) === 0
    ? { ...view, pairingCode: null, expiresAt: null }
    : view;
}

export function clearPairingCode(view: PlatformIntegrationView): PlatformIntegrationView {
  return { ...view, pairingCode: null, expiresAt: null };
}
