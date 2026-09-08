import type { DbRow } from "../storage/contracts";

export const DATAOPS_INTEGRATION_PROVIDER = "dataops";

export type DataOpsBindingStatus = "pending" | "active" | "grace" | "retired";

export interface DataOpsIntegrationSecret {
  id: number;
  pairingId: string;
  dataOpsBaseUrl: string;
  sharedSecret: string;
  status: DataOpsBindingStatus;
  revision: number;
  graceExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StageDataOpsIntegrationInput {
  pairingId: string;
  dataOpsBaseUrl: string;
  sharedSecret: string;
  revision: number;
  now: string;
}

export interface DataOpsIntegrationRow extends DbRow {
  id: number | bigint | string;
  pairing_id: string;
  base_url: string;
  encrypted_shared_secret: string;
  status: string;
  revision: number | bigint | string;
  grace_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export function normalizeDataOpsBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.hostname === ""
  ) {
    throw new Error("dataops_base_url_invalid");
  }
  const normalized = url.toString();
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

export function positiveSafeRevision(value: unknown): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("integration_revision_invalid");
  }
  return revision;
}
