export type PlatformIntegrationStatus = "unpaired" | "pending" | "active" | "degraded";

export interface PlatformIntegrationView {
  status: PlatformIntegrationStatus;
  pairingCode: string | null;
  expiresAt: string | null;
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
